// Unit tests for F020 (TT-051: creating a task persists all fields
// including estimate and billable). Fully mocked, no real Supabase project
// needed — mirrors tests/unit/set-task-type-cross-workspace-guard.test.ts's
// "chainable fake admin client" pattern.
//
// Two levels covered here:
//   1. createTaskSchema (lib/validation/tasks.ts) accepts and passes through
//      startDate, estimateMinutes, tags, billable.
//   2. createTaskForUser (lib/tasks/create.ts) writes those parsed values
//      onto the actual `tasks` insert payload, and returns them on the
//      created task.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTaskSchema } from "@/lib/validation/tasks";

const PROJECT_ID = "00000000-0000-4000-8000-000000000010";
const WORKSPACE_ID = "00000000-0000-4000-8000-000000000011";
const USER_ID = "00000000-0000-4000-8000-000000000012";
const TASK_TYPE_ID = "00000000-0000-4000-8000-000000000013";

let capturedInsertPayload: Record<string, unknown> | null = null;

const adminFromMock = vi.fn((table: string) => {
  if (table === "projects") {
    return {
      select: () => ({
        eq: () => ({
          is: () => ({
            maybeSingle: async () => ({
              data: {
                id: PROJECT_ID,
                workspace_id: WORKSPACE_ID,
                deleted_at: null,
                visibility: "workspace",
              },
              error: null,
            }),
          }),
        }),
      }),
    };
  }
  if (table === "workspace_members") {
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { role: "member" },
                error: null,
              }),
            }),
          }),
        }),
      }),
    };
  }
  if (table === "tasks") {
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            is: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }),
        }),
      }),
      insert: (payload: Record<string, unknown>) => {
        capturedInsertPayload = payload;
        return {
          select: () => ({
            single: async () => ({
              data: {
                id: "new-task-id",
                project_id: PROJECT_ID,
                title: payload.title,
                description: payload.description ?? null,
                status: payload.status,
                priority: payload.priority ?? null,
                assignee_id: payload.assignee_id ?? null,
                due_date: payload.due_date ?? null,
                author_id: USER_ID,
                position: 1000,
                created_at: "2026-09-23T00:00:00Z",
                parent_task_id: payload.parent_task_id ?? null,
                number: 1,
                start_date: payload.start_date ?? null,
                estimate_minutes: payload.estimate_minutes ?? null,
                tags: payload.tags ?? [],
                billable: payload.billable ?? true,
              },
              error: null,
            }),
          }),
        };
      },
    };
  }
  if (table === "project_statuses") {
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { name: "todo" }, error: null }),
          }),
        }),
      }),
    };
  }
  if (table === "workspaces") {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { slug: "acme" }, error: null }),
        }),
      }),
    };
  }
  throw new Error(`Unexpected table in test mock: ${table}`);
});

const fakeAdminClient = {
  from: adminFromMock,
  rpc: async () => ({ data: TASK_TYPE_ID, error: null }),
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => fakeAdminClient,
}));

vi.mock("@/lib/auth/require-membership", () => ({
  requireActiveMembership: async () => ({ ok: true, role: "member" }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

describe("createTaskSchema (F020, TT-051): accepts and passes through the new fields", () => {
  it("test_TT_051_accepts_startDate_estimateMinutes_tags_billable_together", () => {
    const parsed = createTaskSchema.safeParse({
      projectId: PROJECT_ID,
      title: "Ship the feature",
      startDate: "2026-09-01",
      estimateMinutes: 120,
      tags: ["design", "urgent"],
      billable: false,
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.startDate).toBe("2026-09-01");
    expect(parsed.data.estimateMinutes).toBe(120);
    expect(parsed.data.tags).toEqual(["design", "urgent"]);
    expect(parsed.data.billable).toBe(false);
  });

  it("test_TT_051_all_four_fields_optional_omitting_is_valid", () => {
    const parsed = createTaskSchema.safeParse({
      projectId: PROJECT_ID,
      title: "Bare-minimum task",
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.startDate).toBeUndefined();
    expect(parsed.data.estimateMinutes).toBeUndefined();
    expect(parsed.data.tags).toBeUndefined();
    expect(parsed.data.billable).toBeUndefined();
  });

  it("test_TT_051_rejects_start_date_after_due_date", () => {
    const parsed = createTaskSchema.safeParse({
      projectId: PROJECT_ID,
      title: "Bad date order",
      startDate: "2026-09-10",
      dueDate: "2026-09-01",
    });

    expect(parsed.success).toBe(false);
  });

  it("test_TT_051_rejects_non_positive_estimateMinutes", () => {
    const parsed = createTaskSchema.safeParse({
      projectId: PROJECT_ID,
      title: "Bad estimate",
      estimateMinutes: 0,
    });

    expect(parsed.success).toBe(false);
  });

  it("test_TT_051_rejects_empty_string_tag", () => {
    const parsed = createTaskSchema.safeParse({
      projectId: PROJECT_ID,
      title: "Bad tag",
      tags: ["", "ok"],
    });

    expect(parsed.success).toBe(false);
  });
});

describe("createTaskForUser (F020, TT-051): persists the new fields on the actual insert", () => {
  beforeEach(() => {
    adminFromMock.mockClear();
    capturedInsertPayload = null;
  });

  it("test_TT_051_createTaskForUser_persists_startDate_estimate_tags_billable_on_insert", async () => {
    const { createTaskForUser } = await import("@/lib/tasks/create");

    const result = await createTaskForUser(USER_ID, {
      projectId: PROJECT_ID,
      title: "Design the onboarding flow",
      startDate: "2026-09-01",
      estimateMinutes: 90,
      tags: ["design", "onboarding"],
      billable: false,
    });

    expect(result.ok).toBe(true);
    expect(capturedInsertPayload).not.toBeNull();
    expect(capturedInsertPayload?.start_date).toBe("2026-09-01");
    expect(capturedInsertPayload?.estimate_minutes).toBe(90);
    expect(capturedInsertPayload?.tags).toEqual(["design", "onboarding"]);
    expect(capturedInsertPayload?.billable).toBe(false);

    if (result.ok) {
      expect(result.data.startDate).toBe("2026-09-01");
      expect(result.data.estimateMinutes).toBe(90);
      expect(result.data.tags).toEqual(["design", "onboarding"]);
      expect(result.data.billable).toBe(false);
    }
  });

  it("test_TT_051_createTaskForUser_omits_optional_new_fields_when_not_supplied", async () => {
    const { createTaskForUser } = await import("@/lib/tasks/create");

    const result = await createTaskForUser(USER_ID, {
      projectId: PROJECT_ID,
      title: "No optional fields supplied",
    });

    expect(result.ok).toBe(true);
    expect(capturedInsertPayload).not.toBeNull();
    // start_date/estimate_minutes are normalized to explicit null by
    // createTaskForUser's own `input.startDate ?? null` wrapping (same as
    // every other nullable field it forwards to the schema) — writing an
    // explicit NULL has the identical effect on the column as omitting the
    // key entirely, since neither has a non-null DB default. tags/billable
    // are left genuinely absent from the payload (input.tags/.billable stay
    // `undefined` all the way through), so the column's own DB default
    // ('{}' / true) applies untouched.
    expect(capturedInsertPayload?.start_date).toBeNull();
    expect(capturedInsertPayload?.estimate_minutes).toBeNull();
    expect("tags" in (capturedInsertPayload ?? {})).toBe(false);
    expect("billable" in (capturedInsertPayload ?? {})).toBe(false);
  });

  it("test_TT_051_createTaskForUser_persists_billable_true_explicitly", async () => {
    const { createTaskForUser } = await import("@/lib/tasks/create");

    const result = await createTaskForUser(USER_ID, {
      projectId: PROJECT_ID,
      title: "Explicit billable true",
      billable: true,
    });

    expect(result.ok).toBe(true);
    expect(capturedInsertPayload?.billable).toBe(true);
    if (result.ok) {
      expect(result.data.billable).toBe(true);
    }
  });
});
