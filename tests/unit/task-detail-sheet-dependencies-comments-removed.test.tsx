// @vitest-environment jsdom
//
// Task detail sheet UI change: the "Blocked by"/"Blocks" dependency list
// and the "Comments" tab are no longer rendered in the internal workspace
// task detail view. Only the read-only Activity feed remains where
// "Comments & activity" used to be. This does NOT touch:
//   - components/task/dependencies.tsx itself (still has its own render
//     tests in tests/unit/dependencies-ui-render.test.ts)
//   - components/task/blocked-done-guard.tsx's guard against marking a
//     blocked task Done (still wired via useBlockedDoneGuard() inside
//     TaskDetailSheet, unaffected by removing the dependency list's UI)
//   - lib/actions/comments.ts / comment data (still fetched/could exist in
//     the DB — simply not displayed here)
//
// Mounts the real <Board> the same way
// tests/unit/f005-task-detail-sheet-title-optimistic.test.tsx does (Radix
// Sheet only portals its content when actually open).

import { createElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "test-publishable-key";

vi.mock("@/lib/actions/tasks", () => ({
  moveAndReorderTask: vi.fn(async () => ({ ok: true, data: {} })),
  reorderTask: vi.fn(async () => ({ ok: true, data: {} })),
  createTask: vi.fn(async () => ({ ok: true, data: {} })),
  getTaskDetail: vi.fn(async (taskId: string) => ({
    ok: true,
    data: {
      task: {
        id: taskId,
        title: "Task with dependencies and comments",
        description: null,
        status: "todo",
        priority: null,
        assigneeId: null,
        dueDate: null,
        tags: [],
        dependencies: {
          blockedBy: [
            {
              dependencyId: "dep-1",
              taskId: "blocker-1",
              title: "Blocker task",
              status: "todo",
              projectKey: "PM",
              number: 5,
            },
          ],
          blocks: [],
        },
      },
      comments: [
        {
          id: "c1",
          taskId,
          userId: "user-1",
          userName: "Alice",
          body: "A comment that should not render here",
          createdAt: new Date().toISOString(),
        },
      ],
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
});

const TASKS: TaskCardTask[] = [
  {
    id: "t1",
    title: "Task with dependencies and comments",
    status: "todo",
    priority: null,
    assigneeId: null,
    dueDate: null,
    position: 1000,
    projectKey: "PM",
    number: 1,
  },
];

describe("TaskDetailSheet no longer renders Dependencies UI or a Comments tab", () => {
  it("test_dependencies_blocked_by_and_blocks_lists_are_not_rendered", async () => {
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
        screen.getByDisplayValue("Task with dependencies and comments", {
          exact: false,
        }),
      ).toBeInTheDocument(),
    );

    expect(screen.queryByText("Blocked by")).not.toBeInTheDocument();
    expect(screen.queryByText("Blocks")).not.toBeInTheDocument();
    expect(screen.queryByText("Blocker task")).not.toBeInTheDocument();
  });

  it("test_comments_tab_and_comment_content_are_not_rendered_only_activity_remains", async () => {
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
        screen.getByDisplayValue("Task with dependencies and comments", {
          exact: false,
        }),
      ).toBeInTheDocument(),
    );

    // No "Comments" tab/trigger anywhere.
    expect(
      screen.queryByRole("tab", { name: "Comments" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Comments" }),
    ).not.toBeInTheDocument();
    // The comment's own body text never renders in this view.
    expect(
      screen.queryByText("A comment that should not render here"),
    ).not.toBeInTheDocument();

    // The Activity section heading/collapsible trigger IS present.
    expect(screen.getAllByText("Activity").length).toBeGreaterThan(0);
  });
});
