// F434-F440: setTaskType refuses a task type that belongs to a DIFFERENT
// workspace than the target task, even for a caller who could otherwise
// edit that task — a cross-tenant taxonomy reference is refused outright
// rather than silently allowed (harmless data-wise since a task type is
// just a label, but still wrong, and cheap to reject explicitly).
//
// Fully mocked, no real Supabase project needed.

import { beforeEach, describe, expect, it, vi } from "vitest";

const CALLER_ID = "caller-user-id";
const TASK_ID = "00000000-0000-4000-8000-000000000001";
const TASK_WORKSPACE_ID = "00000000-0000-4000-8000-000000000002";
const OTHER_WORKSPACE_ID = "00000000-0000-4000-8000-000000000003";
const TASK_TYPE_ID = "00000000-0000-4000-8000-000000000004";

let taskTypeWorkspaceId = TASK_WORKSPACE_ID;
let updateCalled = false;

const adminFromMock = vi.fn((table: string) => {
  if (table === "tasks") {
    return {
      select: () => ({
        eq: () => ({
          is: () => ({
            maybeSingle: async () => ({
              data: {
                id: TASK_ID,
                deleted_at: null,
                projects: { workspace_id: TASK_WORKSPACE_ID },
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
              maybeSingle: async () => ({ data: { role: "member" }, error: null }),
            }),
          }),
        }),
      }),
    };
  }
  if (table === "task_types") {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { workspace_id: taskTypeWorkspaceId },
            error: null,
          }),
        }),
      }),
    };
  }
  throw new Error(`Unexpected table in test mock: ${table}`);
});

const fakeAdminClient = { from: adminFromMock };

const supabaseUpdateMock = vi.fn(() => ({
  eq: async () => {
    updateCalled = true;
    return { error: null };
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => fakeAdminClient,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: CALLER_ID } } }),
    },
    from: (table: string) => {
      if (table === "tasks") return { update: supabaseUpdateMock };
      throw new Error(`Unexpected table: ${table}`);
    },
  }),
}));

describe("setTaskType: cross-workspace task type guard", () => {
  beforeEach(() => {
    adminFromMock.mockClear();
    supabaseUpdateMock.mockClear();
    updateCalled = false;
    taskTypeWorkspaceId = TASK_WORKSPACE_ID;
  });

  it("refuses a task type belonging to a different workspace than the task", async () => {
    taskTypeWorkspaceId = OTHER_WORKSPACE_ID;

    const { setTaskType } = await import("@/lib/actions/task-types");
    const result = await setTaskType({ taskId: TASK_ID, taskTypeId: TASK_TYPE_ID });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/not found/i);
    }
    expect(updateCalled).toBe(false);
  });

  it("succeeds when the task type belongs to the task's own workspace", async () => {
    taskTypeWorkspaceId = TASK_WORKSPACE_ID;

    const { setTaskType } = await import("@/lib/actions/task-types");
    const result = await setTaskType({ taskId: TASK_ID, taskTypeId: TASK_TYPE_ID });

    expect(result.ok).toBe(true);
    expect(updateCalled).toBe(true);
  });

  // F116 (AS-058): task_type_id is required — setTaskTypeSchema no
  // longer accepts null, so this parses to a validation error rather
  // than reaching the cross-workspace check at all.
  it("rejects clearing a task's type to null now that a type is required", async () => {
    const { setTaskType } = await import("@/lib/actions/task-types");
    const result = await setTaskType({ taskId: TASK_ID, taskTypeId: null });

    expect(result.ok).toBe(false);
    expect(updateCalled).toBe(false);
  });
});
