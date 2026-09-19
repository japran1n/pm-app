// F060 (missions/20260919-150607): the integration test at
// tests/integration/f017-new-discipline-estimates.test.ts required a real
// local Supabase instance (127.0.0.1:54321) to run its beforeAll seed step.
// That instance is never running in the CI/worker test environment, so
// every one of its five `it` blocks silently skipped via
// `describe.skipIf(!haveAdminCreds)` -- AS-060/061/062 have never actually
// executed. This file replaces that integration test with a fully mocked
// unit test, following the module-mock pattern established by
// tests/unit/f011-work-category-unify.test.ts and
// components/architecture/discipline-estimate-popover.test.tsx: mock every
// I/O boundary (`@/lib/supabase/admin`, `@/lib/auth/current-user`,
// `@/lib/auth/require-membership`, `next/cache`) and exercise the real
// `setDisciplineEstimate` action + the real `workCategorySchema` /
// `setDisciplineEstimateSchema` validation it calls into.
//
// AS-060: setDisciplineEstimate writes a task_discipline_estimates row via
//         the correct schema path (task_id/project_id/discipline/minutes/
//         note/estimated_by) for discipline "content_seo".
// AS-061: the same holds for discipline "pm".
// AS-062: the same holds for discipline "qa".

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  workCategorySchema,
  WORK_CATEGORIES,
} from "@/lib/validation/time-entries";
import { setDisciplineEstimateSchema } from "@/lib/validation/architecture";

const TASK_ID = "c6d92920-fa93-408d-91cb-87cb907b3fec";
const PROJECT_ID = "83a351f8-6762-498d-8c6e-a1683703c6f1";
const WORKSPACE_ID = "73b61885-e883-48cb-b7fa-6477238ffc00";
const USER_ID = "01c5bd9a-c1da-41a4-ac0e-a4fab320a32a";

// Captures every payload passed to `.upsert()` on
// task_discipline_estimates so assertions can inspect exactly what
// setDisciplineEstimate tried to write, without touching a real database.
let upsertCalls: Array<{ payload: unknown; options: unknown }> = [];

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/observability/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: async () => ({ user: { id: USER_ID } }),
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
  vi.clearAllMocks();
});

describe("F060 — discipline estimate schema round trip for content_seo/pm/qa (AS-060, AS-061, AS-062)", () => {
  it("test_AS_060_content_seo_is_a_valid_work_category_accepted_by_the_estimate_schema", () => {
    expect(WORK_CATEGORIES).toContain("content_seo");
    expect(workCategorySchema.safeParse("content_seo").success).toBe(true);
    expect(
      setDisciplineEstimateSchema.safeParse({
        taskId: TASK_ID,
        discipline: "content_seo",
        input: "1.5h",
        note: "content_seo note",
      }).success,
    ).toBe(true);
  });

  it("test_AS_061_pm_is_a_valid_work_category_accepted_by_the_estimate_schema", () => {
    expect(WORK_CATEGORIES).toContain("pm");
    expect(workCategorySchema.safeParse("pm").success).toBe(true);
    expect(
      setDisciplineEstimateSchema.safeParse({
        taskId: TASK_ID,
        discipline: "pm",
        input: "45m",
        note: "pm note",
      }).success,
    ).toBe(true);
  });

  it("test_AS_062_qa_is_a_valid_work_category_accepted_by_the_estimate_schema", () => {
    expect(WORK_CATEGORIES).toContain("qa");
    expect(workCategorySchema.safeParse("qa").success).toBe(true);
    expect(
      setDisciplineEstimateSchema.safeParse({
        taskId: TASK_ID,
        discipline: "qa",
        input: "2h",
        note: "qa note",
      }).success,
    ).toBe(true);
  });

  it("test_AS_060_setDisciplineEstimate_writes_content_seo_via_the_correct_schema_path", async () => {
    const { setDisciplineEstimate } = await import(
      "@/lib/actions/architecture/estimates"
    );

    const result = await setDisciplineEstimate(
      TASK_ID,
      "content_seo",
      "1.5h",
      "content_seo note",
    );

    expect(result.success).toBe(true);
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].payload).toMatchObject({
      task_id: TASK_ID,
      project_id: PROJECT_ID,
      discipline: "content_seo",
      minutes: 90,
      note: "content_seo note",
      estimated_by: USER_ID,
    });
    expect(upsertCalls[0].options).toMatchObject({
      onConflict: "task_id,discipline",
    });
  });

  it("test_AS_061_setDisciplineEstimate_writes_pm_via_the_correct_schema_path", async () => {
    const { setDisciplineEstimate } = await import(
      "@/lib/actions/architecture/estimates"
    );

    const result = await setDisciplineEstimate(TASK_ID, "pm", "45m", "pm note");

    expect(result.success).toBe(true);
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].payload).toMatchObject({
      task_id: TASK_ID,
      project_id: PROJECT_ID,
      discipline: "pm",
      minutes: 45,
      note: "pm note",
      estimated_by: USER_ID,
    });
  });

  it("test_AS_062_setDisciplineEstimate_writes_qa_via_the_correct_schema_path", async () => {
    const { setDisciplineEstimate } = await import(
      "@/lib/actions/architecture/estimates"
    );

    const result = await setDisciplineEstimate(TASK_ID, "qa", "2h", "qa note");

    expect(result.success).toBe(true);
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].payload).toMatchObject({
      task_id: TASK_ID,
      project_id: PROJECT_ID,
      discipline: "qa",
      minutes: 120,
      note: "qa note",
      estimated_by: USER_ID,
    });
  });

  it("test_AS_060_AS_061_AS_062_an_invalid_discipline_is_rejected_before_any_write", async () => {
    const { setDisciplineEstimate } = await import(
      "@/lib/actions/architecture/estimates"
    );

    const result = await setDisciplineEstimate(
      TASK_ID,
      "not-a-real-discipline",
      "1h",
    );

    expect(result.success).toBe(false);
    expect(upsertCalls).toHaveLength(0);
  });
});
