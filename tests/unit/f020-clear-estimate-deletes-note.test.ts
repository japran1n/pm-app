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

vi.mock("@/lib/actions/architecture/authorize", async () =>
  (await import("../helpers/architecture-authorize-mock")).architectureAuthorizeMock({
    workspaceFor: () => "ws-1",
  }),
);

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

    // AS-074 falsifiability: the clear entry below carries a non-empty
    // `note`. If estimates.ts:91's clear-branch push ever changed from
    // `note: null` to `note: entry.note ?? null`, this note would survive
    // the clear (since `entry.note` is truthy here, not undefined), and the
    // assertion below would fail. A clear entry with no `note` key at all
    // cannot detect this bug, because `entry.note ?? null` evaluates to
    // `null` regardless when `entry.note` is undefined.
    const result = await setDisciplineEstimatesBulk(TASK_ID, [
      {
        discipline: "design",
        input: "",
        note: "stale note that must not survive",
      },
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

  it("test_AS_074_clear_with_note_and_set_with_note_in_same_bulk_call_are_independent", async () => {
    const { setDisciplineEstimatesBulk } = await import(
      "@/lib/actions/architecture/estimates"
    );

    // Mixed batch: a "clear" entry (empty input) carrying a stale note, and
    // a "set" entry (non-empty input) carrying a note that must be kept.
    // Proves the clear branch nulls its note independently of the set
    // branch, which is expected to preserve its note via `entry.note ?? null`.
    const result = await setDisciplineEstimatesBulk(TASK_ID, [
      {
        discipline: "design",
        input: "",
        note: "stale note that must not survive",
      },
      {
        discipline: "development",
        input: "2h",
        note: "keep this note",
      },
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
      {
        task_id: TASK_ID,
        project_id: PROJECT_ID,
        discipline: "development",
        minutes: 120,
        note: "keep this note",
        estimated_by: USER_ID,
      },
    ]);
  });
});
