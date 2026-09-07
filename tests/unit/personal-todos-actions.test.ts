// Consolidation (20261116010000): personal_todos absorbed quick_notes'
// only extra capability -- an optional link to a task or project -- rather
// than keeping two parallel personal-reminder tables. These tests cover
// that createPersonalTodo accepts and persists an optional taskId/projectId,
// mirroring the deleted quick-notes-actions.test.ts coverage for the same
// behaviour now folded into this table.

import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockInsert = vi.fn();
const mockSelectOrderLimit = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: vi.fn(() => ({
      insert: mockInsert,
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            limit: mockSelectOrderLimit,
          })),
        })),
      })),
    })),
  })),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { createPersonalTodo } from "@/lib/actions/personal-todos";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const TASK_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";

describe("createPersonalTodo (task/project linking)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockResolvedValue({ error: null });
    mockSelectOrderLimit.mockResolvedValue({ data: [] });
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  });

  it("test_AS_personal_todos_create_defaults_task_and_project_to_null", async () => {
    const result = await createPersonalTodo({ workspaceId: WORKSPACE_ID, title: "Call the client" });
    expect(result).toEqual({ ok: true });
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        workspace_id: WORKSPACE_ID,
        title: "Call the client",
        task_id: null,
        project_id: null,
      }),
    );
  });

  it("test_AS_personal_todos_create_can_optionally_reference_a_task", async () => {
    const result = await createPersonalTodo({
      workspaceId: WORKSPACE_ID,
      title: "Follow up before demo",
      taskId: TASK_ID,
    });
    expect(result).toEqual({ ok: true });
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ task_id: TASK_ID, project_id: null }),
    );
  });

  it("test_AS_personal_todos_create_can_optionally_reference_a_project", async () => {
    const result = await createPersonalTodo({
      workspaceId: WORKSPACE_ID,
      title: "Check billing settings",
      projectId: PROJECT_ID,
    });
    expect(result).toEqual({ ok: true });
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ task_id: null, project_id: PROJECT_ID }),
    );
  });

  it("test_AS_personal_todos_create_rejects_an_invalid_task_id", async () => {
    const result = await createPersonalTodo({
      workspaceId: WORKSPACE_ID,
      title: "Bad link",
      taskId: "not-a-uuid",
    });
    expect(result.ok).toBe(false);
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
