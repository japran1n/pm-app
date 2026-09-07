// Quick notes: unit tests for the createQuickNote / toggleQuickNote /
// deleteQuickNote Server Actions. quick_notes is owner-only (RLS
// `quick_notes_owner_only`, mirroring personal_todos) — these tests assert
// the actions validate input, require sign-in, and write via the
// RLS-respecting client, never bypassing it.

import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockUpdateEq = vi.fn();
const mockDelete = vi.fn();
const mockDeleteEq = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: vi.fn(() => ({
      insert: mockInsert,
      update: mockUpdate,
      delete: mockDelete,
    })),
  })),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import {
  createQuickNote,
  toggleQuickNote,
  deleteQuickNote,
} from "@/lib/actions/quick-notes";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const TASK_ID = "22222222-2222-4222-8222-222222222222";
const NOTE_ID = "33333333-3333-4333-8333-333333333333";

describe("createQuickNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockResolvedValue({ error: null });
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  });

  it("test_AS_quick_notes_create_rejects_empty_text", async () => {
    const result = await createQuickNote({ workspaceId: WORKSPACE_ID, text: "  " });
    expect(result).toEqual({ ok: false, error: "Text is required." });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("test_AS_quick_notes_create_rejects_text_over_280_chars", async () => {
    const result = await createQuickNote({
      workspaceId: WORKSPACE_ID,
      text: "x".repeat(281),
    });
    expect(result.ok).toBe(false);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("test_AS_quick_notes_create_requires_sign_in", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const result = await createQuickNote({ workspaceId: WORKSPACE_ID, text: "Call the client" });
    expect(result.ok).toBe(false);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("test_AS_quick_notes_create_inserts_a_note_owned_by_the_caller", async () => {
    const result = await createQuickNote({ workspaceId: WORKSPACE_ID, text: "Call the client" });
    expect(result).toEqual({ ok: true });
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        workspace_id: WORKSPACE_ID,
        text: "Call the client",
        task_id: null,
        project_id: null,
      }),
    );
  });

  it("test_AS_quick_notes_create_can_optionally_reference_a_task", async () => {
    const result = await createQuickNote({
      workspaceId: WORKSPACE_ID,
      text: "Follow up before demo",
      taskId: TASK_ID,
    });
    expect(result).toEqual({ ok: true });
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ task_id: TASK_ID, project_id: null }),
    );
  });

  it("test_AS_quick_notes_create_surfaces_a_generic_error_on_db_failure", async () => {
    mockInsert.mockResolvedValue({ error: { message: "boom" } });
    const result = await createQuickNote({ workspaceId: WORKSPACE_ID, text: "Call the client" });
    expect(result.ok).toBe(false);
  });
});

describe("toggleQuickNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateEq.mockResolvedValue({ error: null });
    mockUpdate.mockReturnValue({ eq: mockUpdateEq });
  });

  it("test_AS_quick_notes_toggle_rejects_an_invalid_note_id", async () => {
    const result = await toggleQuickNote({ noteId: "not-a-uuid", isDone: true });
    expect(result.ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("test_AS_quick_notes_toggle_marks_the_note_done_and_stamps_completed_at", async () => {
    const result = await toggleQuickNote({ noteId: NOTE_ID, isDone: true });
    expect(result).toEqual({ ok: true });
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ is_done: true, completed_at: expect.any(String) }),
    );
    expect(mockUpdateEq).toHaveBeenCalledWith("id", NOTE_ID);
  });

  it("test_AS_quick_notes_toggle_clears_completed_at_when_un_done", async () => {
    const result = await toggleQuickNote({ noteId: NOTE_ID, isDone: false });
    expect(result).toEqual({ ok: true });
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ is_done: false, completed_at: null }),
    );
  });

  it("test_AS_quick_notes_toggle_surfaces_a_generic_error_on_db_failure", async () => {
    mockUpdateEq.mockResolvedValue({ error: { message: "boom" } });
    const result = await toggleQuickNote({ noteId: NOTE_ID, isDone: true });
    expect(result.ok).toBe(false);
  });
});

describe("deleteQuickNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteEq.mockResolvedValue({ error: null });
    mockDelete.mockReturnValue({ eq: mockDeleteEq });
  });

  it("test_AS_quick_notes_delete_rejects_an_invalid_note_id", async () => {
    const result = await deleteQuickNote({ noteId: "not-a-uuid" });
    expect(result.ok).toBe(false);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("test_AS_quick_notes_delete_removes_the_note", async () => {
    const result = await deleteQuickNote({ noteId: NOTE_ID });
    expect(result).toEqual({ ok: true });
    expect(mockDeleteEq).toHaveBeenCalledWith("id", NOTE_ID);
  });

  it("test_AS_quick_notes_delete_surfaces_a_generic_error_on_db_failure", async () => {
    mockDeleteEq.mockResolvedValue({ error: { message: "boom" } });
    const result = await deleteQuickNote({ noteId: NOTE_ID });
    expect(result.ok).toBe(false);
  });
});
