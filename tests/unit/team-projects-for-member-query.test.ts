// Unit coverage for getProjectsForMember (lib/queries/team.ts) — the
// team member profile page's "Projects" section.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { applyFilters, type Row, type RowFilter } from "@/tests/unit/helpers/query-filter-mock";

vi.mock("server-only", () => ({}));

type MockError = { message: string } | null;

let memberRows: Row[];
let membersError: MockError;

// Dotted-path filter for the `projects.workspace_id`/`projects.deleted_at`
// embed filters getProjectsForMember issues — the shared eqFilter helper
// only reads a top-level column, not a nested embedded relation.
function embeddedEqFilter(dottedCol: string, val: unknown): RowFilter {
  const [relation, col] = dottedCol.split(".");
  return (row) => {
    const related = row[relation] as Row | undefined;
    return Boolean(related) && related![col] === val;
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      if (table === "project_members") {
        return {
          select: vi.fn(() => {
            const filters: RowFilter[] = [];
            const builder = {
              eq: vi.fn((col: string, val: unknown) => {
                filters.push(
                  col.includes(".") ? embeddedEqFilter(col, val) : (row: Row) => row[col] === val,
                );
                return builder;
              }),
              is: vi.fn(async (col: string, val: unknown) => {
                filters.push(
                  col.includes(".") ? embeddedEqFilter(col, val) : (row: Row) => row[col] === val,
                );
                if (membersError) return { data: null, error: membersError };
                return { data: applyFilters(memberRows, filters), error: null };
              }),
            };
            return builder;
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  })),
}));

import { getProjectsForMember } from "@/lib/queries/team";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_WORKSPACE_ID = "99999999-9999-4999-8999-999999999999";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  membersError = null;
});

describe("getProjectsForMember", () => {
  it("returns the projects this user is an explicit member of, scoped to the given workspace", async () => {
    memberRows = [
      {
        user_id: USER_ID,
        project_role: "lead",
        projects: {
          id: PROJECT_ID,
          key: "ACME",
          name: "Acme project",
          workspace_id: WORKSPACE_ID,
          deleted_at: null,
        },
      },
    ];

    const result = await getProjectsForMember(WORKSPACE_ID, USER_ID);

    expect(result).toEqual([
      {
        projectId: PROJECT_ID,
        projectKey: "ACME",
        projectName: "Acme project",
        projectRole: "lead",
      },
    ]);
  });

  it("excludes a project belonging to a different workspace", async () => {
    memberRows = [
      {
        user_id: USER_ID,
        project_role: "member",
        projects: {
          id: "other-project",
          key: "OTH",
          name: "Other workspace project",
          workspace_id: OTHER_WORKSPACE_ID,
          deleted_at: null,
        },
      },
    ];

    const result = await getProjectsForMember(WORKSPACE_ID, USER_ID);

    expect(result).toEqual([]);
  });

  it("excludes a soft-deleted project", async () => {
    memberRows = [
      {
        user_id: USER_ID,
        project_role: "member",
        projects: {
          id: "deleted-project",
          key: "DEL",
          name: "Deleted project",
          workspace_id: WORKSPACE_ID,
          deleted_at: "2026-01-01T00:00:00Z",
        },
      },
    ];

    const result = await getProjectsForMember(WORKSPACE_ID, USER_ID);

    expect(result).toEqual([]);
  });

  it("throws when the underlying read fails", async () => {
    memberRows = [];
    membersError = { message: "connection reset" };

    await expect(getProjectsForMember(WORKSPACE_ID, USER_ID)).rejects.toEqual(
      membersError,
    );
  });
});
