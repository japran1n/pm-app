// Mission 20260919-150607, F003 (AS-015..AS-021): changeSectionKind
// (lib/actions/architecture/sections.ts), exported from the
// lib/actions/architecture.ts barrel. Mocks follow the minimal
// chainable-stub convention tests/unit/f031-component-guards.test.ts
// already established for this action file.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_WORKSPACE_ID = "99999999-9999-4999-8999-999999999999";
const OTHER_PROJECT_ID = "66666666-6666-4666-8666-666666666666";
const SECTION_ID = "44444444-4444-4444-8444-444444444444";
const NON_SECTION_TASK_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_PROJECT_TASK_ID = "77777777-7777-4777-8777-777777777777";

type TaskRow = {
  id: string;
  project_id: string;
  section_kind: string | null;
  parent_task_id: string | null;
  deleted_at: string | null;
  projects: { workspace_id: string; workspaces: { slug: string } | null };
};

let tasks: Record<string, TaskRow>;
let membershipOk = true;
let membershipRole = "member";
let writeAllowed = true;
let updatedKinds: Record<string, string> = {};
let updateCallCount = 0;
let projectMembersMutated = false; // side-effect guard
let auditCalls: Array<{ workspaceId: string; action: string; targetId?: string | null }> = [];

function resetShared() {
  tasks = {
    [SECTION_ID]: {
      id: SECTION_ID,
      project_id: PROJECT_ID,
      section_kind: "static",
      parent_task_id: "page-task-id",
      deleted_at: null,
      projects: { workspace_id: WORKSPACE_ID, workspaces: { slug: "acme" } },
    },
    [NON_SECTION_TASK_ID]: {
      id: NON_SECTION_TASK_ID,
      project_id: PROJECT_ID,
      // Schema-legal: section_kind is NOT NULL DEFAULT 'static' in the DB,
      // so it can never be null. A non-section task is one with no parent
      // task (parent_task_id IS NULL) -- that's the real "is this a
      // section" predicate.
      section_kind: "static",
      parent_task_id: null, // not a section
      deleted_at: null,
      projects: { workspace_id: WORKSPACE_ID, workspaces: { slug: "acme" } },
    },
    [OTHER_PROJECT_TASK_ID]: {
      id: OTHER_PROJECT_TASK_ID,
      project_id: OTHER_PROJECT_ID,
      section_kind: "static",
      parent_task_id: "page-task-id-2",
      deleted_at: null,
      projects: { workspace_id: OTHER_WORKSPACE_ID, workspaces: { slug: "other" } },
    },
  };
  membershipOk = true;
  membershipRole = "member";
  writeAllowed = true;
  updatedKinds = {};
  updateCallCount = 0;
  projectMembersMutated = false;
  auditCalls = [];
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: USER_ID } } }),
    },
  }),
}));

const requireActiveMembershipMock = vi.fn(
  async (_admin: unknown, workspaceId: string, _userId: string) =>
    membershipOk && workspaceId === WORKSPACE_ID
      ? { ok: true, role: membershipRole }
      : { ok: false },
);

vi.mock("@/lib/auth/require-membership", () => ({
  requireActiveMembership: (...args: unknown[]) =>
    requireActiveMembershipMock(
      ...(args as [unknown, string, string]),
    ),
}));

vi.mock("@/lib/auth/permissions", () => ({
  canWrite: () => writeAllowed,
}));

vi.mock("@/lib/observability/logger", () => ({
  logger: { error: () => {}, warn: () => {}, info: () => {} },
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

vi.mock("@/lib/actions/portal-revalidate", () => ({
  revalidatePortalProject: () => {},
  extractWorkspaceSlug: (w: { slug: string } | { slug: string }[] | null) =>
    Array.isArray(w) ? w[0]?.slug : w?.slug,
}));

vi.mock("@/lib/activity/audit", () => ({
  writeAudit: async (
    _supabase: unknown,
    params: { workspaceId: string; action: string; targetId?: string | null },
  ) => {
    auditCalls.push(params);
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "tasks") {
        return {
          select: () => ({
            eq: (_col: string, id: string) => ({
              is: () => ({
                maybeSingle: async () => {
                  const row = tasks[id];
                  if (!row || row.deleted_at) return { data: null, error: null };
                  return { data: row, error: null };
                },
              }),
            }),
          }),
          update: (values: { section_kind?: string }) => ({
            eq: async (_col: string, id: string) => {
              updateCallCount += 1;
              const row = tasks[id];
              if (row) {
                updatedKinds[id] = values.section_kind ?? "";
                row.section_kind = values.section_kind ?? row.section_kind;
              }
              return { error: null };
            },
          }),
        };
      }

      if (table === "project_members") {
        // Side-effect guard (AS side-effect DoD): this action must never
        // touch project_members at all.
        return {
          insert: async () => {
            projectMembersMutated = true;
            return { error: null };
          },
        };
      }

      throw new Error(`Unexpected table in test stub: ${table}`);
    },
  }),
}));

describe("F003 changeSectionKind", () => {
  beforeEach(() => {
    resetShared();
  });

  it("AS-015: changeSectionKind is exported from the lib/actions/architecture barrel", async () => {
    const mod = await import("@/lib/actions/architecture");
    expect(typeof mod.changeSectionKind).toBe("function");
  });

  it("AS-016: a non-project-member gets { success: false, error } and no DB mutation", async () => {
    membershipOk = false;
    const { changeSectionKind } = await import("@/lib/actions/architecture");

    const result = await changeSectionKind(SECTION_ID, "cms");

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(updateCallCount).toBe(0);
    expect(tasks[SECTION_ID].section_kind).toBe("static");
  });

  it("AS-016b: a viewer (member but no write access) gets { success: false, error }", async () => {
    writeAllowed = false;
    const { changeSectionKind } = await import("@/lib/actions/architecture");

    const result = await changeSectionKind(SECTION_ID, "cms");

    expect(result.success).toBe(false);
    expect(updateCallCount).toBe(0);
  });

  it("AS-017: a task that is NOT a section (parent_task_id IS NULL) is rejected", async () => {
    const { changeSectionKind } = await import("@/lib/actions/architecture");

    const result = await changeSectionKind(NON_SECTION_TASK_ID, "cms");

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(updateCallCount).toBe(0);
  });

  it("AS-019: a task from a different project/workspace than the caller's is rejected", async () => {
    // The mock grants membership only for WORKSPACE_ID (the caller's
    // workspace). OTHER_PROJECT_TASK_ID belongs to OTHER_WORKSPACE_ID, a
    // workspace the caller is NOT a member of. membershipOk stays true —
    // this proves the rejection comes from workspace scoping, not from a
    // globally-flipped "membership is broken" flag.
    const { changeSectionKind } = await import("@/lib/actions/architecture");
    const result = await changeSectionKind(OTHER_PROJECT_TASK_ID, "cms");

    expect(requireActiveMembershipMock).toHaveBeenCalledWith(
      expect.anything(),
      OTHER_WORKSPACE_ID,
      USER_ID,
    );
    expect(result.success).toBe(false);
    expect(updateCallCount).toBe(0);
    expect(tasks[OTHER_PROJECT_TASK_ID].section_kind).toBe("static");
  });

  it("AS-016: a valid call updates section_kind in the DB", async () => {
    const { changeSectionKind } = await import("@/lib/actions/architecture");

    const result = await changeSectionKind(SECTION_ID, "cms");

    expect(result.success).toBe(true);
    expect(updatedKinds[SECTION_ID]).toBe("cms");
    expect(tasks[SECTION_ID].section_kind).toBe("cms");
  });

  it("AS-020: a successful call writes an audit log entry", async () => {
    const { changeSectionKind } = await import("@/lib/actions/architecture");

    const result = await changeSectionKind(SECTION_ID, "cms");

    expect(result.success).toBe(true);
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0].workspaceId).toBe(WORKSPACE_ID);
    expect(auditCalls[0].targetId).toBe(SECTION_ID);
    expect(auditCalls[0].action).toContain("section");
  });

  it("AS-021: setting the same kind twice is idempotent, not an error", async () => {
    const { changeSectionKind } = await import("@/lib/actions/architecture");

    const first = await changeSectionKind(SECTION_ID, "cms");
    expect(first.success).toBe(true);

    const second = await changeSectionKind(SECTION_ID, "cms");
    expect(second.success).toBe(true);
    expect(tasks[SECTION_ID].section_kind).toBe("cms");
  });

  it("AS-020: an idempotent (no-op) call produces no UPDATE and no audit entry", async () => {
    const { changeSectionKind } = await import("@/lib/actions/architecture");

    const first = await changeSectionKind(SECTION_ID, "cms");
    expect(first.success).toBe(true);
    expect(updateCallCount).toBe(1);
    expect(auditCalls).toHaveLength(1);

    const second = await changeSectionKind(SECTION_ID, "cms");
    expect(second.success).toBe(true);
    // No new UPDATE and no new audit entry should be produced for the
    // no-op second call.
    expect(updateCallCount).toBe(1);
    expect(auditCalls).toHaveLength(1);
  });

  it("rejects invalid kind values before touching the DB (Zod validation)", async () => {
    const { changeSectionKind } = await import("@/lib/actions/architecture");

    const result = await changeSectionKind(SECTION_ID, "utility");

    expect(result.success).toBe(false);
    expect(updateCallCount).toBe(0);
  });

  it("side-effect: never mutates project_members while changing a section's kind", async () => {
    const { changeSectionKind } = await import("@/lib/actions/architecture");

    await changeSectionKind(SECTION_ID, "cms");

    expect(projectMembersMutated).toBe(false);
  });
});
