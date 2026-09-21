// F002 (missions/20260921-184313, AS-073/074/075): getUnassignedCount and
// getKpiDelta both create their own request-scoped Supabase client
// internally (`createClient()` from lib/supabase/server) rather than
// taking one as a parameter — mocked the same genuinely-filtering way
// tests/unit/calendar-blocks-active-members.test.ts mocks
// `@/lib/supabase/server`, so a dropped/wrong `.eq`/`.is`/`.in`/`.lt`/
// `.gte` filter in the real code fails these tests, not just a missing
// chain method.

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  applyFilters,
  eqFilter,
  inFilter,
  isNullFilter,
  ltFilter,
  type Row,
} from "@/tests/unit/helpers/query-filter-mock";

vi.mock("server-only", () => ({}));

let projectRows: Row[];
let taskRows: Row[];

function gteFilter(col: string, val: unknown) {
  return (row: Row) => {
    const rowVal = row[col];
    if (rowVal === null || rowVal === undefined) return false;
    return String(rowVal) >= String(val);
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      if (table === "projects") {
        return {
          select: vi.fn(() => {
            const filters: Array<(row: Row) => boolean> = [];
            const builder = {
              eq: vi.fn((col: string, val: unknown) => {
                filters.push(eqFilter(col, val));
                return builder;
              }),
              is: vi.fn(async (col: string, val: unknown) => {
                if (val === null) {
                  filters.push(isNullFilter(col));
                }
                return { data: applyFilters(projectRows, filters), error: null };
              }),
            };
            return builder;
          }),
        };
      }
      if (table === "tasks") {
        return {
          select: vi.fn(() => {
            const filters: Array<(row: Row) => boolean> = [];
            const builder = {
              in: vi.fn((col: string, vals: unknown[]) => {
                filters.push(inFilter(col, vals));
                return builder;
              }),
              is: vi.fn((col: string, val: unknown) => {
                if (val === null) {
                  filters.push(isNullFilter(col));
                }
                return builder;
              }),
              lt: vi.fn(async (col: string, val: unknown) => {
                filters.push(ltFilter(col, val));
                return { data: applyFilters(taskRows, filters), error: null };
              }),
              gte: vi.fn(async (col: string, val: unknown) => {
                filters.push(gteFilter(col, val));
                return { data: applyFilters(taskRows, filters), error: null };
              }),
              // getUnassignedCount's builder ends its chain on `.is()`,
              // so `.is()` must itself be able to resolve the promise
              // when it's the final call — implemented by returning a
              // thenable builder.
              then: (resolve: (v: { data: Row[]; error: null }) => void) => {
                resolve({ data: applyFilters(taskRows, filters), error: null });
              },
            };
            return builder;
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  })),
}));

import { getUnassignedCount, getKpiDelta } from "@/lib/queries/dashboard";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_WORKSPACE_ID = "99999999-9999-4999-8999-999999999999";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";

const NOW = new Date("2026-09-21T12:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);

  projectRows = [
    { id: PROJECT_ID, workspace_id: WORKSPACE_ID, deleted_at: null },
    {
      id: "archived-project",
      workspace_id: WORKSPACE_ID,
      deleted_at: "2026-01-01T00:00:00.000Z",
    },
    { id: "other-ws-project", workspace_id: OTHER_WORKSPACE_ID, deleted_at: null },
  ];
});

describe("AS-073/AS-074: getUnassignedCount", () => {
  it("test_AS_073_counts_incomplete_unassigned_tasks_in_active_projects", async () => {
    taskRows = [
      {
        id: "t1",
        project_id: PROJECT_ID,
        assignee_id: null,
        deleted_at: null,
        project_statuses: { category: "not_started" },
      },
      {
        id: "t2",
        project_id: PROJECT_ID,
        assignee_id: null,
        deleted_at: null,
        project_statuses: { category: "in_progress" },
      },
    ];

    const result = await getUnassignedCount(WORKSPACE_ID);
    expect(result).toBe(2);
  });

  it("test_AS_074_excludes_done_category_tasks", async () => {
    taskRows = [
      {
        id: "t1",
        project_id: PROJECT_ID,
        assignee_id: null,
        deleted_at: null,
        project_statuses: { category: "not_started" },
      },
      {
        id: "t2",
        project_id: PROJECT_ID,
        assignee_id: null,
        deleted_at: null,
        project_statuses: { category: "done" },
      },
    ];

    const result = await getUnassignedCount(WORKSPACE_ID);
    expect(result).toBe(1);
  });

  it("test_AS_074_excludes_assigned_and_deleted_tasks_via_filters", async () => {
    // Rows that a broken/missing filter would wrongly include — proves
    // the mock (and therefore the real `.is()` calls) are load-bearing.
    taskRows = [
      {
        id: "assigned",
        project_id: PROJECT_ID,
        assignee_id: "some-user",
        deleted_at: null,
        project_statuses: { category: "not_started" },
      },
      {
        id: "deleted",
        project_id: PROJECT_ID,
        assignee_id: null,
        deleted_at: "2026-01-01T00:00:00.000Z",
        project_statuses: { category: "not_started" },
      },
    ];

    const result = await getUnassignedCount(WORKSPACE_ID);
    expect(result).toBe(0);
  });

  it("test_AS_073_zero_active_projects_returns_zero", async () => {
    projectRows = [
      { id: "archived-only", workspace_id: WORKSPACE_ID, deleted_at: "2026-01-01T00:00:00.000Z" },
    ];
    taskRows = [];

    const result = await getUnassignedCount(WORKSPACE_ID);
    expect(result).toBe(0);
  });
});

describe("AS-075: getKpiDelta", () => {
  it("test_AS_075_overdue_counts_tasks_past_cutoff_excluding_done", async () => {
    taskRows = [
      {
        id: "old-overdue",
        project_id: PROJECT_ID,
        deleted_at: null,
        due_date: "2026-09-01",
        project_statuses: { category: "not_started" },
      },
      {
        id: "old-overdue-done",
        project_id: PROJECT_ID,
        deleted_at: null,
        due_date: "2026-09-01",
        project_statuses: { category: "done" },
      },
      {
        id: "recent-due-date",
        project_id: PROJECT_ID,
        deleted_at: null,
        due_date: "2026-09-19",
        project_statuses: { category: "not_started" },
      },
    ];

    // daysBack = 7 -> cutoff date is 2026-09-14; only due_date < cutoff counts.
    const result = await getKpiDelta(WORKSPACE_ID, "overdue", 7);
    expect(result).toBe(1);
  });

  it("test_AS_075_completed_counts_done_category_tasks_updated_within_window", async () => {
    taskRows = [
      {
        id: "recently-done",
        project_id: PROJECT_ID,
        deleted_at: null,
        updated_at: "2026-09-20T00:00:00.000Z",
        project_statuses: { category: "done" },
      },
      {
        id: "stale-done",
        project_id: PROJECT_ID,
        deleted_at: null,
        updated_at: "2026-08-01T00:00:00.000Z",
        project_statuses: { category: "done" },
      },
      {
        id: "recent-not-done",
        project_id: PROJECT_ID,
        deleted_at: null,
        updated_at: "2026-09-20T00:00:00.000Z",
        project_statuses: { category: "in_progress" },
      },
    ];

    const result = await getKpiDelta(WORKSPACE_ID, "completed", 7);
    expect(result).toBe(1);
  });

  it("test_AS_075_zero_active_projects_returns_zero", async () => {
    projectRows = [];
    taskRows = [];

    const result = await getKpiDelta(WORKSPACE_ID, "overdue", 7);
    expect(result).toBe(0);
  });
});
