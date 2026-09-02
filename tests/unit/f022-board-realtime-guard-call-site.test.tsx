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
//
// F026 fix-up (AS-026, AS-027): scrutiny-3 found this file covered only
// ONE of `board.tsx`'s five `releasePendingMove` call sites (the
// `moveAndReorderTask` `.finally`, `:826`). Deleting the release at
// `reorderTask` (`:841`, same-column reorder), or any of the three
// cross-lane grouped-field actions -- `editTask` (`:864`, groupBy
// "priority"), `setTaskAssignees` (`:875`, groupBy "assignee"),
// `updateTaskTags` (`:886`, groupBy "tag") -- all left the suite green,
// and no test anywhere drove a FAILING Server Action followed by a
// realtime update for that task, which is precisely AS-027's scenario (a
// task must not go permanently deaf to realtime after a failed drag). The
// four tests below each drive a real drag through the mounted `<Board>`
// (same `capturedOnDragEnd` approach as the AS-025 test above), force the
// relevant mocked Server Action to FAIL -- alternating between the
// `{ ok: false }` shape and a thrown rejection, since `releasePendingMove`
// is called from both the `.then` failure branch and the `.catch` -- then
// fire a Realtime UPDATE for that task and assert it IS applied, proving
// the guard was actually released rather than left stuck forever.

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

// F026 fix-up: mutable so each test can select a `?groupBy=` value
// (cross-lane release sites are only reachable with a real grouping mode)
// without a separate vi.mock per test.
const searchParamsState: { groupBy: string | null } = { groupBy: null };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/w/acme/projects/proj-1/board",
  useSearchParams: () =>
    new URLSearchParams(
      searchParamsState.groupBy ? { groupBy: searchParamsState.groupBy } : {},
    ),
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
import {
  editTask,
  reorderTask,
  setTaskAssignees,
  updateTaskTags,
} from "@/lib/actions/tasks";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  onCalls.length = 0;
  capturedOnDragEnd = null;
  resolveMoveAndReorder = null;
  searchParamsState.groupBy = null;
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

  // --- F026 fix-up: the four previously-uncovered release sites ---------

  function makeTask(
    overrides: Partial<TaskCardTask> & { id: string },
  ): TaskCardTask {
    return {
      title: `Task ${overrides.id}`,
      status: "todo",
      priority: null,
      assigneeId: null,
      dueDate: null,
      position: 1000,
      ...overrides,
    } as TaskCardTask;
  }

  function realtimeUpdateFor(taskId: string, patch: Record<string, unknown>) {
    return {
      eventType: "UPDATE",
      schema: "public",
      table: "tasks",
      new: {
        id: taskId,
        project_id: "project-1",
        title: `Task ${taskId}`,
        status: "todo",
        priority: null,
        assignee_id: null,
        due_date: null,
        position: 1000,
        deleted_at: null,
        updated_at: "2026-09-01T00:00:00Z",
        number: 1,
        ...patch,
      },
      old: { id: taskId },
    };
  }

  it("test_AS_027_reorderTask_ok_false_failure_releases_the_guard_for_a_same-column_reorder", async () => {
    // board.tsx:841 — the release wired into the same-column reorder
    // path (no cross-lane grouping, status unchanged, only `position`
    // changes). Round-3 scrutiny: deleting this release SURVIVED because
    // nothing exercised this branch at all.
    vi.mocked(reorderTask).mockResolvedValueOnce({
      ok: false,
      error: "reorder failed",
    });

    render(
      createElement(Board, {
        projectId: "project-reorder",
        initialTasks: [
          makeTask({ id: "t1", position: 1000 }),
          makeTask({ id: "t2", position: 2000 }),
        ],
        timezone: "UTC",
      }),
    );

    expect(capturedOnDragEnd).not.toBeNull();
    await act(async () => {
      await capturedOnDragEnd!({
        active: { id: "t1" },
        over: { id: "t2" },
      });
      // Let reorderTask's mocked (already-resolved) promise's
      // `.then(...).finally(() => releasePendingMove(...))` chain run.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(reorderTask).toHaveBeenCalled();

    // AS-027: after the failure, the guard must be released — a later
    // Realtime UPDATE for t1 is applied, not skipped. A missing release
    // at :841 leaves this id guarded forever and this assertion fails.
    expect(onCalls.length).toBeGreaterThan(0);
    act(() => {
      onCalls[0]!.callback(
        realtimeUpdateFor("t1", { status: "in_review", title: "Task t1" }),
      );
    });

    expect(
      document.querySelector('[data-status="in_review"]'),
    ).toHaveTextContent("Task t1");
  });

  it("test_AS_027_editTask_thrown_rejection_releases_the_guard_for_a_cross-lane_priority_drag", async () => {
    // board.tsx:864 — the release wired into the groupBy="priority"
    // cross-lane branch (dispatches `editTask` alongside `reorderTask`
    // since status is unchanged, only the lane/priority changes).
    searchParamsState.groupBy = "priority";
    vi.mocked(editTask).mockRejectedValueOnce(new Error("network error"));

    render(
      createElement(Board, {
        projectId: "project-priority",
        initialTasks: [
          makeTask({ id: "t1", position: 1000, priority: "high" }),
          makeTask({ id: "t2", position: 2000, priority: "urgent" }),
        ],
        timezone: "UTC",
      }),
    );

    expect(capturedOnDragEnd).not.toBeNull();
    await act(async () => {
      // Cross-lane drop: source lane "high" (t1's own priority),
      // dropped onto t2's card, whose dnd id carries its lane ("urgent").
      // Status stays "todo" on both sides, so this is a pure cross-lane
      // reassignment (editTask) plus a same-status reposition
      // (reorderTask) — matching handleDragEnd's crossLane branch.
      await capturedOnDragEnd!({
        active: { id: "high::t1" },
        over: { id: "urgent::t2" },
      });
      // Let both dispatched actions' mocked promises settle and their
      // `.then`/`.catch`/`.finally` chains run.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(editTask).toHaveBeenCalled();

    // AS-027: the guard is only fully released once BOTH dispatched
    // calls (reorderTask + editTask) have settled. A missing release at
    // :864 leaves the count stuck above zero forever, and this later
    // Realtime UPDATE would be (wrongly) skipped. Priority is carried
    // through unchanged in the event so the task stays in its "high"
    // swimlane -- grouped rendering means several `[data-status=…]`
    // nodes (one per lane) can share the same status, so every match is
    // checked rather than assuming the first is the right lane.
    expect(onCalls.length).toBeGreaterThan(0);
    act(() => {
      onCalls[0]!.callback(
        realtimeUpdateFor("t1", {
          status: "in_review",
          title: "Task t1",
          priority: "high",
        }),
      );
    });

    const inReviewColumns = document.querySelectorAll(
      '[data-status="in_review"]',
    );
    expect(
      Array.from(inReviewColumns).some((el) =>
        el.textContent?.includes("Task t1"),
      ),
    ).toBe(true);
  });

  it("test_AS_027_setTaskAssignees_ok_false_failure_releases_the_guard_for_a_cross-lane_assignee_drag", async () => {
    // board.tsx:875 — the release wired into the groupBy="assignee"
    // cross-lane branch (dispatches `setTaskAssignees`).
    searchParamsState.groupBy = "assignee";
    vi.mocked(setTaskAssignees).mockResolvedValueOnce({
      ok: false,
      error: "assign failed",
    });

    render(
      createElement(Board, {
        projectId: "project-assignee",
        initialTasks: [
          makeTask({ id: "t1", position: 1000, assigneeId: "user-a" }),
          makeTask({ id: "t2", position: 2000, assigneeId: "user-b" }),
        ],
        timezone: "UTC",
      }),
    );

    expect(capturedOnDragEnd).not.toBeNull();
    await act(async () => {
      await capturedOnDragEnd!({
        active: { id: "user-a::t1" },
        over: { id: "user-b::t2" },
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(setTaskAssignees).toHaveBeenCalled();

    // Assignee is carried through unchanged in the event so the task
    // stays in its "user-a" swimlane; several `[data-status=…]` nodes
    // (one per lane) can share the same status, so every match is
    // checked.
    expect(onCalls.length).toBeGreaterThan(0);
    act(() => {
      onCalls[0]!.callback(
        realtimeUpdateFor("t1", {
          status: "in_review",
          title: "Task t1",
          assignee_id: "user-a",
        }),
      );
    });

    const inReviewColumnsAssignee = document.querySelectorAll(
      '[data-status="in_review"]',
    );
    expect(
      Array.from(inReviewColumnsAssignee).some((el) =>
        el.textContent?.includes("Task t1"),
      ),
    ).toBe(true);
  });

  it("test_AS_027_updateTaskTags_thrown_rejection_releases_the_guard_for_a_cross-lane_tag_drag", async () => {
    // board.tsx:886 — the release wired into the groupBy="tag" cross-lane
    // branch (dispatches `updateTaskTags`).
    searchParamsState.groupBy = "tag";
    vi.mocked(updateTaskTags).mockRejectedValueOnce(new Error("network error"));

    render(
      createElement(Board, {
        projectId: "project-tag",
        initialTasks: [
          makeTask({ id: "t1", position: 1000, tags: ["alpha"] }),
          makeTask({ id: "t2", position: 2000, tags: ["beta"] }),
        ],
        timezone: "UTC",
      }),
    );

    expect(capturedOnDragEnd).not.toBeNull();
    await act(async () => {
      await capturedOnDragEnd!({
        active: { id: "alpha::t1" },
        over: { id: "beta::t2" },
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(updateTaskTags).toHaveBeenCalled();

    expect(onCalls.length).toBeGreaterThan(0);
    act(() => {
      onCalls[0]!.callback(
        realtimeUpdateFor("t1", {
          status: "in_review",
          title: "Task t1",
        }),
      );
    });

    // Event carries no `tags` field (the realtime payload shape has none
    // — tags come from a join, per reconcileTask), so reconciliation
    // leaves the task's existing tags/lane untouched; check every
    // `[data-status="in_review"]` node across lanes.
    const inReviewColumnsTag = document.querySelectorAll(
      '[data-status="in_review"]',
    );
    expect(
      Array.from(inReviewColumnsTag).some((el) =>
        el.textContent?.includes("Task t1"),
      ),
    ).toBe(true);
  });
});
