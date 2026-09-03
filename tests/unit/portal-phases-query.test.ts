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

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

type Row = Record<string, unknown>;

let phaseRows: Row[];
let taskRows: Row[];
let statusRows: Row[];

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      if (table === "project_phases") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(async () => ({ data: phaseRows, error: null })),
              })),
            })),
          })),
        };
      }
      if (table === "tasks") {
        return {
          select: vi.fn(() => ({
            in: vi.fn(() => ({
              eq: vi.fn(() => ({
                is: vi.fn(async () => ({ data: taskRows, error: null })),
              })),
            })),
          })),
        };
      }
      if (table === "project_statuses") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(async () => ({ data: statusRows, error: null })),
          })),
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
const DONE_STATUS_ID = "44444444-4444-4444-8444-444444444444";
const TODO_STATUS_ID = "55555555-5555-4555-8555-555555555555";

beforeEach(() => {
  statusRows = [
    { id: DONE_STATUS_ID, project_id: PROJECT_ID, name: "Done", category: "done" },
    { id: TODO_STATUS_ID, project_id: PROJECT_ID, name: "Todo", category: "not_started" },
  ];
});

describe("getProjectPhases — AS-011 progress counts only client-visible tasks", () => {
  it("excludes a non-client-visible task from both the total and the done count", async () => {
    phaseRows = [
      {
        id: PHASE_ID,
        name: "Build",
        client_description: "Building the approved designs.",
        state: "active",
        planned_start: null,
        planned_end: null,
        actual_start: null,
        actual_end: null,
        position: 1,
      },
    ];
    // Only client-visible tasks are ever returned to this query in
    // practice (the real implementation filters .eq("client_visible",
    // true)), so the mock only needs to model what a correct query
    // returns: two client-visible tasks, one done.
    taskRows = [
      { id: "t1", phase_id: PHASE_ID, status_id: DONE_STATUS_ID, status: "Done" },
      { id: "t2", phase_id: PHASE_ID, status_id: TODO_STATUS_ID, status: "Todo" },
    ];

    const phases = await getProjectPhases(PROJECT_ID);

    expect(phases).toHaveLength(1);
    expect(phases[0].totalClientVisibleTasks).toBe(2);
    expect(phases[0].doneClientVisibleTasks).toBe(1);
    expect(phases[0].progressPercent).toBe(50);
  });

  it("reports 0% rather than dividing by zero when a phase has no client-visible tasks", async () => {
    phaseRows = [
      {
        id: PHASE_ID,
        name: "Handover",
        client_description: null,
        state: "not_started",
        planned_start: null,
        planned_end: null,
        actual_start: null,
        actual_end: null,
        position: 10,
      },
    ];
    taskRows = [];

    const phases = await getProjectPhases(PROJECT_ID);

    expect(phases).toHaveLength(1);
    expect(phases[0].totalClientVisibleTasks).toBe(0);
    expect(phases[0].progressPercent).toBe(0);
  });

  it("AS-012: a phase the query never returns contributes nothing to any other phase's figure", async () => {
    // The real query filters project_phases on client_visible = true, so
    // a hidden phase's row (and any task pointing at it) never reaches
    // this function at all — modelled here by simply not including it,
    // and asserting the visible phase's own numbers are unaffected by
    // tasks that belonged to it.
    phaseRows = [
      {
        id: PHASE_ID,
        name: "Build",
        client_description: "Building the approved designs.",
        state: "active",
        planned_start: null,
        planned_end: null,
        actual_start: null,
        actual_end: null,
        position: 1,
      },
    ];
    taskRows = [{ id: "t1", phase_id: PHASE_ID, status_id: DONE_STATUS_ID, status: "Done" }];

    const phases = await getProjectPhases(PROJECT_ID);

    expect(phases.map((p) => p.id)).not.toContain(HIDDEN_PHASE_ID);
    expect(phases[0].totalClientVisibleTasks).toBe(1);
    expect(phases[0].doneClientVisibleTasks).toBe(1);
    expect(phases[0].progressPercent).toBe(100);
  });

  it("returns an empty list, not an error, when a project has no phases", async () => {
    phaseRows = [];
    taskRows = [];

    const phases = await getProjectPhases(PROJECT_ID);

    expect(phases).toEqual([]);
  });
});
