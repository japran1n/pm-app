// Ad-hoc "Projects page card redesign": unit coverage for
// `getProjectHealthInputs`'s `doneTaskCount` (lib/queries/projects.ts),
// the field the projects list page's new done/total progress bar reads.
//
// Proves `doneTaskCount` is derived from this SAME `taskRows` fetch (its
// own `status === "done"` rows), always consistent with `totalTaskCount`
// because both come from one query — never a second query, never mixed
// with `getWorkspaceProjects`'s RPC-based `openTaskCount`.
//
// Mirrors tests/unit/portal-phases-query.test.ts's filter-honouring mock
// convention (via the shared query-filter-mock helper) rather than a mock
// that ignores its own filter arguments and just hands back fixture rows.

import { describe, expect, it, vi } from "vitest";
import { applyFilters, eqFilter, inFilter, type Row } from "@/tests/unit/helpers/query-filter-mock";

let taskRows: Row[];
const phaseRows: Row[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      if (table === "tasks") {
        return {
          select: vi.fn(() => {
            const filters: Array<(row: Row) => boolean> = [];
            const builder = {
              in: vi.fn((col: string, vals: unknown[]) => {
                filters.push(inFilter(col, vals));
                return builder;
              }),
              is: vi.fn(async (col: string, val: unknown) => {
                filters.push(eqFilter(col, val));
                return { data: applyFilters(taskRows, filters), error: null };
              }),
            };
            return builder;
          }),
        };
      }
      if (table === "project_phases") {
        return {
          select: vi.fn(() => {
            const filters: Array<(row: Row) => boolean> = [];
            const builder = {
              in: vi.fn((col: string, vals: unknown[]) => {
                filters.push(inFilter(col, vals));
                return builder;
              }),
              eq: vi.fn((col: string, val: unknown) => {
                filters.push(eqFilter(col, val));
                return builder;
              }),
              order: vi.fn(async () => ({
                data: applyFilters(phaseRows, filters),
                error: null,
              })),
            };
            return builder;
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  })),
}));

vi.mock("@/lib/observability/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { getProjectHealthInputs } from "@/lib/queries/projects";

describe("getProjectHealthInputs doneTaskCount (ad-hoc projects page redesign)", () => {
  it("counts only status === 'done' rows for the project, sharing the same rows as totalTaskCount", async () => {
    taskRows = [
      { project_id: "p1", due_date: null, status: "done", deleted_at: null },
      { project_id: "p1", due_date: null, status: "done", deleted_at: null },
      { project_id: "p1", due_date: null, status: "todo", deleted_at: null },
      { project_id: "p2", due_date: null, status: "done", deleted_at: null },
    ];

    const result = await getProjectHealthInputs(["p1", "p2"]);

    expect(result.get("p1")).toMatchObject({ totalTaskCount: 3, doneTaskCount: 2 });
    expect(result.get("p2")).toMatchObject({ totalTaskCount: 1, doneTaskCount: 1 });
  });

  it("returns doneTaskCount 0 for a project with zero tasks (no fabricated non-zero value)", async () => {
    taskRows = [{ project_id: "other", due_date: null, status: "done", deleted_at: null }];

    const result = await getProjectHealthInputs(["p1"]);

    expect(result.get("p1")).toMatchObject({ totalTaskCount: 0, doneTaskCount: 0 });
  });

  it("never lets doneTaskCount exceed totalTaskCount even if every task is done", async () => {
    taskRows = [
      { project_id: "p1", due_date: null, status: "done", deleted_at: null },
      { project_id: "p1", due_date: null, status: "done", deleted_at: null },
    ];

    const result = await getProjectHealthInputs(["p1"]);
    const input = result.get("p1")!;

    expect(input.doneTaskCount).toBe(2);
    expect(input.doneTaskCount).toBeLessThanOrEqual(input.totalTaskCount);
  });
});
