// F111 (missions/20260903-portal, docs/client-portal-visual-plan.md 3.6):
// unit coverage for getPortalWeeklyDelivery's own definition of "shipped
// in week N" -- see lib/queries/portal.ts's own header on that function
// and lib/portal/weekly-delivery.ts's header for the full rationale.
//
// Mocked Supabase client, same filter-honouring convention
// tests/unit/portal-phases-query.test.ts established (and its own header
// explains why a filter-DISCARDING mock would be worthless here): a task
// missing `client_visible: true`, or a status row belonging to a
// different category, is excluded from the result only because the real
// query's own `.eq()`/`.in()` filters genuinely ran against the fixture,
// not because the fixture never included it.

import { describe, expect, it, vi } from "vitest";
import { applyFilters, eqFilter, inFilter, type Row } from "@/tests/unit/helpers/query-filter-mock";

vi.mock("server-only", () => ({}));

type MockError = { message: string } | null;

let taskRows: Row[];
let statusRows: Row[];
let activityRows: Row[];
let tasksError: MockError;
let statusesError: MockError;
let activityError: MockError;

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      if (table === "tasks") {
        return {
          select: vi.fn(() => {
            const filters: Array<(row: Row) => boolean> = [];
            const builder = {
              eq: vi.fn((col: string, val: unknown) => {
                filters.push(eqFilter(col, val));
                return builder;
              }),
              is: vi.fn(async (col: string, val: unknown) => {
                filters.push(eqFilter(col, val));
                if (tasksError) return { data: null, error: tasksError };
                return { data: applyFilters(taskRows, filters), error: null };
              }),
            };
            return builder;
          }),
        };
      }
      if (table === "project_statuses") {
        return {
          select: vi.fn(() => {
            const filters: Array<(row: Row) => boolean> = [];
            const builder = {
              eq: vi.fn(async (col: string, val: unknown) => {
                filters.push(eqFilter(col, val));
                if (statusesError) return { data: null, error: statusesError };
                return { data: applyFilters(statusRows, filters), error: null };
              }),
            };
            return builder;
          }),
        };
      }
      if (table === "task_activity") {
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
              order: vi.fn(async () => {
                if (activityError) return { data: null, error: activityError };
                const rows = applyFilters(activityRows, filters);
                return {
                  data: [...rows].sort((a, b) =>
                    String(b.created_at).localeCompare(String(a.created_at)),
                  ),
                  error: null,
                };
              }),
            };
            return builder;
          }),
        };
      }
      throw new Error(`unexpected table in mock: ${table}`);
    }),
  })),
}));

import { getPortalWeeklyDelivery } from "@/lib/queries/portal";

const DONE_STATUS = { id: "status-done", project_id: "p1", name: "done", category: "done" };
const TODO_STATUS = { id: "status-todo", project_id: "p1", name: "todo", category: "not_started" };

function resetFixtures() {
  taskRows = [];
  statusRows = [DONE_STATUS, TODO_STATUS];
  activityRows = [];
  tasksError = null;
  statusesError = null;
  activityError = null;
}

describe("test_F111_weekly_delivery_no_completed_work", () => {
  it("returns every week in the project's span at zero, not an empty array, when nothing is done yet", async () => {
    resetFixtures();
    taskRows = [
      {
        id: "t1",
        project_id: "p1",
        client_visible: true,
        deleted_at: null,
        status_id: "status-todo",
        status: "todo",
        created_at: "2026-08-10T00:00:00Z",
      },
    ];

    const result = await getPortalWeeklyDelivery("p1", "2026-08-03", "2026-08-24");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data.every((week) => week.count === 0)).toBe(true);
  });

  it("returns zero weeks worth of data (empty span reads as one zero week) for a brand-new project with no tasks at all", async () => {
    resetFixtures();
    // 2026-08-17 (start) and 2026-08-20 (today) both fall in ISO week
    // 2026-W34.
    const result = await getPortalWeeklyDelivery("p1", "2026-08-17", "2026-08-20");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.count).toBe(0);
  });
});

describe("test_F111_weekly_delivery_uses_last_status_transition_not_updated_at", () => {
  it("credits the week of the LAST field_changed/status entry into a done-category status, for a task currently done", async () => {
    resetFixtures();
    taskRows = [
      {
        id: "t1",
        project_id: "p1",
        client_visible: true,
        deleted_at: null,
        status_id: "status-done",
        status: "done",
        created_at: "2026-07-01T00:00:00Z", // long before any activity row -- must NOT be used
      },
    ];
    activityRows = [
      // Reopened, then redone -- the LAST transition should win.
      { task_id: "t1", kind: "field_changed", field: "status", created_at: "2026-08-10T00:00:00Z" },
      { task_id: "t1", kind: "field_changed", field: "status", created_at: "2026-08-17T00:00:00Z" },
    ];

    const result = await getPortalWeeklyDelivery("p1", "2026-08-03", "2026-08-24");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const shippedWeeks = result.data.filter((w) => w.count > 0);
    expect(shippedWeeks).toHaveLength(1);
    // 2026-08-17 falls in the week of Monday 2026-08-17.
    expect(shippedWeeks[0]!.isoWeek).toBe("2026-W34");
  });

  it("falls back to the task's created_at (never updated_at) when no task_activity row exists for a done task", async () => {
    resetFixtures();
    taskRows = [
      {
        id: "t1",
        project_id: "p1",
        client_visible: true,
        deleted_at: null,
        status_id: "status-done",
        status: "done",
        created_at: "2026-08-10T00:00:00Z",
      },
    ];

    const result = await getPortalWeeklyDelivery("p1", "2026-08-03", "2026-08-24");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const shippedWeeks = result.data.filter((w) => w.count > 0);
    expect(shippedWeeks).toHaveLength(1);
    // 2026-08-10 falls in the week of Monday 2026-08-10.
    expect(shippedWeeks[0]!.isoWeek).toBe("2026-W33");
  });
});

describe("test_F111_weekly_delivery_empty_week_is_zero_not_absent", () => {
  it("keeps a week with no completions in the middle of the span at count 0, between two weeks that did ship", async () => {
    resetFixtures();
    taskRows = [
      {
        id: "t1",
        project_id: "p1",
        client_visible: true,
        deleted_at: null,
        status_id: "status-done",
        status: "done",
        created_at: "2026-08-03T00:00:00Z",
      },
      {
        id: "t2",
        project_id: "p1",
        client_visible: true,
        deleted_at: null,
        status_id: "status-done",
        status: "done",
        created_at: "2026-08-17T00:00:00Z",
      },
    ];

    const result = await getPortalWeeklyDelivery("p1", "2026-08-03", "2026-08-24");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(4);
    expect(result.data.map((w) => w.count)).toEqual([1, 0, 1, 0]);
  });
});

describe("test_F111_weekly_delivery_excludes_non_client_visible_and_non_done", () => {
  it("never counts a task that is not client_visible, even if its status is done", async () => {
    resetFixtures();
    taskRows = [
      {
        id: "hidden",
        project_id: "p1",
        client_visible: false,
        deleted_at: null,
        status_id: "status-done",
        status: "done",
        created_at: "2026-08-10T00:00:00Z",
      },
    ];

    const result = await getPortalWeeklyDelivery("p1", "2026-08-03", "2026-08-24");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.every((week) => week.count === 0)).toBe(true);
  });

  it("never counts a task still in a not-done category", async () => {
    resetFixtures();
    taskRows = [
      {
        id: "t1",
        project_id: "p1",
        client_visible: true,
        deleted_at: null,
        status_id: "status-todo",
        status: "todo",
        created_at: "2026-08-10T00:00:00Z",
      },
    ];

    const result = await getPortalWeeklyDelivery("p1", "2026-08-03", "2026-08-24");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.every((week) => week.count === 0)).toBe(true);
  });
});

describe("test_F111_weekly_delivery_fails_loudly_on_read_error", () => {
  it("returns { ok: false } when the tasks read fails, never a silently-zeroed chart", async () => {
    resetFixtures();
    tasksError = { message: "boom" };
    const result = await getPortalWeeklyDelivery("p1", "2026-08-03", "2026-08-24");
    expect(result.ok).toBe(false);
  });

  it("returns { ok: false } when the task_activity read fails", async () => {
    resetFixtures();
    taskRows = [
      {
        id: "t1",
        project_id: "p1",
        client_visible: true,
        deleted_at: null,
        status_id: "status-done",
        status: "done",
        created_at: "2026-08-10T00:00:00Z",
      },
    ];
    activityError = { message: "boom" };
    const result = await getPortalWeeklyDelivery("p1", "2026-08-03", "2026-08-24");
    expect(result.ok).toBe(false);
  });
});
