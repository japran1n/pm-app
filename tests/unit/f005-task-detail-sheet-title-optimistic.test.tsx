// @vitest-environment jsdom
//
// F005 (AS-009, AS-010, AS-011): TaskDetailSheet's title field shows a
// pending indicator while its save is in flight (AS-009), reverts to its
// pre-edit value with an error toast on server failure (AS-010), and
// commits inline on blur/Enter without any separate dialog (AS-011).
//
// Mounts the real <Board> the same way
// tests/unit/f246-task-detail-sheet-copy-link.test.tsx and
// tests/unit/f003-task-detail-sheet-status-optimistic.test.tsx do (Radix
// Sheet only portals its content when actually open) and drives real DOM
// events against the title <input>.

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
// Audit fix: TaskDetailSheet unconditionally mounts CustomFieldsSection
// and PageLinksEditor, both of which call a server action on mount
// (getCustomFieldsForTaskAction / getPageLinksForTaskAction). Those
// actions reach lib/supabase/server.ts's createClient(), which calls
// next/headers's cookies() outside a request scope in Vitest and rejects
// asynchronously, after this file's own assertions have already run --
// an unhandled rejection attributed to whichever file happens to be
// mid-flight, unrelated to what this file actually tests. Mock both
// action modules the same way sibling tests already mock
// @/lib/actions/tasks etc.
vi.mock("@/lib/actions/custom-fields", () => ({
  getCustomFieldsForTaskAction: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  setTaskCustomFieldValue: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@/lib/actions/page-links", () => ({
  getPageLinksForTaskAction: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  createPageLink: vi.fn(),
  updatePageLink: vi.fn(),
  deletePageLink: vi.fn(),
}));


process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "test-publishable-key";

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}));

// Resolved manually per-test so the pending state can be observed BEFORE
// the server call settles, same convention as F003's own moveTaskStatus
// mock.
let resolveEditTask: ((value: unknown) => void) | null = null;
const editTask = vi.fn(
  (_taskId: string, _updates: unknown) =>
    new Promise((resolve) => {
      resolveEditTask = resolve;
    }),
);

vi.mock("@/lib/actions/tasks", () => ({
  moveAndReorderTask: vi.fn(async () => ({ ok: true, data: {} })),
  reorderTask: vi.fn(async () => ({ ok: true, data: {} })),
  createTask: vi.fn(async () => ({ ok: true, data: {} })),
  editTask: (taskId: string, updates: unknown) => editTask(taskId, updates),
  getTaskDetail: vi.fn(async (taskId: string) => ({
    ok: true,
    data: {
      task: {
        id: taskId,
        title: "Original title",
        description: null,
        status: "todo",
        priority: null,
        assigneeId: null,
        dueDate: null,
        tags: [],
      },
      comments: [],
      attachments: [],
      currentUserId: "user-1",
      currentUserRole: "member",
    },
  })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/w/acme/projects/proj-1/board",
  useSearchParams: () => new URLSearchParams("taskId=t1"),
}));

vi.mock("@/lib/actions/comments", () => ({
  getMentionCandidates: vi.fn(async () => ({ ok: true, data: [] })),
}));

import { Board } from "@/components/board/board";
import { getTaskDetail } from "@/lib/actions/tasks";
import type { TaskCardTask } from "@/components/task/task-card";


// Realtime: mock the Supabase browser client so mounting this component
// never opens a real WebSocket. jsdom's undici-based WebSocket polyfill
// throws "TypeError: The \"event\" argument must be an instance of Event"
// against a live connection (see vitest.config.ts's own comment on why
// jsdom is opt-in per file), which escapes as an unhandled exception
// outside any test and fails the process even though every test passes.
// Same "channel().on().subscribe()" fake shape as
// tests/unit/f022-board-realtime-guard-call-site.test.tsx.
function makeFakeSupabaseRealtimeClient() {
  const channelObject = {
    on: vi.fn(() => channelObject),
    subscribe: vi.fn(() => channelObject),
  };
  return {
    channel: vi.fn(() => channelObject),
    removeChannel: vi.fn(),
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null } })),
    },
  };
}
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => makeFakeSupabaseRealtimeClient(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  resolveEditTask = null;
});

const TASKS: TaskCardTask[] = [
  {
    id: "t1",
    title: "Original title",
    status: "todo",
    priority: null,
    assigneeId: null,
    dueDate: null,
    position: 1000,
  },
];

async function openSheetAndGetTitleInput() {
  render(
    createElement(Board, {
      projectId: "project-1",
      initialTasks: TASKS,
      timezone: "UTC",
    }),
  );

  await waitFor(() => expect(getTaskDetail).toHaveBeenCalledWith("t1"));
  await waitFor(() =>
    expect(
      screen.getByDisplayValue("Original title", { exact: false }),
    ).toBeInTheDocument(),
  );

  return screen.getByLabelText("Title") as HTMLInputElement;
}

describe("TaskDetailSheet title optimistic save (F005, AS-009, AS-010, AS-011)", () => {
  it("test_AS_009_pending_indicator_appears_while_the_title_save_is_in_flight", async () => {
    const titleInput = await openSheetAndGetTitleInput();

    expect(screen.queryByTestId("title-saving-indicator")).not.toBeInTheDocument();

    fireEvent.change(titleInput, { target: { value: "Updated title" } });
    fireEvent.blur(titleInput);

    expect(editTask).toHaveBeenCalledWith("t1", { title: "Updated title" });

    await waitFor(() =>
      expect(screen.getByTestId("title-saving-indicator")).toBeInTheDocument(),
    );

    resolveEditTask?.({ ok: true, data: { title: "Updated title" } });

    // Default `waitFor` budget (1000ms) is tight enough that it has been
    // observed to flake ONLY inside the full CI suite run (never in
    // isolation, and never on a dev machine) — `vitest.config.ts` runs the
    // full suite with `maxWorkers: 4`, and under that contention a
    // legitimate (already-resolved) React state flush can occasionally
    // take longer than 1000ms to actually commit and be observed by
    // `waitFor`'s polling. Widened budget only, same shape as F320's fix
    // to tests/integration/reaction-realtime-delivery.test.ts — the
    // assertion itself (indicator must disappear, toast must fire) is
    // unchanged.
    await waitFor(
      () =>
        expect(screen.queryByTestId("title-saving-indicator")).not.toBeInTheDocument(),
      { timeout: 5000 },
    );
    expect(toastSuccess).toHaveBeenCalledWith("Title updated.");
  });

  it("test_AS_010_title_reverts_to_its_pre_edit_value_and_shows_an_error_toast_on_server_failure", async () => {
    const titleInput = await openSheetAndGetTitleInput();

    fireEvent.change(titleInput, { target: { value: "Broken edit" } });
    fireEvent.blur(titleInput);

    await waitFor(() => expect(titleInput.value).toBe("Broken edit"));

    resolveEditTask?.({ ok: false, error: "Server rejected the title." });

    await waitFor(() => expect(titleInput.value).toBe("Original title"));
    expect(toastError).toHaveBeenCalledWith("Server rejected the title.");
  });

  it("test_AS_011_enter_commits_the_title_edit_inline_without_a_dialog", async () => {
    const titleInput = await openSheetAndGetTitleInput();

    titleInput.focus();
    fireEvent.change(titleInput, { target: { value: "Committed via Enter" } });
    fireEvent.keyDown(titleInput, { key: "Enter" });

    await waitFor(() =>
      expect(editTask).toHaveBeenCalledWith("t1", { title: "Committed via Enter" }),
    );

    resolveEditTask?.({ ok: true, data: { title: "Committed via Enter" } });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Title updated."));
  });

  it("test_AS_010_title_reverts_and_shows_error_toast_when_the_save_throws_instead_of_rejecting", async () => {
    editTask.mockImplementationOnce(() =>
      Promise.reject(new Error("network")),
    );

    const titleInput = await openSheetAndGetTitleInput();

    fireEvent.change(titleInput, { target: { value: "Broken edit" } });
    fireEvent.blur(titleInput);

    await waitFor(() => expect(titleInput.value).toBe("Original title"));
    expect(toastError).toHaveBeenCalledWith("Failed to save title");
  });

  it("test_AS_011_escape_cancels_the_edit_and_reverts_without_saving", async () => {
    const titleInput = await openSheetAndGetTitleInput();

    titleInput.focus();
    fireEvent.change(titleInput, { target: { value: "Discard me" } });
    fireEvent.keyDown(titleInput, { key: "Escape" });

    expect(titleInput.value).toBe("Original title");
    fireEvent.blur(titleInput);

    expect(editTask).not.toHaveBeenCalled();
  });
});
