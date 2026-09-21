// F003 (AS-023): unit coverage for getQaReturns (lib/queries/my-tasks.ts) —
// "QA returns" home attention item: a task assigned to the caller that
// someone ELSE moved OUT of a QA-ish status back into a still-open
// (non-done/non-cancelled) status within the last 7 days.
//
// Mirrors tests/unit/portal-phases-query.test.ts's filter-honouring mock
// convention (tests/unit/helpers/query-filter-mock.ts) so a dropped/wrong
// `.eq()`/`.neq()`/`.gt()`/`.in()` call in the real query fails this test
// for the right reason, not just because the chain's shape changed.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { applyFilters, eqFilter, inFilter, type Row, type RowFilter } from "@/tests/unit/helpers/query-filter-mock";

vi.mock("server-only", () => ({}));

function neqFilter(col: string, val: unknown): RowFilter {
  return (row) => row[col] !== val;
}

// Real Supabase resolves a dotted `.eq("tasks.projects.workspace_id", ...)`
// against the embedded relation, not a flat column — this mock walks the
// same dotted path against the nested fixture object so a dropped/wrong
// embed filter in the real query still fails this test, rather than being
// unrepresentable and silently ignored.
function dottedEqFilter(col: string, val: unknown): RowFilter {
  const path = col.split(".");
  return (row) => {
    let current: unknown = row;
    for (const key of path) {
      if (current === null || typeof current !== "object") return false;
      current = (current as Row)[key];
    }
    return current === val;
  };
}

function gtFilter(col: string, val: unknown): RowFilter {
  return (row) => String(row[col]) > String(val);
}

type MockError = { message: string } | null;

let assignedRows: Row[];
let activityRows: Row[];
let statusRows: Row[];
let assignedError: MockError;
let activityError: MockError;
let statusError: MockError;

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      if (table === "task_assignees") {
        return {
          select: vi.fn(() => {
            const filters: RowFilter[] = [];
            const resolve = async () => {
              if (assignedError) return { data: null, error: assignedError };
              return { data: applyFilters(assignedRows, filters), error: null };
            };
            const builder = {
              eq: vi.fn((col: string, val: unknown) => {
                filters.push(col.includes(".") ? dottedEqFilter(col, val) : eqFilter(col, val));
                return builder;
              }),
              is: vi.fn((col: string, val: unknown) => {
                filters.push(col.includes(".") ? dottedEqFilter(col, val) : eqFilter(col, val));
                return builder;
              }),
              then: (
                onFulfilled: (value: { data: Row[] | null; error: MockError }) => unknown,
              ) => resolve().then(onFulfilled),
            };
            return builder;
          }),
        };
      }
      if (table === "task_activity") {
        return {
          select: vi.fn(() => {
            const filters: RowFilter[] = [];
            const builder = {
              in: vi.fn((col: string, vals: unknown[]) => {
                filters.push(inFilter(col, vals));
                return builder;
              }),
              eq: vi.fn((col: string, val: unknown) => {
                filters.push(eqFilter(col, val));
                return builder;
              }),
              neq: vi.fn((col: string, val: unknown) => {
                filters.push(neqFilter(col, val));
                return builder;
              }),
              gt: vi.fn((col: string, val: unknown) => {
                filters.push(gtFilter(col, val));
                return builder;
              }),
              order: vi.fn(async () => {
                if (activityError) return { data: null, error: activityError };
                const filtered = applyFilters(activityRows, filters);
                filtered.sort((a, b) =>
                  String(b.created_at).localeCompare(String(a.created_at)),
                );
                return { data: filtered, error: null };
              }),
            };
            return builder;
          }),
        };
      }
      if (table === "project_statuses") {
        return {
          select: vi.fn(() => {
            const filters: RowFilter[] = [];
            const builder = {
              in: vi.fn(async (col: string, vals: unknown[]) => {
                filters.push(inFilter(col, vals));
                if (statusError) return { data: null, error: statusError };
                return { data: applyFilters(statusRows, filters), error: null };
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

import { getQaReturns } from "@/lib/queries/my-tasks";

const WORKSPACE_ID = "ws-1";
const USER_ID = "user-me";
const OTHER_USER_ID = "user-other";
const PROJECT_ID = "proj-1";
const TASK_ID = "task-1";

function assignedTaskRow(overrides: Partial<Row> = {}): Row {
  return {
    task_id: TASK_ID,
    user_id: USER_ID,
    tasks: {
      id: TASK_ID,
      title: "Fix login bug",
      number: 42,
      project_id: PROJECT_ID,
      deleted_at: null,
      projects: {
        id: PROJECT_ID,
        key: "ENG",
        name: "Engineering",
        workspace_id: WORKSPACE_ID,
        deleted_at: null,
      },
    },
    ...overrides,
  };
}

beforeEach(() => {
  assignedError = null;
  activityError = null;
  statusError = null;
  statusRows = [
    { project_id: PROJECT_ID, name: "QA", category: "qa" },
    { project_id: PROJECT_ID, name: "In Progress", category: "in_progress" },
    { project_id: PROJECT_ID, name: "Done", category: "done" },
    { project_id: PROJECT_ID, name: "Cancelled", category: "cancelled" },
  ];
});

describe("getQaReturns (AS-023)", () => {
  it("test_AS_023_returns_a_task_bounced_from_qa_back_to_in_progress_by_someone_else", async () => {
    assignedRows = [assignedTaskRow()];
    activityRows = [
      {
        task_id: TASK_ID,
        field: "status",
        old_value: "QA",
        new_value: "In Progress",
        actor_id: OTHER_USER_ID,
        created_at: new Date().toISOString(),
      },
    ];

    const result = await getQaReturns(WORKSPACE_ID, USER_ID);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      taskId: TASK_ID,
      taskTitle: "Fix login bug",
      taskNumber: 42,
      projectKey: "ENG",
      projectName: "Engineering",
    });
  });

  it("test_AS_023_excludes_a_status_change_made_by_the_assignee_themselves", async () => {
    assignedRows = [assignedTaskRow()];
    activityRows = [
      {
        task_id: TASK_ID,
        field: "status",
        old_value: "QA",
        new_value: "In Progress",
        actor_id: USER_ID, // the assignee moved it themselves
        created_at: new Date().toISOString(),
      },
    ];

    const result = await getQaReturns(WORKSPACE_ID, USER_ID);

    expect(result).toHaveLength(0);
  });

  it("test_AS_023_excludes_a_status_change_older_than_7_days", async () => {
    assignedRows = [assignedTaskRow()];
    const eightDaysAgo = new Date(
      Date.now() - 8 * 24 * 60 * 60 * 1000,
    ).toISOString();
    activityRows = [
      {
        task_id: TASK_ID,
        field: "status",
        old_value: "QA",
        new_value: "In Progress",
        actor_id: OTHER_USER_ID,
        created_at: eightDaysAgo,
      },
    ];

    const result = await getQaReturns(WORKSPACE_ID, USER_ID);

    expect(result).toHaveLength(0);
  });

  it("test_AS_023_excludes_a_move_from_qa_into_done", async () => {
    assignedRows = [assignedTaskRow()];
    activityRows = [
      {
        task_id: TASK_ID,
        field: "status",
        old_value: "QA",
        new_value: "Done",
        actor_id: OTHER_USER_ID,
        created_at: new Date().toISOString(),
      },
    ];

    const result = await getQaReturns(WORKSPACE_ID, USER_ID);

    expect(result).toHaveLength(0);
  });

  it("test_AS_023_excludes_a_move_from_qa_into_cancelled", async () => {
    assignedRows = [assignedTaskRow()];
    activityRows = [
      {
        task_id: TASK_ID,
        field: "status",
        old_value: "QA",
        new_value: "Cancelled",
        actor_id: OTHER_USER_ID,
        created_at: new Date().toISOString(),
      },
    ];

    const result = await getQaReturns(WORKSPACE_ID, USER_ID);

    expect(result).toHaveLength(0);
  });

  it("test_AS_023_excludes_a_status_change_that_did_not_originate_from_a_qa_status", async () => {
    assignedRows = [assignedTaskRow()];
    activityRows = [
      {
        task_id: TASK_ID,
        field: "status",
        old_value: "In Progress",
        new_value: "In Progress", // not even a qa-origin change
        actor_id: OTHER_USER_ID,
        created_at: new Date().toISOString(),
      },
    ];

    const result = await getQaReturns(WORKSPACE_ID, USER_ID);

    expect(result).toHaveLength(0);
  });

  it("test_AS_023_matches_a_qa_origin_status_by_name_even_without_a_qa_category", async () => {
    assignedRows = [assignedTaskRow()];
    statusRows = [
      { project_id: PROJECT_ID, name: "Client QA", category: "in_progress" },
      { project_id: PROJECT_ID, name: "In Progress", category: "in_progress" },
    ];
    activityRows = [
      {
        task_id: TASK_ID,
        field: "status",
        old_value: "Client QA",
        new_value: "In Progress",
        actor_id: OTHER_USER_ID,
        created_at: new Date().toISOString(),
      },
    ];

    const result = await getQaReturns(WORKSPACE_ID, USER_ID);

    expect(result).toHaveLength(1);
  });

  it("test_AS_023_returns_an_empty_array_when_the_caller_has_no_assigned_tasks", async () => {
    assignedRows = [];
    activityRows = [];

    const result = await getQaReturns(WORKSPACE_ID, USER_ID);

    expect(result).toEqual([]);
  });

  it("test_AS_023_caps_results_at_10_newest_first", async () => {
    assignedRows = [assignedTaskRow()];
    activityRows = Array.from({ length: 15 }, (_, i) => ({
      task_id: TASK_ID,
      field: "status",
      old_value: "QA",
      new_value: "In Progress",
      actor_id: OTHER_USER_ID,
      created_at: new Date(Date.now() - i * 1000).toISOString(),
    }));

    const result = await getQaReturns(WORKSPACE_ID, USER_ID);

    expect(result).toHaveLength(10);
    // Newest first: the first row (i=0, most recent) sorts to the top.
    expect(result[0].changedAt).toBe(activityRows[0].created_at);
  });
});
