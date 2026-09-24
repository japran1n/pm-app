// Mission 20260919-150607, F022 (AS-080, AS-081): atomicity-supporting test
// for `setDisciplineEstimatesBulk`.
//
// `setDisciplineEstimatesBulk` (lib/actions/architecture/estimates.ts) sends
// every "set"/"clear" entry as a SINGLE multi-row `upsert()` call (one DB
// round trip carrying an array of rows). Full atomicity -- either every row
// in that statement lands, or none of them do -- is a guarantee provided by
// PostgreSQL itself for a single multi-row INSERT ... ON CONFLICT statement.
// That DB-level guarantee cannot be proven by a unit test with a fake
// in-memory table: only a live database can show a genuine partial-write
// rollback. That coverage lives in
// tests/integration/f017-new-discipline-estimates.test.ts (against a real
// Supabase stack), not here.
//
// What THIS unit test can honestly prove, and does prove, is the contract
// that makes Postgres's atomicity guarantee applicable in the first place:
// the whole batch (including any "clear" entries) is sent as exactly ONE
// upsert() call, never as N per-discipline calls and never via a separate
// delete() call. If the production code were changed to loop and issue one
// upsert per discipline (no single wrapping statement), Postgres's
// atomicity guarantee would no longer apply even though each individual
// call might still "succeed" -- so this test's upsertCallCount assertion is
// the real regression guard, not the mock's own commit/rollback logic.
//
// AS-080: a failure during the bulk write is surfaced from a single
//         round-trip call (the mechanism that enables all-or-nothing
//         semantics), not from multiple independent per-row calls.
// AS-081: when the bulk write fails, the action surfaces an error result
//         (success: false) instead of silently swallowing the failure.
//
// IMPORTANT: the fake `upsert` below does NOT decide "commit vs. discard"
// based on whether the batch contains a failing row -- it always records
// every row it was handed, whether the call is later reported as succeeded
// or failed. That is deliberate: the test must observe what the PRODUCTION
// CODE did (how many calls, what error it returned), not re-assert a
// commit/discard branch baked into the mock itself.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/architecture/authorize", async () =>
  (await import("../helpers/architecture-authorize-mock")).architectureAuthorizeMock({
    workspaceFor: () => "ws-1",
  }),
);

const TASK_ID = "c6d92920-fa93-408d-91cb-87cb907b3fec";
const PROJECT_ID = "83a351f8-6762-498d-8c6e-a1683703c6f1";
const WORKSPACE_ID = "73b61885-e883-48cb-b7fa-6477238ffc00";
const USER_ID = "01c5bd9a-c1da-41a4-ac0e-a4fab320a32a";

// Discipline whose presence in a batch simulates a mid-batch DB failure
// (e.g. a constraint violation surfaced by Postgres for that one row).
const FAILING_DISCIPLINE = "qa";

// Records of every row ever passed to `upsert()`, and whether a `delete()`
// call was ever made. Neither of these encodes an atomicity decision -- they
// are plain observations of what the production code sent to the fake table.
let attemptedRows: Array<Record<string, unknown>> = [];
let upsertCallCount = 0;
let deleteCallCount = 0;

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const loggerErrorSpy = vi.fn();
vi.mock("@/lib/observability/logger", () => ({
  logger: { error: (...args: unknown[]) => loggerErrorSpy(...args), warn: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: async () => ({ user: { id: USER_ID }, supabase: { fake: "session-client" } }),
}));

vi.mock("@/lib/activity/audit", () => ({
  writeAudit: vi.fn(),
}));

vi.mock("@/lib/auth/require-membership", () => ({
  requireActiveMembership: async () => ({ ok: true, role: "member" }),
}));

vi.mock("@/lib/auth/permissions", () => ({
  canWrite: () => true,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table === "tasks") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  id: TASK_ID,
                  project_id: PROJECT_ID,
                  deleted_at: null,
                  projects: { workspace_id: WORKSPACE_ID },
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "task_discipline_estimates") {
        return {
          // Records every row it is asked to write, unconditionally, then
          // reports success/failure for the WHOLE call based on whether any
          // row in the batch is the designated failing discipline. It does
          // NOT choose whether to record rows based on that condition --
          // `attemptedRows` therefore only tells the test what was SENT in
          // a call, never what a real DB would have committed. The
          // assertions below rely on `upsertCallCount` (one round trip) and
          // `result.success` / the error message (from the production code),
          // not on `attemptedRows`, to make any atomicity-adjacent claim.
          upsert: async (payload: Array<Record<string, unknown>> | Record<string, unknown>) => {
            upsertCallCount += 1;
            const rows = Array.isArray(payload) ? payload : [payload];
            attemptedRows.push(...rows);

            const hasFailingRow = rows.some((row) => row.discipline === FAILING_DISCIPLINE);
            if (hasFailingRow) {
              return {
                error: { message: `simulated constraint violation on ${FAILING_DISCIPLINE}` },
              };
            }
            return { error: null };
          },
          delete: () => {
            deleteCallCount += 1;
            return {
              eq: () => ({ eq: async () => ({ error: null }) }),
            };
          },
        };
      }
      throw new Error(`Unexpected table in mock: ${table}`);
    },
  }),
}));

afterEach(() => {
  attemptedRows = [];
  upsertCallCount = 0;
  deleteCallCount = 0;
  loggerErrorSpy.mockClear();
  vi.clearAllMocks();
});

describe("setDisciplineEstimatesBulk atomicity-supporting contract (AS-080, AS-081)", () => {
  it("test_AS_080_a_mid_batch_failure_is_reported_from_a_single_round_trip_call", async () => {
    const { setDisciplineEstimatesBulk } = await import(
      "@/lib/actions/architecture/estimates"
    );

    // Five entries; "qa" is positioned in the middle of the batch and is
    // the one the fake DB rejects.
    const result = await setDisciplineEstimatesBulk(TASK_ID, [
      { discipline: "design", input: "1h" },
      { discipline: "development", input: "2h 30m" },
      { discipline: FAILING_DISCIPLINE, input: "1.5h" },
      { discipline: "content_seo", input: "45m" },
      { discipline: "pm", input: "30m" },
    ]);

    expect(result.success).toBe(false);

    // The atomicity-enabling contract: exactly one upsert() call carried the
    // entire batch. This is what makes Postgres's single-statement
    // all-or-nothing guarantee applicable in the first place -- a
    // regression to N sequential per-discipline calls would still pass a
    // "committedRows === 0" style assertion against a naive mock while
    // actually enabling partial commits against a real DB, which is why we
    // assert the round-trip count instead.
    expect(upsertCallCount).toBe(1);
    expect(attemptedRows).toHaveLength(5);

    // No separate delete() path exists that could commit independently of
    // the upsert and leave partial state.
    expect(deleteCallCount).toBe(0);
  });

  it("test_AS_080_an_all_clean_batch_succeeds_via_a_single_round_trip_call", async () => {
    const { setDisciplineEstimatesBulk } = await import(
      "@/lib/actions/architecture/estimates"
    );

    const result = await setDisciplineEstimatesBulk(TASK_ID, [
      { discipline: "design", input: "1h" },
      { discipline: "development", input: "2h 30m" },
    ]);

    expect(result.success).toBe(true);
    expect(upsertCallCount).toBe(1);
    expect(attemptedRows).toHaveLength(2);
  });

  it("test_AS_081_bulk_write_failure_is_returned_as_an_error_result_not_swallowed", async () => {
    const { setDisciplineEstimatesBulk } = await import(
      "@/lib/actions/architecture/estimates"
    );

    const result = await setDisciplineEstimatesBulk(TASK_ID, [
      { discipline: "design", input: "1h" },
      { discipline: FAILING_DISCIPLINE, input: "1.5h" },
    ]);

    // Failure must be explicit in the return value, not a thrown/uncaught
    // exception and not a silent `{ success: true }`.
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe("string");
    expect((result.error as string).length).toBeGreaterThan(0);

    // The failure must also be observable server-side (logged), proving
    // it isn't swallowed anywhere in the call chain.
    expect(loggerErrorSpy).toHaveBeenCalled();
    const loggedMessage = loggerErrorSpy.mock.calls[0]?.[0];
    expect(loggedMessage).toEqual(expect.stringContaining("setDisciplineEstimatesBulk"));
  });

  it("test_AS_080_a_mid_batch_failure_including_a_clear_entry_is_sent_as_one_round_trip", async () => {
    const { setDisciplineEstimatesBulk } = await import(
      "@/lib/actions/architecture/estimates"
    );

    // F073: clearing a discipline is represented as a minutes: null row in
    // the SAME upsert batch, not a separate delete() call. This exercises
    // that branch: a batch mixing a "clear" (empty input -> minutes: null)
    // and a "set" entry with the failing discipline.
    const result = await setDisciplineEstimatesBulk(TASK_ID, [
      { discipline: "design", input: "" }, // clear
      { discipline: "development", input: "2h" },
      { discipline: FAILING_DISCIPLINE, input: "1h" },
    ]);

    expect(result.success).toBe(false);
    // Exactly one upsert call carried all three rows (including the clear
    // row), and no separate delete() call exists that could have committed
    // independently of the failed upsert.
    expect(upsertCallCount).toBe(1);
    expect(attemptedRows).toHaveLength(3);
    expect(deleteCallCount).toBe(0);
  });

  it("test_AS_080_a_clear_only_batch_succeeds_via_a_single_round_trip_call", async () => {
    const { setDisciplineEstimatesBulk } = await import(
      "@/lib/actions/architecture/estimates"
    );

    const result = await setDisciplineEstimatesBulk(TASK_ID, [
      { discipline: "design", input: "" },
    ]);

    expect(result.success).toBe(true);
    expect(upsertCallCount).toBe(1);
    expect(deleteCallCount).toBe(0);
    expect(attemptedRows).toHaveLength(1);
    expect(attemptedRows[0]).toMatchObject({ discipline: "design", minutes: null });
  });

  it("test_AS_081_bulk_write_failure_never_resolves_to_success_true", async () => {
    const { setDisciplineEstimatesBulk } = await import(
      "@/lib/actions/architecture/estimates"
    );

    const result = await setDisciplineEstimatesBulk(TASK_ID, [
      { discipline: FAILING_DISCIPLINE, input: "45m" },
    ]);

    expect(result).not.toEqual({ success: true });
    expect(result.success).toBe(false);
  });
});
