// Mission 20260919-150607, F022 (AS-080, AS-081): atomicity test for
// `setDisciplineEstimatesBulk`.
//
// `setDisciplineEstimatesBulk` (lib/actions/architecture/estimates.ts) sends
// every "set" entry as a SINGLE multi-row `upsert()` call (one DB round
// trip carrying an array of rows), relying on Postgres's guarantee that a
// single multi-row INSERT ... ON CONFLICT statement is atomic: either every
// row in that statement lands, or none of them do.
//
// This test simulates that boundary with a fake in-memory table. The fake
// only commits rows to its store once the whole upsert call has been
// determined to succeed; if the simulated call fails partway (one bad row
// in the batch), NOTHING from that call is written to the store -- exactly
// how a real single-statement Postgres upsert would roll back on error.
//
// AS-080: a failure during the bulk write does not leave partial state in
//         the DB -- either every discipline in the batch is written, or
//         none are.
// AS-081: when the bulk write fails, the action surfaces an error result
//         (success: false) instead of silently swallowing the failure.
//
// If a future change replaces the single array `upsert()` call with a loop
// that issues one upsert per discipline (no wrapping transaction), this
// test's fake store would show a nonzero number of committed rows after a
// simulated failure mid-batch, and the AS-080 assertion below would fail --
// which is the point: it catches a regression that reintroduces partial
// writes.
import { afterEach, describe, expect, it, vi } from "vitest";

const TASK_ID = "c6d92920-fa93-408d-91cb-87cb907b3fec";
const PROJECT_ID = "83a351f8-6762-498d-8c6e-a1683703c6f1";
const WORKSPACE_ID = "73b61885-e883-48cb-b7fa-6477238ffc00";
const USER_ID = "01c5bd9a-c1da-41a4-ac0e-a4fab320a32a";

// Discipline whose presence in a batch simulates a mid-batch DB failure
// (e.g. a constraint violation surfaced by Postgres for that one row).
const FAILING_DISCIPLINE = "qa";

// Fake persisted table state. Only ever mutated by a "committed" call --
// i.e. a call that resolves to `{ error: null }`. This is what a
// downstream read of the DB would see after the action returns.
let committedRows: Array<Record<string, unknown>> = [];
let upsertCallCount = 0;

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
          // Simulates a single multi-row `INSERT ... ON CONFLICT` statement.
          // Postgres executes this as ONE atomic statement: if any row in
          // the batch violates a constraint, the whole statement is rolled
          // back and NOTHING in `payload` is persisted. We model that here:
          // decide success/failure for the whole call up front, and only
          // mutate `committedRows` in the success branch.
          upsert: async (payload: Array<Record<string, unknown>> | Record<string, unknown>) => {
            upsertCallCount += 1;
            const rows = Array.isArray(payload) ? payload : [payload];
            const hasFailingRow = rows.some((row) => row.discipline === FAILING_DISCIPLINE);

            if (hasFailingRow) {
              // Atomic rollback: nothing from this call is committed, no
              // matter how many valid rows were in the same batch.
              return {
                error: { message: `simulated constraint violation on ${FAILING_DISCIPLINE}` },
              };
            }

            committedRows.push(...rows);
            return { error: null };
          },
        };
      }
      throw new Error(`Unexpected table in mock: ${table}`);
    },
  }),
}));

afterEach(() => {
  committedRows = [];
  upsertCallCount = 0;
  loggerErrorSpy.mockClear();
  vi.clearAllMocks();
});

describe("setDisciplineEstimatesBulk atomicity (AS-080, AS-081)", () => {
  it("test_AS_080_a_mid_batch_failure_leaves_no_partial_state_in_the_db", async () => {
    const { setDisciplineEstimatesBulk } = await import(
      "@/lib/actions/architecture/estimates"
    );

    // Five valid entries; "qa" is positioned in the middle of the batch and
    // is the one the fake DB rejects. If the write were truly atomic (one
    // statement for the whole array, as the implementation does), a
    // rejection on "qa" must mean design/development/content_seo/pm were
    // ALSO not written -- they were sent in the very same statement.
    const result = await setDisciplineEstimatesBulk(TASK_ID, [
      { discipline: "design", input: "1h" },
      { discipline: "development", input: "2h 30m" },
      { discipline: FAILING_DISCIPLINE, input: "1.5h" },
      { discipline: "content_seo", input: "45m" },
      { discipline: "pm", input: "30m" },
    ]);

    expect(result.success).toBe(false);

    // The critical atomicity check: the DB shows ZERO committed rows, not
    // four (the ones that would have "succeeded" if written independently).
    // All-or-nothing -- here, nothing.
    expect(committedRows).toHaveLength(0);
    expect(committedRows.find((row) => row.discipline === "design")).toBeUndefined();
    expect(committedRows.find((row) => row.discipline === "development")).toBeUndefined();
    expect(committedRows.find((row) => row.discipline === "content_seo")).toBeUndefined();
    expect(committedRows.find((row) => row.discipline === "pm")).toBeUndefined();

    // Confirms the failure came from a single batched call, not five
    // sequential per-discipline calls (which would make partial commits
    // possible in the first place).
    expect(upsertCallCount).toBe(1);
  });

  it("test_AS_080_a_later_successful_call_still_writes_only_when_the_whole_batch_is_clean", async () => {
    const { setDisciplineEstimatesBulk } = await import(
      "@/lib/actions/architecture/estimates"
    );

    // Sanity companion to the failure case: an all-clean batch commits
    // every row in the one call, proving the fake store's "all or nothing"
    // semantics work correctly in both directions.
    const result = await setDisciplineEstimatesBulk(TASK_ID, [
      { discipline: "design", input: "1h" },
      { discipline: "development", input: "2h 30m" },
    ]);

    expect(result.success).toBe(true);
    expect(committedRows).toHaveLength(2);
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

  it("test_AS_080_a_mid_batch_failure_including_a_clear_entry_leaves_no_partial_state", async () => {
    const { setDisciplineEstimatesBulk } = await import(
      "@/lib/actions/architecture/estimates"
    );

    // F073: clearing a discipline is now represented as a minutes: null row
    // in the SAME upsert batch, not a separate delete() call. This exercises
    // that branch: a batch mixing a "clear" (empty input -> minutes: null)
    // and a "set" entry with the failing discipline. If cleared rows were
    // still handled by a separate delete() call, a failure in the upsert
    // portion could leave the delete already committed -- partial state.
    // With everything folded into one upsert() call, the whole batch (clear
    // included) must roll back together.
    const result = await setDisciplineEstimatesBulk(TASK_ID, [
      { discipline: "design", input: "" }, // clear
      { discipline: "development", input: "2h" },
      { discipline: FAILING_DISCIPLINE, input: "1h" },
    ]);

    expect(result.success).toBe(false);
    expect(committedRows).toHaveLength(0);
    expect(committedRows.find((row) => row.discipline === "design")).toBeUndefined();
    expect(committedRows.find((row) => row.discipline === "development")).toBeUndefined();
    // Exactly one upsert call carried all three rows (including the clear
    // row), proving there was no separate delete() call to roll back
    // independently of the upsert.
    expect(upsertCallCount).toBe(1);
  });

  it("test_AS_080_a_clear_only_batch_commits_the_null_minutes_row_in_one_call", async () => {
    const { setDisciplineEstimatesBulk } = await import(
      "@/lib/actions/architecture/estimates"
    );

    const result = await setDisciplineEstimatesBulk(TASK_ID, [
      { discipline: "design", input: "" },
    ]);

    expect(result.success).toBe(true);
    expect(upsertCallCount).toBe(1);
    expect(committedRows).toHaveLength(1);
    expect(committedRows[0]).toMatchObject({ discipline: "design", minutes: null });
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
