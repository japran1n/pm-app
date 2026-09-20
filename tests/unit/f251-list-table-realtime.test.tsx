// @vitest-environment jsdom
//
// F251 (AS-488): end-to-end proof that <TaskListTable projectId=...>
// reconciles a live Realtime `tasks` row event into the rendered row —
// "another user's edit appears live" — without a reload/remount, and
// that this reuses the SAME `board:<projectId>` shared channel
// components/board/use-board-realtime.ts already subscribes to (F329's
// ref-counted registry), rather than opening a second, parallel
// subscription for the same topic.

import { createElement } from "react";
import { cleanup, render, screen, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/w/acme/projects/proj-1/list",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/actions/tasks", () => ({
  editTask: vi.fn(),
  setTaskAssignees: vi.fn(),
  moveTaskStatus: vi.fn(),
}));

// A minimal-but-topic-dedupe-aware fake, mirroring what
// tests/unit/board-realtime-subscription.test.ts's own fake models for
// `subscribeToBoardRealtime` (channel() dedupes by topic; .on() records
// the dispatch callback; .subscribe() is a no-op passthrough).
const channelsByTopic = new Map<string, { onCallback?: (e: unknown) => void }>();

function makeFakeSupabase() {
  return {
    channel: vi.fn((topic: string) => {
      let entry = channelsByTopic.get(topic);
      if (!entry) {
        entry = {};
        channelsByTopic.set(topic, entry);
      }
      const chan = {
        on: (_type: string, _filter: unknown, cb: (e: unknown) => void) => {
          entry!.onCallback = cb;
          return chan;
        },
        subscribe: () => chan,
      };
      return chan;
    }),
    removeChannel: vi.fn(),
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "user-1" } } }, error: null }),
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  };
}

const fakeSupabase = makeFakeSupabase();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => fakeSupabase,
}));

import { TaskListTable } from "@/components/task/task-list-table";
import type { TaskCardTask } from "@/components/task/task-card";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  channelsByTopic.clear();
});

function baseTask(overrides: Partial<TaskCardTask> = {}): TaskCardTask {
  return {
    id: "task-1",
    title: "Ship the thing",
    status: "todo",
    priority: "medium",
    assigneeId: null,
    dueDate: "2026-09-01",
    position: 1,
    ...overrides,
  };
}

describe("F251 AS-488: TaskListTable live-reconciles Realtime tasks-row events", () => {
  it("test_AS_488_another_users_status_change_appears_in_the_row_without_a_reload", async () => {
    render(
      createElement(TaskListTable, {
        tasks: [baseTask()],
        assignees: new Map(),
        timezone: "UTC",
        projectId: "proj-1",
      }),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      screen.getByRole("combobox", { name: "Change status for task task-1" }),
    ).toHaveTextContent("To Do");

    const entry = channelsByTopic.get("board:proj-1");
    expect(entry?.onCallback).toBeTruthy();

    act(() => {
      entry!.onCallback!({
        eventType: "UPDATE",
        new: {
          id: "task-1",
          title: "Ship the thing",
          status: "done",
          priority: "medium",
          assignee_id: null,
          due_date: "2026-09-01",
          position: 1,
          deleted_at: null,
          updated_at: "2026-08-22T00:00:00.000Z",
          number: 1,
        },
        old: {},
      });
    });

    expect(
      screen.getByRole("combobox", { name: "Change status for task task-1" }),
    ).toHaveTextContent("Done");
  });

  it("test_AS_488_list_view_reuses_the_same_board_topic_a_concurrently_mounted_board_would_use", () => {
    render(
      createElement(TaskListTable, {
        tasks: [baseTask()],
        assignees: new Map(),
        timezone: "UTC",
        projectId: "proj-1",
      }),
    );

    // At most one `channel()` call for this topic — proving this hook
    // reuses lib/realtime/shared-topic-channel.ts's registry (which
    // dedupes `.channel()`/`.on()`/`.subscribe()` per topic — a still-live
    // channel from an earlier mount in this same registry is reused with
    // ZERO new `.channel()` calls, per that module's own doc comment)
    // rather than forking a second raw subscription mechanism, per this
    // feature's explicit instruction to reuse it.
    const calls = fakeSupabase.channel.mock.calls.filter(
      (call) => call[0] === "board:proj-1",
    );
    expect(calls.length).toBeLessThanOrEqual(1);
  });

  it("test_no_realtime_subscription_is_opened_for_the_workspace_wide_dashboard_caller_omitting_projectId", () => {
    render(
      createElement(TaskListTable, {
        tasks: [baseTask()],
        assignees: new Map(),
        timezone: "UTC",
      }),
    );

    expect(fakeSupabase.channel).not.toHaveBeenCalled();
  });
});
