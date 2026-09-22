// FU-20 (M3 scrutiny attempt 2, part of F047): SB-045 previously rested
// solely on the credential-gated integration suite (which itself was
// silently contributing zero executed assertions -- see this feature's
// handoff for the root-cause fix). This proves, at the unit level with no
// live database required, that `getWorkspaceProjects` (lib/queries/
// projects.ts) — the query backing the default Projects page grid and the
// sidebar's project list — excludes a soft-deleted project (`deleted_at`
// set) from what it returns.
//
// Mirrors tests/unit/project-health-inputs-done-count.test.ts's
// query-filter-mock convention: the mock `.is()` call genuinely filters
// the in-memory row set by the column/value the real code passes, rather
// than ignoring its own arguments and handing back every fixture row. That
// means this test fails if `lib/queries/projects.ts` ever drops or
// mistargets its `.is("deleted_at", null)` call -- not just if the whole
// chain's shape changes.

import { describe, expect, it, vi } from "vitest";
import { applyFilters, isNullFilter, type Row } from "@/tests/unit/helpers/query-filter-mock";

let projectRows: Row[];

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      if (table !== "projects") throw new Error(`Unexpected table: ${table}`);
      return {
        select: vi.fn(() => {
          const filters: Array<(row: Row) => boolean> = [];
          const builder = {
            eq: vi.fn(() => builder),
            is: vi.fn((col: string, _val: unknown) => {
              filters.push(isNullFilter(col));
              return builder;
            }),
            order: vi.fn(() => builder),
            returns: vi.fn(async () => ({
              data: applyFilters(projectRows, filters),
              error: null,
            })),
          };
          return builder;
        }),
      };
    }),
    rpc: vi.fn(async () => ({ data: [], error: null })),
  })),
}));

vi.mock("@/lib/observability/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { getWorkspaceProjects } from "@/lib/queries/projects";

describe("SB-045: getWorkspaceProjects excludes soft-deleted projects", () => {
  it("test_SB_045_a_project_with_deleted_at_set_is_absent_from_getWorkspaceProjects_results", async () => {
    projectRows = [
      {
        id: "proj-active",
        workspace_id: "ws-1",
        name: "Active Project",
        description: null,
        start_date: null,
        end_date: null,
        created_at: "2026-01-01T00:00:00Z",
        key: "ACT",
        icon: null,
        sidebar_position: null,
        deleted_at: null,
      },
      {
        id: "proj-archived",
        workspace_id: "ws-1",
        name: "Soft-deleted Project",
        description: null,
        start_date: null,
        end_date: null,
        created_at: "2026-01-02T00:00:00Z",
        key: "ARC",
        icon: null,
        sidebar_position: null,
        deleted_at: "2026-02-01T00:00:00Z",
      },
    ];

    const result = await getWorkspaceProjects("ws-1");

    const ids = result.map((p) => p.id);
    expect(ids).toContain("proj-active");
    expect(ids).not.toContain("proj-archived");
    expect(result).toHaveLength(1);
  });

  it("test_SB_045_a_workspace_with_only_a_deleted_project_renders_an_empty_grid_not_the_deleted_row", async () => {
    projectRows = [
      {
        id: "proj-only-deleted",
        workspace_id: "ws-1",
        name: "Only Project, Deleted",
        description: null,
        start_date: null,
        end_date: null,
        created_at: "2026-01-01T00:00:00Z",
        key: "DEL",
        icon: null,
        sidebar_position: null,
        deleted_at: "2026-02-01T00:00:00Z",
      },
    ];

    const result = await getWorkspaceProjects("ws-1");

    expect(result).toEqual([]);
  });
});
