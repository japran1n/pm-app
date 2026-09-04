// @vitest-environment jsdom
//
// F004 (AS-007, AS-008): TaskDetailSheet's Priority Select updates its
// badge/value the instant a new priority is chosen — before editTask's
// server round trip resolves (AS-007) — and reverts, with an error toast
// naming the target priority, if the server rejects the change (AS-008).
//
// Mirrors tests/unit/f003-task-detail-sheet-status-optimistic.test.tsx's
// own pattern exactly (see that file's doc comment for the full rationale
// behind mounting the real <Board> and mocking @/components/ui/select with
// a bare native <select>).

import { createElement, Fragment, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

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
    // Snapshot at THIS render — several <Select> instances share the same
    // module-level `latest*` variables (board's group-by, this Priority
    // select, the sheet's own Status select) — see F003's own test for the
    // full explanation of why a per-instance snapshot is required.
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
  // F018: previously `() => null`, which made every displayed-text
  // assertion trivially pass (or trivially never find "high") regardless
  // of what value the Select was actually bound to. Now it renders the
  // real render-prop `children` function against the *current* `latestValue`
  // snapshot at THIS render (same per-instance-snapshot rationale as
  // SelectContent above), so a query for visible "No priority" text is a
  // genuine assertion on the production value binding, not the stub.
  SelectValue: ({
    children,
  }: {
    children?: (value: string) => ReactNode;
    placeholder?: string;
  }) => {
    const value = latestValue;
    if (typeof children === "function" && value !== undefined) {
      return children(value);
    }
    return null;
  },
}));

// Resolved manually per-test so the "instant" optimistic update can be
// observed BEFORE the server call settles.
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
  moveTaskStatus: vi.fn(async () => ({ ok: true, data: {} })),
  getOpenBlockers: vi.fn(async () => ({ ok: true, data: [] })),
  getTaskDetail: vi.fn(async (taskId: string) => ({
    ok: true,
    data: {
      task: {
        id: taskId,
        title: "Priority task",
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
    title: "Priority task",
    status: "todo",
    priority: null,
    assigneeId: null,
    dueDate: null,
    position: 1000,
  },
];

async function openSheetAndGetPrioritySelect() {
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
      screen.getByDisplayValue("Priority task", { exact: false }),
    ).toBeInTheDocument(),
  );

  return screen.getByLabelText("Priority") as HTMLSelectElement;
}

describe("TaskDetailSheet priority Select optimistic update (F004, AS-007, AS-008)", () => {
  it("test_AS_007_priority_updates_immediately_before_the_server_responds", async () => {
    const prioritySelect = await openSheetAndGetPrioritySelect();
    expect(prioritySelect.value).toBe("__none__");

    fireEvent.change(prioritySelect, { target: { value: "high" } });

    // Assert the optimistic value is applied before editTask's promise has
    // resolved at all (resolveEditTask hasn't been called yet — proves the
    // badge did not wait on the server).
    await waitFor(() => expect(prioritySelect.value).toBe("high"));
    expect(editTask).toHaveBeenCalledWith("t1", { priority: "high" });
    expect(resolveEditTask).not.toBeNull();

    // F023: the badge must NOT snap back to the stale "__none__" value
    // once this transition settles after a SUCCESSFUL save — it must stay
    // on the new "high" value until the caller's own refetch/realtime
    // path catches up (which this test never triggers).
    resolveEditTask?.({ ok: true, data: { priority: "high" } });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Priority updated."));
    expect(prioritySelect.value).toBe("high");
  });

  // F024: after a FIRST successful save commits `confirmedPriority`, a
  // SECOND change in the same open sheet must still be reflected
  // immediately — the stale confirmed mirror from the first save must not
  // mask the new optimistic value while the second save's own request is
  // in flight.
  it("test_AS_007_second_priority_change_after_a_successful_first_change_updates_immediately", async () => {
    const prioritySelect = await openSheetAndGetPrioritySelect();

    fireEvent.change(prioritySelect, { target: { value: "high" } });
    await waitFor(() => expect(prioritySelect.value).toBe("high"));
    resolveEditTask?.({ ok: true, data: { priority: "high" } });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Priority updated."));
    expect(prioritySelect.value).toBe("high");

    fireEvent.change(prioritySelect, { target: { value: "low" } });

    // Must reflect the SECOND change immediately, not stay pinned on the
    // first change's confirmed "high" value while this second save is
    // still in flight.
    await waitFor(() => expect(prioritySelect.value).toBe("low"));
    expect(resolveEditTask).not.toBeNull();

    resolveEditTask?.({ ok: true, data: { priority: "low" } });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Priority updated."),
    );
    expect(prioritySelect.value).toBe("low");
  });

  it("test_AS_008_priority_reverts_and_shows_an_error_toast_on_server_failure", async () => {
    const prioritySelect = await openSheetAndGetPrioritySelect();

    fireEvent.change(prioritySelect, { target: { value: "high" } });

    await waitFor(() => expect(prioritySelect.value).toBe("high"));

    resolveEditTask?.({ ok: false, error: "Network error" });

    await waitFor(() => expect(prioritySelect.value).toBe("__none__"));
    expect(toastError).toHaveBeenCalledWith("Failed to set priority to High");
  });

  // F013 (AS-008): a thrown rejection (network loss, 500, serialization
  // error) must revert + toast exactly like an `{ ok: false }` return —
  // not just be silently swallowed.
  it("test_AS_008_priority_reverts_and_shows_an_error_toast_when_server_action_throws", async () => {
    // The base (server) priority starts at "high" — a different value
    // than the one we change to below — so the revert assertion can only
    // pass if the revert logic actually runs it back to this starting
    // value. Starting and asserting at the same value would pass
    // trivially even if the revert code were deleted.
    (getTaskDetail as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (taskId: string) => ({
        ok: true,
        data: {
          task: {
            id: taskId,
            title: "Priority task",
            description: null,
            status: "todo",
            priority: "high",
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

    const prioritySelect = await openSheetAndGetPrioritySelect();
    expect(prioritySelect.value).toBe("high");

    editTask.mockImplementationOnce(() => Promise.reject(new Error("network")));

    fireEvent.change(prioritySelect, { target: { value: "low" } });
    await waitFor(() => expect(prioritySelect.value).toBe("low"));

    await waitFor(() => expect(prioritySelect.value).toBe("high"));
    expect(toastError).toHaveBeenCalledWith("Failed to set priority to Low");
  });

  // F014 (AS-007): the null-collapse regression — clearing an already-set
  // priority to "No priority" must show "No priority" immediately, not
  // silently fall back to the task's stale (still "high") priority. This is
  // the case `optimisticPriority ?? task.priority` got wrong: `??` cannot
  // tell "no optimistic override yet" apart from "explicitly cleared to
  // null", so the cleared value collapsed straight back to task.priority.
  it("test_AS_007_clearing_priority_to_null_updates_immediately_before_the_server_responds", async () => {
    (getTaskDetail as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (taskId: string) => ({
        ok: true,
        data: {
          task: {
            id: taskId,
            title: "Priority task",
            description: null,
            status: "todo",
            priority: "high",
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

    const prioritySelect = await openSheetAndGetPrioritySelect();
    expect(prioritySelect.value).toBe("high");
    const priorityFieldRoot = prioritySelect.parentElement!;
    // The SelectValue-rendered badge text is a bare text node sitting
    // alongside the native <select> (whose <option>s always list every
    // label regardless of current value) — so read the field's own text
    // with the <select>'s subtree stripped out to isolate just the badge.
    const badgeText = () => {
      const clone = priorityFieldRoot.cloneNode(true) as HTMLElement;
      clone.querySelector("select")?.remove();
      return clone.textContent ?? "";
    };
    expect(badgeText()).toContain("High");

    fireEvent.change(prioritySelect, { target: { value: "__none__" } });

    // The optimistic clear must be visible before editTask's promise
    // resolves at all — proves the "No priority" state did not wait on the
    // server, and did NOT collapse back to the stale "high" task.priority.
    // Both the Select's bound `value` prop AND the rendered badge text
    // (via SelectValue's render-prop, now actually wired up in the mock
    // above) must read "No priority" / "__none__", not "high" — this is
    // exactly the assertion that fails if F014's `(optimisticPriority ??
    // task.priority)` collapse regresses.
    await waitFor(() => expect(prioritySelect.value).toBe("__none__"));
    expect(badgeText()).toContain("No priority");
    expect(badgeText()).not.toContain("High");
    expect(editTask).toHaveBeenCalledWith("t1", { priority: null });
    expect(resolveEditTask).not.toBeNull();

    // F023: same post-success snap-back check as the other AS-007 test
    // above, for the "cleared to No priority" case specifically.
    resolveEditTask?.({ ok: true, data: { priority: null } });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Priority updated."));
    expect(prioritySelect.value).toBe("__none__");
    expect(badgeText()).toContain("No priority");
  });
});
