// @vitest-environment jsdom
//
// F022 fix-up (AS-025, AS-026, AS-027, AS-028): scrutiny-2 found that
// lib/board/pending-moves.ts (F017's extraction) is genuinely wired in and
// well tested in isolation, but board.tsx's SINGLE CALL SITE
// (`if (shouldSkipRealtimeUpdate(pendingMovesRef.current, event)) return;`,
// components/board/board.tsx:291) had zero coverage of its own: inverting
// it to `if (!shouldSkipRealtimeUpdate(...))` left all 1573 existing tests
// green, because the only test touching board.tsx was a
// `renderToStaticMarkup` smoke check that never drove the realtime
// callback (tests/unit/board-optimistic-move-realtime-guard.test.ts).
//
// This file mounts the REAL <Board>, drives a real cross-column drag via
// the captured dnd-kit `onDragEnd` handler (so `pendingMovesRef` gets a
// real in-flight entry the same way a user's drag would populate it — not
// a fake set up by test-only scaffolding), keeps the drag's Server Action
// promise unresolved, fires a stale Realtime UPDATE for that same task
// through the captured Supabase channel callback, and asserts the DOM
// still shows the optimistic (post-drop) state, not the stale echo. A
// board.tsx that inverts or deletes the guard call must fail this test.

import { createElement } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// --- dnd-kit: capture onDragEnd without needing real pointer/sensor
// activation. DragOverlay is neutered to `children` (it's `null` here
// anyway since `activeTask` never becomes non-null — this test never
// calls the captured `onDragStart`). Everything else (DndContext's own
// sensors/collisionDetection config, closestCorners, useSensor(s),
// KeyboardSensor, PointerSensor, sortableKeyboardCoordinates,
// SortableContext, useSortable, etc.) is the REAL dnd-kit implementation
// — only the two components board.tsx actually needs neutralized for a
// non-interactive render are replaced.
let capturedOnDragEnd:
  | ((event: { active: { id: string }; over: { id: string } | null }) => unknown)
  | null = null;

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: (props: {
      onDragEnd?: typeof capturedOnDragEnd;
      children?: React.ReactNode;
    }) => {
      capturedOnDragEnd = props.onDragEnd ?? null;
      return props.children;
    },
    DragOverlay: (props: { children?: React.ReactNode }) => props.children ?? null,
  };
});

// --- Supabase realtime: same "channel().on().subscribe(); capture the
// dispatch callback" shape as tests/unit/f027-calendar-realtime-wiring.test.tsx.
const onCalls: Array<{ callback: (payload: unknown) => void }> = [];

function makeFakeSupabase() {
  const channelObject = {
    on: vi.fn(
      (
        _event: string,
        _filter: unknown,
        callback: (payload: unknown) => void,
      ) => {
        onCalls.push({ callback });
        return channelObject;
      },
    ),
    subscribe: vi.fn(() => channelObject),
  };
  return {
    channel: vi.fn(() => channelObject),
    removeChannel: vi.fn(),
  };
}

const fakeSupabase = makeFakeSupabase();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => fakeSupabase,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/w/acme/projects/proj-1/board",
  useSearchParams: () => new URLSearchParams(),
}));

// moveAndReorderTask is the cross-column call handleDragEnd dispatches —
// deliberately left UNRESOLVED (a controllable deferred) so
// pendingMovesRef stays guarded for the duration of the test, exactly
// modeling "the Server Action is still in flight when a stale Realtime
// echo for the same row arrives".
let resolveMoveAndReorder: ((value: { ok: true }) => void) | null = null;
vi.mock("@/lib/actions/tasks", () => ({
  moveAndReorderTask: vi.fn(
    () =>
      new Promise((resolve) => {
        resolveMoveAndReorder = resolve;
      }),
  ),
  reorderTask: vi.fn(async () => ({ ok: true })),
  createTask: vi.fn(async () => ({ ok: true, data: {} })),
  editTask: vi.fn(async () => ({ ok: true })),
  setTaskAssignees: vi.fn(async () => ({ ok: true })),
  updateTaskTags: vi.fn(async () => ({ ok: true })),
}));

import { Board } from "@/components/board/board";
import type { TaskCardTask } from "@/components/task/task-card";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  onCalls.length = 0;
  capturedOnDragEnd = null;
  resolveMoveAndReorder = null;
});

function initialTasks(): TaskCardTask[] {
  return [
    {
      id: "t1",
      title: "Movable task",
      status: "todo",
      priority: null,
      assigneeId: null,
      dueDate: null,
      position: 1000,
    },
  ];
}

function staleUpdateEvent() {
  // Mirrors the shape subscribe-board-realtime.ts hands to onChange —
  // a stale row still carrying the PRE-drop status, arriving while the
  // drag's Server Action is still in flight (the exact race AS-025/
  // AS-026/AS-027/AS-028 exist to prevent).
  return {
    eventType: "UPDATE",
    schema: "public",
    table: "tasks",
    new: {
      id: "t1",
      project_id: "project-1",
      title: "Movable task",
      status: "todo",
      priority: null,
      assignee_id: null,
      due_date: null,
      position: 1000,
      deleted_at: null,
      updated_at: "2026-09-01T00:00:00Z",
      number: 1,
    },
    old: { id: "t1" },
  };
}

describe("F022 fix-up (AS-025, AS-026, AS-027, AS-028): board.tsx's realtime guard call site", () => {
  it("test_AS_025_a_stale_realtime_UPDATE_for_a_task_with_an_in-flight_drag_does_not_revert_the_optimistic_move", async () => {
    render(
      createElement(Board, {
        projectId: "project-1",
        initialTasks: initialTasks(),
        timezone: "UTC",
      }),
    );

    // Real drag: dnd-kit's channel is neutered, but handleDragEnd itself
    // is the genuine board.tsx implementation, reached via the captured
    // onDragEnd prop.
    expect(capturedOnDragEnd).not.toBeNull();
    await act(async () => {
      await capturedOnDragEnd!({
        active: { id: "t1" },
        over: { id: "in_progress" },
      });
    });

    // Optimistic move applied immediately, before the Server Action
    // settles.
    expect(screen.queryByText("Movable task")).toBeTruthy();
    const inProgressColumn = document.querySelector(
      '[data-status="in_progress"]',
    );
    const todoColumn = document.querySelector('[data-status="todo"]');
    expect(inProgressColumn).toHaveTextContent("Movable task");
    expect(todoColumn).not.toHaveTextContent("Movable task");

    // moveAndReorderTask is still pending (never resolved) — the guard
    // must be up right now.
    expect(resolveMoveAndReorder).not.toBeNull();

    // A stale Realtime UPDATE for the SAME task arrives while the drag's
    // Server Action is still in flight, carrying the OLD ("todo") status.
    expect(onCalls.length).toBeGreaterThan(0);
    act(() => {
      onCalls[0]!.callback(staleUpdateEvent());
    });

    // AS-025/AS-028: the stale echo must be skipped — the card stays in
    // "in_progress", not reverted to "todo". An inverted call site
    // (`if (!shouldSkipRealtimeUpdate(...))`) or a deleted guard call
    // both apply the stale event here and fail this assertion.
    expect(
      document.querySelector('[data-status="in_progress"]'),
    ).toHaveTextContent("Movable task");
    expect(document.querySelector('[data-status="todo"]')).not.toHaveTextContent(
      "Movable task",
    );

    // AS-026/AS-027: once the in-flight action settles, a LATER Realtime
    // UPDATE for the same task IS applied — the guard released, not
    // permanently stuck.
    await act(async () => {
      resolveMoveAndReorder!({ ok: true });
      // Let the `.finally(() => releasePendingMove(...))` chain run.
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      onCalls[0]!.callback({
        ...staleUpdateEvent(),
        new: { ...staleUpdateEvent().new, status: "in_review" },
      });
    });

    expect(document.querySelector('[data-status="in_review"]')).toHaveTextContent(
      "Movable task",
    );
  });
});
