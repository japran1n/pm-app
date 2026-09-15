// @vitest-environment jsdom
//
// F003 (AS-005, AS-006): TaskDetailSheet's status Select updates its badge/
// value the instant a new status is chosen — before moveTaskStatus's server
// round trip resolves (AS-005) — and reverts, with an error toast naming
// the target status, if the server rejects the change (AS-006).
//
// Mounts the real <Board> the same way
// tests/unit/f246-task-detail-sheet-copy-link.test.tsx does (Radix Sheet
// only portals its content when actually open). The real
// components/ui/select.tsx wraps @base-ui/react's pointer-event-driven
// combobox, which jsdom cannot reliably drive (same constraint documented
// in tests/unit/list-priority-select-optimistic.test.tsx and
// tests/unit/f325-board-toolbar-groupby-none.test.tsx) — so, following
// list-priority-select-optimistic.test.tsx's own established pattern, this
// replaces <Select>/<SelectTrigger>/<SelectContent>/<SelectItem> with a bare
// native <select>, wired to the same value/onValueChange contract, to
// exercise TaskDetailSheet's REAL handleStatusChange through a real DOM
// change event.

import { createElement, Fragment, type ReactNode } from "react";
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

let latestValue: string | undefined;
let latestOnValueChange: ((value: string | null) => void) | null = null;
let latestId: string | undefined;
let latestDisabled: boolean | undefined;

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value: string;
    onValueChange: (value: string | null) => void;
    disabled?: boolean;
    children: ReactNode;
  }) => {
    latestValue = value;
    latestOnValueChange = onValueChange;
    latestDisabled = disabled;
    return createElement(Fragment, null, children);
  },
  SelectTrigger: ({ id, children }: { id?: string; children: ReactNode }) => {
    latestId = id;
    return createElement(Fragment, null, children);
  },
  SelectContent: ({ children }: { children: ReactNode }) => {
    // Snapshot the enclosing Select/SelectTrigger's props at THIS render —
    // several <Select> instances exist in the tree simultaneously (the
    // board's group-by dropdown, this Status select, the Priority select),
    // all sharing the same module-level `latest*` variables set just
    // before each one's own SelectContent renders. The onChange closure
    // below must close over a per-instance snapshot, not the live mutable
    // variable, or every rendered <select>'s onChange would fire whichever
    // Select happened to render LAST in the whole tree instead of its own.
    const onValueChange = latestOnValueChange;
    const id = latestId;
    const disabled = latestDisabled;
    const value = latestValue;
    return createElement(
      "select",
      {
        id,
        disabled,
        value,
        onChange: (e: { target: { value: string } }) =>
          onValueChange?.(e.target.value),
      },
      children,
    );
  },
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) =>
    createElement("option", { value }, children),
  SelectValue: () => null,
}));

// Resolved manually per-test so the "instant" optimistic update can be
// observed BEFORE the server call settles.
let resolveMoveTaskStatus: ((value: unknown) => void) | null = null;
const moveTaskStatus = vi.fn(
  (_taskId: string, _status: string) =>
    new Promise((resolve) => {
      resolveMoveTaskStatus = resolve;
    }),
);

vi.mock("@/lib/actions/tasks", () => ({
  moveAndReorderTask: vi.fn(async () => ({ ok: true, data: {} })),
  reorderTask: vi.fn(async () => ({ ok: true, data: {} })),
  createTask: vi.fn(async () => ({ ok: true, data: {} })),
  moveTaskStatus: (taskId: string, status: string) =>
    moveTaskStatus(taskId, status),
  getOpenBlockers: vi.fn(async () => ({ ok: true, data: [] })),
  getTaskDetail: vi.fn(async (taskId: string) => ({
    ok: true,
    data: {
      task: {
        id: taskId,
        title: "Status task",
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
  resolveMoveTaskStatus = null;
});

const TASKS: TaskCardTask[] = [
  {
    id: "t1",
    title: "Status task",
    status: "todo",
    priority: null,
    assigneeId: null,
    dueDate: null,
    position: 1000,
  },
];

async function openSheetAndGetStatusSelect(
  // F1 (status-sitemap-audit mission, AS-4): optional real per-project
  // columns — omitted (every existing test in this file) falls back to
  // Board's own DEFAULT_COLUMNS (the legacy todo/in_progress/in_review/
  // done four, unaffected by this feature), so this file's mocked native
  // <select>'s literal "todo"/"done"/"in_progress" option values keep
  // working unchanged.
  columns?: {
    id: string;
    name: string;
    color: string;
    category: "not_started" | "in_progress" | "done";
    position: number;
  }[],
) {
  render(
    createElement(Board, {
      projectId: "project-1",
      initialTasks: TASKS,
      timezone: "UTC",
      columns,
    }),
  );

  await waitFor(() => expect(getTaskDetail).toHaveBeenCalledWith("t1"));
  await waitFor(() =>
    expect(
      screen.getByDisplayValue("Status task", { exact: false }),
    ).toBeInTheDocument(),
  );

  return screen.getByLabelText("Status") as HTMLSelectElement;
}

describe("TaskDetailSheet status Select optimistic update (F003, AS-005, AS-006)", () => {
  it("test_AS_005_status_updates_immediately_before_the_server_responds", async () => {
    const statusSelect = await openSheetAndGetStatusSelect();
    expect(statusSelect.value).toBe("todo");

    fireEvent.change(statusSelect, { target: { value: "done" } });

    // Assert the optimistic value is applied before moveTaskStatus's
    // promise has resolved at all (resolveMoveTaskStatus hasn't been
    // called yet — this proves the update did not wait on the server).
    await waitFor(() => expect(statusSelect.value).toBe("done"));
    expect(moveTaskStatus).toHaveBeenCalledWith("t1", "done");
    expect(resolveMoveTaskStatus).not.toBeNull();

    // F023: the badge must NOT snap back to the stale "todo" value once
    // this transition settles after a SUCCESSFUL save — it must stay on
    // the new "done" value until the caller's own refetch/realtime path
    // catches up (which this test never triggers).
    resolveMoveTaskStatus?.({ ok: true, data: { status: "done" } });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Status updated."));
    expect(statusSelect.value).toBe("done");
  });

  // F024: after a FIRST successful save commits `confirmedStatus`, a SECOND
  // change in the same open sheet must still be reflected immediately — the
  // stale confirmed mirror from the first save must not mask the new
  // optimistic value while the second save's own request is in flight.
  it("test_AS_005_second_status_change_after_a_successful_first_change_updates_immediately", async () => {
    const statusSelect = await openSheetAndGetStatusSelect();

    fireEvent.change(statusSelect, { target: { value: "done" } });
    await waitFor(() => expect(statusSelect.value).toBe("done"));
    resolveMoveTaskStatus?.({ ok: true, data: { status: "done" } });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Status updated."));
    expect(statusSelect.value).toBe("done");

    fireEvent.change(statusSelect, { target: { value: "in_progress" } });

    // Must reflect the SECOND change immediately, not stay pinned on the
    // first change's confirmed "done" value while this second save is
    // still in flight.
    await waitFor(() => expect(statusSelect.value).toBe("in_progress"));
    expect(resolveMoveTaskStatus).not.toBeNull();

    resolveMoveTaskStatus?.({ ok: true, data: { status: "in_progress" } });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Status updated."),
    );
    expect(statusSelect.value).toBe("in_progress");
  });

  it("test_AS_006_status_reverts_and_shows_an_error_toast_on_server_failure", async () => {
    const statusSelect = await openSheetAndGetStatusSelect();

    fireEvent.change(statusSelect, { target: { value: "in_progress" } });

    await waitFor(() => expect(statusSelect.value).toBe("in_progress"));

    resolveMoveTaskStatus?.({ ok: false, error: "Network error" });

    await waitFor(() => expect(statusSelect.value).toBe("todo"));
    // F1 (status-sitemap-audit mission): the failure toast's label now
    // resolves through the SAME shared `lib/task-colors.ts` STATUS_LABELS
    // (via `resolvedStatusOptions`/`statusOptionByValue`) every other
    // status surface already uses, instead of this file's own separate,
    // inconsistently-capitalized local copy ("In progress" vs "In
    // Progress") — see the audit's own note on this exact drift.
    expect(toastError).toHaveBeenCalledWith(
      "Failed to set status to In Progress",
    );
  });

  // F013 (AS-006): a thrown rejection (network loss, 500, serialization
  // error) must revert + toast exactly like an `{ ok: false }` return —
  // not just be silently swallowed.
  it("test_AS_006_status_reverts_and_shows_an_error_toast_when_server_action_throws", async () => {
    // The base (server) status starts at "in_progress" — a different
    // value than the one we change to below — so the revert assertion
    // can only pass if the revert logic actually runs it back to this
    // starting value. Starting and asserting at the same value would
    // pass trivially even if the revert code were deleted.
    (getTaskDetail as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (taskId: string) => ({
        ok: true,
        data: {
          task: {
            id: taskId,
            title: "Status task",
            description: null,
            status: "in_progress",
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
      }),
    );

    const statusSelect = await openSheetAndGetStatusSelect();
    expect(statusSelect.value).toBe("in_progress");

    moveTaskStatus.mockImplementationOnce(() =>
      Promise.reject(new Error("network")),
    );

    fireEvent.change(statusSelect, { target: { value: "done" } });
    await waitFor(() => expect(statusSelect.value).toBe("done"));

    await waitFor(() => expect(statusSelect.value).toBe("in_progress"));
    expect(toastError).toHaveBeenCalledWith(
      "Failed to set status to Done",
    );
  });

  // F1 (status-sitemap-audit mission, AS-4): with the board's REAL
  // per-project columns passed (not the DEFAULT_COLUMNS legacy
  // four-value fallback every test above exercises), the status Select
  // offers those real names — proven by successfully changing to one, a
  // literal a project's own custom column set would actually contain and
  // the dead legacy STATUS_LABELS map never did.
  it("test_AS_4_status_select_offers_the_boards_real_per_project_columns_not_the_legacy_four", async () => {
    (getTaskDetail as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (taskId: string) => ({
        ok: true,
        data: {
          task: {
            id: taskId,
            title: "Status task",
            description: null,
            status: "To Do",
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
      }),
    );

    const statusSelect = await openSheetAndGetStatusSelect([
      { id: "col-1", name: "To Do", color: "#64748b", category: "not_started", position: 1000 },
      { id: "col-2", name: "In Design", color: "#7c3aed", category: "in_progress", position: 2000 },
      { id: "col-3", name: "Completed", color: "#16a34a", category: "done", position: 3000 },
    ]);
    expect(statusSelect.value).toBe("To Do");

    fireEvent.change(statusSelect, { target: { value: "In Design" } });

    await waitFor(() => expect(statusSelect.value).toBe("In Design"));
    expect(moveTaskStatus).toHaveBeenCalledWith("t1", "In Design");
  });
});
