// F020 (missions/20260919-150607): when a discipline estimate is cleared,
// the note stored alongside it must be cleared too.
//
// F075 (AS-082/F023): the singular `clearDisciplineEstimate` action (which
// used to `.delete()` the whole row) was removed. F073 folded "clear" into
// `setDisciplineEstimatesBulk`: a clear entry (empty input) is sent as a row
// with `minutes: null, note: null` in the same multi-row `upsert()` call as
// any "set" entries, instead of a separate delete. This suite proves that
// clearing via the bulk path produces a row with `note: null` -- mocking
// only the I/O boundaries (admin client, auth, membership, permissions,
// next/cache), following the module-mock pattern established by
// tests/unit/f060-discipline-estimate-schema.test.tsx and
// tests/unit/f022-atomicity-bulk-estimates.test.ts.
//
// AS-074: Clearing an estimate also clears its note.

import { afterEach, describe, expect, it, vi } from "vitest";

const TASK_ID = "c6d92920-fa93-408d-91cb-87cb907b3fec";
const PROJECT_ID = "83a351f8-6762-498d-8c6e-a1683703c6f1";
const WORKSPACE_ID = "73b61885-e883-48cb-b7fa-6477238ffc00";
const USER_ID = "01c5bd9a-c1da-41a4-ac0e-a4fab320a32a";

let upsertCalls: Array<{ payload: Array<Record<string, unknown>>; options: unknown }> = [];

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/observability/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/activity/audit", () => ({
  writeAudit: vi.fn(),
}));

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: async () => ({
    user: { id: USER_ID },
    supabase: { fake: "session-client" },
  }),
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
          upsert: async (payload: Array<Record<string, unknown>>, options: unknown) => {
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
  vi.clearAllMocks();
});

describe("F020 — clearing a discipline estimate also clears its note (AS-074)", () => {
  it("test_AS_074_clearing_via_bulk_upsert_produces_a_row_with_a_null_note", async () => {
    const { setDisciplineEstimatesBulk } = await import(
      "@/lib/actions/architecture/estimates"
    );

    // An empty `input` is how the popover/action represents "clear this
    // discipline's estimate" in the bulk path (see setDisciplineEstimatesBulk's
    // handling of `entry.input.trim()`). It must produce a row with both
    // `minutes` and `note` null -- there is no way for a stale note to
    // survive a clear, because the whole row (including its note) is
    // rewritten to null in the same statement.
    const result = await setDisciplineEstimatesBulk(TASK_ID, [
      { discipline: "design", input: "" },
    ]);

    expect(result.success).toBe(true);
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].payload).toMatchObject([
      {
        task_id: TASK_ID,
        project_id: PROJECT_ID,
        discipline: "design",
        minutes: null,
        note: null,
        estimated_by: USER_ID,
      },
    ]);
  });
});
