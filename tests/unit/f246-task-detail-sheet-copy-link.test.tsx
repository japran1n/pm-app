// @vitest-environment jsdom
//
// F246 (AS-473): proves TaskDetailSheet's new "Copy link" control actually
// writes the real canonical deep-link URL
// (`/w/{workspaceSlug}/t/{taskKey}`) to the clipboard, not just that the
// button exists in source. Radix Sheet only portals its content when
// `open` (see tests/unit/task-key-display-render.test.ts's own note on
// why this needed a real jsdom render, not react-dom/server), so this
// mounts the real <Board> — same "mock getTaskDetail + next/navigation,
// open via `?taskId=`" pattern already established by
// tests/unit/board-taskid-deeplink.test.tsx — and drives a real user
// click on the rendered "Copy link" button.

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
        title: "Deep-linked task",
        description: null,
        status: "todo",
        priority: null,
        assigneeId: null,
        dueDate: null,
        tags: [],
        // F146 fields needed for formatTaskKey to produce a non-null key
        // ("FKEY-142"), which is what the "Copy link" control's own
        // canonicalTaskPath is built from.
        projectKey: "FKEY",
        number: 142,
      },
      comments: [],
      attachments: [],
      currentUserId: "user-1",
      currentUserRole: "member",
    },
  })),
}));

// `pathname` here is the real shape this page's route produces — the
// component reads the `/w/{slug}/` segment straight out of it.
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
});

const TASKS: TaskCardTask[] = [
  {
    id: "t1",
    title: "Deep-linked task",
    status: "todo",
    priority: null,
    assigneeId: null,
    dueDate: null,
    position: 1000,
    projectKey: "FKEY",
    number: 142,
  },
];

describe("TaskDetailSheet's Copy link control (F246, AS-473)", () => {
  it("test_AS_473_copy_link_writes_the_canonical_workspace_slug_task_key_url_to_the_clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

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
        screen.getByDisplayValue("Deep-linked task", { exact: false }),
      ).toBeInTheDocument(),
    );

    const copyLinkButton = await screen.findByRole("button", {
      name: "Copy link to this task",
    });

    fireEvent.click(copyLinkButton);

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/w/acme/t/FKEY-142`,
      ),
    );
  });
});
