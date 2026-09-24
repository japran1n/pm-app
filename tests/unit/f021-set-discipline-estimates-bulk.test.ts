// Mission 20260919-150607, F021 (AS-078, AS-079, AS-083, AS-084): the
// discipline estimate popover writes through a single
// `setDisciplineEstimatesBulk` server action instead of looping over
// `setDisciplineEstimate`/`clearDisciplineEstimate` once per discipline.
//
// AS-078: setDisciplineEstimatesBulk exists and is callable with an array of
//         {discipline, input, note} entries for a task.
// AS-079: the popover's handleSaveAll calls it exactly once, not N times
//         (covered by components/architecture/discipline-estimate-popover.test.tsx).
// AS-083: the action validates every entry before making any DB write --
//         one bad entry means zero rows are touched, including entries that
//         would otherwise have succeeded.
// AS-084: setDisciplineEstimatesBulk is exported from the architecture
//         actions barrel (lib/actions/architecture.ts).
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

let upsertCalls: Array<{ payload: unknown; options: unknown }> = [];
const writeAuditSpy = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/observability/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/activity/audit", () => ({
  writeAudit: (...args: unknown[]) => writeAuditSpy(...args),
}));

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: async () => ({ user: { id: USER_ID }, supabase: { fake: "session-client" } }),
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
          upsert: async (payload: unknown, options: unknown) => {
            upsertCalls.push({ payload, options });
            return { error: null };
          },
        };
      }
      throw new Error(`Unexpected table in mock: ${table}`);
    },
  }),
}));

afterEach(() => {
  upsertCalls = [];
  writeAuditSpy.mockClear();
  vi.clearAllMocks();
});

describe("setDisciplineEstimatesBulk (AS-078, AS-083, AS-084)", () => {
  it("test_AS_078_bulk_action_is_callable_and_writes_all_entries_in_one_call", async () => {
    const { setDisciplineEstimatesBulk } = await import(
      "@/lib/actions/architecture/estimates"
    );

    const result = await setDisciplineEstimatesBulk(TASK_ID, [
      { discipline: "design", input: "1h", note: "design note" },
      { discipline: "development", input: "2h 30m" },
      { discipline: "content_seo", input: "45m" },
      { discipline: "pm", input: "30m" },
      { discipline: "qa", input: "1.5h" },
    ]);

    expect(result.success).toBe(true);
    // A single upsert call carrying all five rows -- one DB round trip for
    // the "set" side, not five separate action invocations.
    expect(upsertCalls).toHaveLength(1);
    const payload = upsertCalls[0].payload as Array<Record<string, unknown>>;
    expect(payload).toHaveLength(5);
    expect(payload).toContainEqual(
      expect.objectContaining({
        task_id: TASK_ID,
        project_id: PROJECT_ID,
        discipline: "design",
        minutes: 60,
        note: "design note",
        estimated_by: USER_ID,
      }),
    );
    expect(payload).toContainEqual(
      expect.objectContaining({ discipline: "qa", minutes: 90 }),
    );
  });

  it("test_AS_078_bulk_action_clears_a_discipline_when_input_is_empty", async () => {
    const { setDisciplineEstimatesBulk } = await import(
      "@/lib/actions/architecture/estimates"
    );

    const result = await setDisciplineEstimatesBulk(TASK_ID, [
      { discipline: "design", input: "" },
      { discipline: "development", input: "1h" },
    ]);

    expect(result.success).toBe(true);
    // F073: cleared disciplines are folded into the SAME single upsert call
    // as a minutes: null row -- no separate delete() call at all.
    expect(upsertCalls).toHaveLength(1);
    const payload = upsertCalls[0].payload as Array<Record<string, unknown>>;
    expect(payload).toHaveLength(2);
    expect(payload).toContainEqual(
      expect.objectContaining({ discipline: "design", minutes: null }),
    );
    expect(payload).toContainEqual(
      expect.objectContaining({ discipline: "development", minutes: 60 }),
    );
  });

  it("test_AS_083_an_invalid_entry_blocks_the_entire_batch_before_any_write", async () => {
    const { setDisciplineEstimatesBulk } = await import(
      "@/lib/actions/architecture/estimates"
    );

    // "design" and "development" are perfectly valid; "qa" is garbage. Every
    // entry must be validated before any DB call is made, so the valid
    // entries must NOT have been written either.
    const result = await setDisciplineEstimatesBulk(TASK_ID, [
      { discipline: "design", input: "1h" },
      { discipline: "development", input: "30m" },
      { discipline: "qa", input: "not-a-duration" },
    ]);

    expect(result.success).toBe(false);
    expect(upsertCalls).toHaveLength(0);
  });

  it("test_AS_083_an_invalid_discipline_enum_value_blocks_the_entire_batch_before_any_write", async () => {
    const { setDisciplineEstimatesBulk } = await import(
      "@/lib/actions/architecture/estimates"
    );

    const result = await setDisciplineEstimatesBulk(TASK_ID, [
      { discipline: "design", input: "1h" },
      { discipline: "not-a-real-discipline", input: "1h" },
    ]);

    expect(result.success).toBe(false);
    expect(upsertCalls).toHaveLength(0);
  });

  it("test_AS_083_bulk_write_records_exactly_one_audit_log_entry_not_one_per_discipline", async () => {
    const { setDisciplineEstimatesBulk } = await import(
      "@/lib/actions/architecture/estimates"
    );

    const result = await setDisciplineEstimatesBulk(TASK_ID, [
      { discipline: "design", input: "1h" },
      { discipline: "development", input: "2h" },
      { discipline: "pm", input: "" },
    ]);

    expect(result.success).toBe(true);
    // AS-083: the contract says ONE audit log entry for the whole batch,
    // never one per discipline (which would be 3 calls here).
    expect(writeAuditSpy).toHaveBeenCalledTimes(1);
    expect(writeAuditSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ targetId: TASK_ID, workspaceId: WORKSPACE_ID }),
    );
  });

  it("test_AS_083_rbac_denial_blocks_the_write_with_no_db_call", async () => {
    vi.resetModules();
    vi.doMock("@/lib/auth/permissions", () => ({ canWrite: () => false }));

    const { setDisciplineEstimatesBulk } = await import(
      "@/lib/actions/architecture/estimates"
    );

    const result = await setDisciplineEstimatesBulk(TASK_ID, [
      { discipline: "design", input: "1h" },
    ]);

    expect(result.success).toBe(false);
    expect(upsertCalls).toHaveLength(0);

    vi.doUnmock("@/lib/auth/permissions");
    vi.resetModules();
  });
});

describe("architecture actions barrel (AS-084)", () => {
  it("test_AS_084_setDisciplineEstimatesBulk_is_exported_from_the_barrel", async () => {
    const barrel = await import("@/lib/actions/architecture");

    expect(typeof barrel.setDisciplineEstimatesBulk).toBe("function");
  });
});
