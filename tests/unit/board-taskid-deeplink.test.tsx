// @vitest-environment jsdom
//
// AS-386 follow-up: F208's own handoff disclosed that clicking a
// notification did not actually open the task — it only navigated to a
// search page pre-filled with the task's key. This closes that gap by
// having the board page read a `?taskId=` search param and open that
// task's detail sheet on mount, via the same `useTaskDetailSheet().openTask`
// path a card click already uses (see board.tsx and
// tests/unit/board-task-detail-sheet-wiring.test.ts's source-inspection
// coverage of the same wiring).
//
// This test renders the real <Board> in jsdom (per vitest.config.ts's
// per-file jsdom opt-in) with a mocked `useSearchParams` returning
// `taskId=t1`, and asserts the sheet actually opens (fetches detail via
// the mocked getTaskDetail and renders the task's title) — a genuine
// DOM-level proof, not just source inspection.

import { createElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// Board mounts useBoardRealtime, which creates a real Supabase browser
// client on mount — give it harmless dummy env values so it doesn't throw
// in this jsdom test (no real subscription is exercised or asserted on
// here; the deep-link wiring under test is independent of Realtime).
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

// The opened TaskDetailSheet's comment box fetches mention candidates via
// a Server Action that calls Next's `cookies()` — unavailable outside a
// real request scope in this jsdom test. Stubbed out same as the mocked
// task Server Actions above; not exercised by this deep-link test.
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
  },
  {
    id: "t2",
    title: "Other task",
    status: "todo",
    priority: null,
    assigneeId: null,
    dueDate: null,
    position: 2000,
  },
];

describe("Board opens the TaskDetailSheet from a `?taskId=` deep link (AS-386 follow-up)", () => {
  it("test_AS_386_a_taskId_search_param_matching_a_board_task_opens_its_detail_sheet_on_mount", async () => {
    render(
      createElement(Board, {
        projectId: "project-1",
        initialTasks: TASKS,
        timezone: "UTC",
      }),
    );

    await waitFor(() => expect(getTaskDetail).toHaveBeenCalledWith("t1"));
    // TaskDetailSheet's own title field renders the fetched task's title
    // in an editable <input>, not as plain text — proves the sheet
    // actually opened and loaded task "t1"'s detail, not just that the
    // board rendered.
    await waitFor(() =>
      expect(
        screen.getByDisplayValue("Deep-linked task", { exact: false }),
      ).toBeInTheDocument(),
    );
  });
});

// F304 (scrutiny FU-8): before this fix, the effect only called
// `openTask` when the requested id was ALSO present in the board's own
// client-loaded `tasks` array — a notification linking to a task that's
// filtered out of the board's current view (or simply hasn't loaded)
// silently opened nothing. `openTask` always performs its own
// `getTaskDetail` server round trip regardless of what's locally loaded,
// so the fix is to stop gating the call on local array membership.
describe("Board opens the TaskDetailSheet from a `?taskId=` deep link even when the task is not in the currently-loaded array (F304 fix)", () => {
  it("test_AS_386_followup_fetch_by_id_fallback_a_taskId_not_in_the_loaded_tasks_array_still_opens_the_sheet", async () => {
    render(
      createElement(Board, {
        projectId: "project-1",
        // Deliberately does NOT include "t1" — proves the deep-link
        // doesn't silently no-op just because the task isn't in this
        // locally-loaded array.
        initialTasks: [TASKS[1]],
        timezone: "UTC",
      }),
    );

    await waitFor(() => expect(getTaskDetail).toHaveBeenCalledWith("t1"));
    await waitFor(() =>
      expect(
        screen.getByDisplayValue("Deep-linked task", { exact: false }),
      ).toBeInTheDocument(),
    );
  });
});
