import { describe, expect, it } from "vitest";

import {
  filterProjectsVisibleToCaller,
  filterUsersWhoCanSeeProject,
  isProjectVisibleForRole,
  isProjectVisibleToCaller,
  type ProjectVisibility,
} from "@/lib/actions/project-visibility";
import type { WorkspaceRole } from "@/lib/auth/permissions";

// Parity with `public.is_project_visible_to` as defined live and in
// supabase/migrations/20260908010000_pin_pg_temp_on_client_visibility_predicates.sql.
// For an active workspace member (wm.status = 'active'):
//
//   (
//     wm.role not in ('guest', 'client')
//     and (p.visibility = 'workspace' or wm.role in ('owner', 'admin'))
//   )
//   or exists (project_members row for (p.id, auth.uid()))
//
// `sqlRule` below transcribes that expression literally; the TS helper must
// agree with it on every cell of the role x visibility x membership matrix.
// Archived projects are not special-cased by the SQL predicate, so they are
// not a dimension here.
function sqlRule(
  role: WorkspaceRole,
  visibility: ProjectVisibility,
  hasProjectMembersRow: boolean,
): boolean {
  return (
    (!["guest", "client"].includes(role) &&
      (visibility === "workspace" || ["owner", "admin"].includes(role))) ||
    hasProjectMembersRow
  );
}

const ROLES: WorkspaceRole[] = ["owner", "admin", "member", "viewer", "guest", "client"];
const VISIBILITIES: ProjectVisibility[] = ["workspace", "private"];

// Written out by hand so a change to `sqlRule` cannot silently move both
// sides at once.
const EXPECTED: Record<WorkspaceRole, Record<ProjectVisibility, [boolean, boolean]>> = {
  //             [no project_members row, with row]
  owner: { workspace: [true, true], private: [true, true] },
  admin: { workspace: [true, true], private: [true, true] },
  member: { workspace: [true, true], private: [false, true] },
  viewer: { workspace: [true, true], private: [false, true] },
  guest: { workspace: [false, true], private: [false, true] },
  client: { workspace: [false, true], private: [false, true] },
};

type Row = Record<string, string>;

// Minimal stand-in for the admin client's project_members reads: records
// every query and answers from `rows`.
function fakeAdmin(rows: Array<{ project_id: string; user_id: string }>) {
  const calls: Array<{ eq: Row; in?: { column: string; values: string[] } }> = [];
  const admin = {
    from(table: string) {
      expect(table).toBe("project_members");
      const call: { eq: Row; in?: { column: string; values: string[] } } = { eq: {} };
      calls.push(call);
      const matches = () =>
        rows.filter(
          (r) =>
            Object.entries(call.eq).every(
              ([k, v]) => (r as Row)[k] === v,
            ) && (!call.in || call.in.values.includes((r as Row)[call.in.column])),
        );
      const builder = {
        select: () => builder,
        eq: (column: string, value: string) => {
          call.eq[column] = value;
          return builder;
        },
        in: (column: string, values: string[]) => {
          call.in = { column, values };
          return builder;
        },
        maybeSingle: async () => ({ data: matches()[0] ?? null, error: null }),
        then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
          resolve({ data: matches(), error: null }),
      };
      return builder;
    },
  };
  return { admin: admin as never, calls };
}

describe("isProjectVisibleForRole matches is_project_visible_to", () => {
  for (const role of ROLES) {
    for (const visibility of VISIBILITIES) {
      for (const member of [false, true]) {
        it(`${role} / ${visibility} / project_members row: ${member}`, () => {
          const expected = EXPECTED[role][visibility][member ? 1 : 0];
          expect(sqlRule(role, visibility, member)).toBe(expected);
          expect(
            isProjectVisibleForRole({ role, visibility, isProjectMember: member }),
          ).toBe(expected);
        });
      }
    }
  }
});

describe("isProjectVisibleToCaller", () => {
  for (const role of ROLES) {
    for (const visibility of VISIBILITIES) {
      for (const member of [false, true]) {
        it(`${role} / ${visibility} / project_members row: ${member}`, async () => {
          const { admin } = fakeAdmin(
            member ? [{ project_id: "p1", user_id: "u1" }] : [],
          );
          await expect(
            isProjectVisibleToCaller(admin, { projectId: "p1", visibility }, "u1", role),
          ).resolves.toBe(sqlRule(role, visibility, member));
        });
      }
    }
  }

  it("a guest added only to project A cannot see workspace-visible project B", async () => {
    const { admin } = fakeAdmin([{ project_id: "A", user_id: "g" }]);
    await expect(
      isProjectVisibleToCaller(admin, { projectId: "A", visibility: "workspace" }, "g", "guest"),
    ).resolves.toBe(true);
    await expect(
      isProjectVisibleToCaller(admin, { projectId: "B", visibility: "workspace" }, "g", "guest"),
    ).resolves.toBe(false);
  });
});

describe("filterProjectsVisibleToCaller (batch, per project)", () => {
  it("checks every project id, not just the first", async () => {
    const { admin, calls } = fakeAdmin([{ project_id: "A", user_id: "g" }]);
    const visible = await filterProjectsVisibleToCaller(admin, "g", [
      { projectId: "A", visibility: "workspace", role: "guest" },
      { projectId: "B", visibility: "workspace", role: "guest" },
      { projectId: "C", visibility: "private", role: "guest" },
    ]);
    expect([...visible].sort()).toEqual(["A"]);
    expect(calls).toHaveLength(1);
    expect(calls[0].in?.values.sort()).toEqual(["A", "B", "C"]);
  });

  it("applies each project's own role", async () => {
    const { admin } = fakeAdmin([]);
    const visible = await filterProjectsVisibleToCaller(admin, "u", [
      { projectId: "W1", visibility: "private", role: "admin" },
      { projectId: "W2", visibility: "workspace", role: "member" },
      { projectId: "W3", visibility: "private", role: "member" },
      { projectId: "W4", visibility: "workspace", role: "client" },
    ]);
    expect([...visible].sort()).toEqual(["W1", "W2"]);
  });

  it("skips the query when no project needs it", async () => {
    const { admin, calls } = fakeAdmin([]);
    await filterProjectsVisibleToCaller(admin, "u", [
      { projectId: "A", visibility: "workspace", role: "member" },
    ]);
    expect(calls).toHaveLength(0);
  });
});

describe("filterUsersWhoCanSeeProject (batch, per user)", () => {
  for (const visibility of VISIBILITIES) {
    it(`matches the SQL rule for every role on a ${visibility} project`, async () => {
      const roleByUserId = new Map<string, WorkspaceRole>();
      const rows: Array<{ project_id: string; user_id: string }> = [];
      for (const role of ROLES) {
        roleByUserId.set(`${role}-out`, role);
        roleByUserId.set(`${role}-in`, role);
        rows.push({ project_id: "p", user_id: `${role}-in` });
      }
      const { admin } = fakeAdmin(rows);
      const visible = await filterUsersWhoCanSeeProject(
        admin,
        { projectId: "p", visibility },
        roleByUserId,
      );
      for (const role of ROLES) {
        expect(visible.has(`${role}-out`)).toBe(sqlRule(role, visibility, false));
        expect(visible.has(`${role}-in`)).toBe(sqlRule(role, visibility, true));
      }
    });
  }
});
