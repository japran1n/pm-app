// F001 (missions/20260903-portal): unit coverage for getProjectPhases'
// progress computation (lib/queries/portal.ts) — AS-011/AS-012.
//
// The RLS half of these assertions (a client cannot select a hidden phase
// or a portal-disabled project's rows at all) is covered end-to-end,
// through real signed-in sessions and PostgREST, in
// tests/integration/portal-phases-rls.test.ts. This file covers the part
// RLS cannot express: the progress FIGURE's business rule that only a
// client-visible task counts, applied here with a mocked Supabase client
// so the math is exercised in isolation from the database.
//
// F006f (missions/20260903-portal, AS-011): the mock below used to
// discard every `.eq()`/`.in()`/`.is()` argument and simply hand back a
// fixed row set regardless of what the real code filtered on — a mock
// that ignores the filter cannot prove the filter is applied. It now
// applies each call's own column/value against the row set, so a row
// that SHOULD be excluded (wrong phase, hidden, soft-deleted) is only
// absent from a test's result because the real query genuinely filtered
// it out, not because the fixture never included it. It also supports
// injecting an `error` per table, to cover this feature's own "fails
// loudly" requirement — getProjectPhases must return `{ ok: false }`,
// never compute a percentage from a partial or empty read.
//
// F006j (missions/20260903-portal, test integrity): `eqFilter`/
// `inFilter`/`applyFilters` moved to the shared
// tests/unit/helpers/query-filter-mock.ts, adopted here and by
// tests/unit/portal-overview-queries.test.ts — see that file's own
// header comment for why a filter-honouring mock is the whole point.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { applyFilters, eqFilter, inFilter, type Row } from "@/tests/unit/helpers/query-filter-mock";

vi.mock("server-only", () => ({}));

type MockError = { message: string } | null;

let phaseRows: Row[];
let taskRows: Row[];
let statusRows: Row[];
let phasesError: MockError;
let tasksError: MockError;
let statusesError: MockError;

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      if (table === "project_phases") {
        return {
          select: vi.fn(() => {
            const filters: Array<(row: Row) => boolean> = [];
            const builder = {
              eq: vi.fn((col: string, val: unknown) => {
                filters.push(eqFilter(col, val));
                return builder;
              }),
              order: vi.fn(async () => {
                if (phasesError) return { data: null, error: phasesError };
                return { data: applyFilters(phaseRows, filters), error: null };
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
      throw new Error(`unexpected table ${table}`);
    }),
  })),
}));

import { getProjectPhases } from "@/lib/queries/portal";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const PHASE_ID = "22222222-2222-4222-8222-222222222222";
const HIDDEN_PHASE_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_PHASE_ID = "66666666-6666-4666-8666-666666666666";
const DONE_STATUS_ID = "44444444-4444-4444-8444-444444444444";
const TODO_STATUS_ID = "55555555-5555-4555-8555-555555555555";

beforeEach(() => {
  statusRows = [
    { id: DONE_STATUS_ID, project_id: PROJECT_ID, name: "Done", category: "done" },
    { id: TODO_STATUS_ID, project_id: PROJECT_ID, name: "Todo", category: "not_started" },
  ];
  phasesError = null;
  tasksError = null;
  statusesError = null;
});

describe("getProjectPhases — AS-011 progress counts only client-visible tasks", () => {
  it("excludes a non-client-visible task from both the total and the done count", async () => {
    phaseRows = [
      {
        id: PHASE_ID,
        project_id: PROJECT_ID,
        name: "Build",
        client_description: "Building the approved designs.",
        state: "active",
        planned_start: null,
        planned_end: null,
        actual_start: null,
        actual_end: null,
        position: 1,
        client_visible: true,
      },
    ];
    // Includes a hidden task and a soft-deleted task alongside the two
    // real ones -- if the real query ever dropped its
    // `.eq("client_visible", true)` or `.is("deleted_at", null)` call,
    // this mock would hand both back and the counts below would be 4/2
    // instead of 2/1, failing the test for the right reason.
    taskRows = [
      {
        id: "t1",
        phase_id: PHASE_ID,
        status_id: DONE_STATUS_ID,
        status: "Done",
        client_visible: true,
        deleted_at: null,
      },
      {
        id: "t2",
        phase_id: PHASE_ID,
        status_id: TODO_STATUS_ID,
        status: "Todo",
        client_visible: true,
        deleted_at: null,
      },
      {
        id: "t-hidden",
        phase_id: PHASE_ID,
        status_id: DONE_STATUS_ID,
        status: "Done",
        client_visible: false,
        deleted_at: null,
      },
      {
        id: "t-deleted",
        phase_id: PHASE_ID,
        status_id: DONE_STATUS_ID,
        status: "Done",
        client_visible: true,
        deleted_at: "2026-01-01T00:00:00Z",
      },
    ];

    const result = await getProjectPhases(PROJECT_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0].totalClientVisibleTasks).toBe(2);
    expect(result.data[0].doneClientVisibleTasks).toBe(1);
    expect(result.data[0].progressPercent).toBe(50);
  });

  it("excludes a task that belongs to a different phase from this phase's count", async () => {
    // Proves the `.in("phase_id", phaseIds)` call itself is what scopes
    // the task set, not an accident of the fixture -- OTHER_PHASE_ID is
    // never in `phaseRows`, so its task must never be counted anywhere.
    phaseRows = [
      {
        id: PHASE_ID,
        project_id: PROJECT_ID,
        name: "Build",
        client_description: null,
        state: "active",
        planned_start: null,
        planned_end: null,
        actual_start: null,
        actual_end: null,
        position: 1,
        client_visible: true,
      },
    ];
    taskRows = [
      {
        id: "t1",
        phase_id: PHASE_ID,
        status_id: DONE_STATUS_ID,
        status: "Done",
        client_visible: true,
        deleted_at: null,
      },
      {
        id: "t-other-phase",
        phase_id: OTHER_PHASE_ID,
        status_id: DONE_STATUS_ID,
        status: "Done",
        client_visible: true,
        deleted_at: null,
      },
    ];

    const result = await getProjectPhases(PROJECT_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0].totalClientVisibleTasks).toBe(1);
    expect(result.data[0].doneClientVisibleTasks).toBe(1);
  });

  it("reports 0% rather than dividing by zero when a phase has no client-visible tasks", async () => {
    phaseRows = [
      {
        id: PHASE_ID,
        project_id: PROJECT_ID,
        name: "Handover",
        client_description: null,
        state: "not_started",
        planned_start: null,
        planned_end: null,
        actual_start: null,
        actual_end: null,
        position: 10,
        client_visible: true,
      },
    ];
    taskRows = [];

    const result = await getProjectPhases(PROJECT_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0].totalClientVisibleTasks).toBe(0);
    expect(result.data[0].progressPercent).toBe(0);
  });

  it("AS-012: a phase hidden by client_visible = false contributes nothing to any other phase's figure", async () => {
    // Both phases are in the fixture; HIDDEN_PHASE_ID's own
    // client_visible: false is what the real `.eq("client_visible",
    // true)` call excludes it on -- if that filter were ever dropped,
    // this mock would hand both phases back and `result.data` would
    // have length 2 instead of 1.
    phaseRows = [
      {
        id: PHASE_ID,
        project_id: PROJECT_ID,
        name: "Build",
        client_description: "Building the approved designs.",
        state: "active",
        planned_start: null,
        planned_end: null,
        actual_start: null,
        actual_end: null,
        position: 1,
        client_visible: true,
      },
      {
        id: HIDDEN_PHASE_ID,
        project_id: PROJECT_ID,
        name: "Internal cleanup",
        client_description: null,
        state: "active",
        planned_start: null,
        planned_end: null,
        actual_start: null,
        actual_end: null,
        position: 2,
        client_visible: false,
      },
    ];
    taskRows = [
      {
        id: "t1",
        phase_id: PHASE_ID,
        status_id: DONE_STATUS_ID,
        status: "Done",
        client_visible: true,
        deleted_at: null,
      },
      {
        id: "t-hidden-phase",
        phase_id: HIDDEN_PHASE_ID,
        status_id: DONE_STATUS_ID,
        status: "Done",
        client_visible: true,
        deleted_at: null,
      },
    ];

    const result = await getProjectPhases(PROJECT_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data.map((p) => p.id)).not.toContain(HIDDEN_PHASE_ID);
    expect(result.data[0].totalClientVisibleTasks).toBe(1);
    expect(result.data[0].doneClientVisibleTasks).toBe(1);
    expect(result.data[0].progressPercent).toBe(100);
  });

  it("returns an empty list, not an error, when a project has no phases", async () => {
    phaseRows = [];
    taskRows = [];

    const result = await getProjectPhases(PROJECT_ID);

    expect(result).toEqual({ ok: true, data: [] });
  });
});

describe("getProjectPhases — F006f (AS-011): a failed read fails loudly, never a fabricated percentage", () => {
  it("test_AS_011_a_failed_project_statuses_read_returns_ok_false_not_a_computed_percentage", async () => {
    phaseRows = [
      {
        id: PHASE_ID,
        project_id: PROJECT_ID,
        name: "Build",
        client_description: null,
        state: "active",
        planned_start: null,
        planned_end: null,
        actual_start: null,
        actual_end: null,
        position: 1,
        client_visible: true,
      },
    ];
    // A fully-delivered phase: every task really is done. If the
    // statuses read failing were still allowed to fall through to a
    // computed figure, this phase would read as 0% (every task's
    // category unresolved, defaulting to not_started) instead of 100% --
    // exactly the defect this feature removes. The correct behaviour is
    // no figure at all: `{ ok: false }`.
    taskRows = [
      {
        id: "t1",
        phase_id: PHASE_ID,
        status_id: DONE_STATUS_ID,
        status: "Done",
        client_visible: true,
        deleted_at: null,
      },
    ];
    statusesError = { message: "connection reset" };

    const result = await getProjectPhases(PROJECT_ID);

    expect(result).toEqual({ ok: false, error: "connection reset" });
  });

  it("test_AS_011_a_failed_tasks_read_also_returns_ok_false", async () => {
    phaseRows = [
      {
        id: PHASE_ID,
        project_id: PROJECT_ID,
        name: "Build",
        client_description: null,
        state: "active",
        planned_start: null,
        planned_end: null,
        actual_start: null,
        actual_end: null,
        position: 1,
        client_visible: true,
      },
    ];
    taskRows = [];
    tasksError = { message: "connection reset" };

    const result = await getProjectPhases(PROJECT_ID);

    expect(result).toEqual({ ok: false, error: "connection reset" });
  });

  it("a failed project_phases read itself also returns ok: false", async () => {
    phaseRows = [];
    phasesError = { message: "connection reset" };

    const result = await getProjectPhases(PROJECT_ID);

    expect(result).toEqual({ ok: false, error: "connection reset" });
  });
});
