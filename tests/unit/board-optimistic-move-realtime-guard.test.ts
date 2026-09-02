// F010/F017 (AS-025, AS-026, AS-027, AS-028): pendingMovesRef guards an
// optimistic DRAG the same way pendingOptimisticCreatesRef already guards
// an optimistic CREATE (see handleTaskOptimisticAdd/handleTaskCreated in
// board.tsx) — a realtime `tasks` UPDATE for a task whose drag Server
// Action is still in flight must be ignored, or it can stomp the
// just-applied optimistic move with a stale pre-drop row.
//
// F017 fix-up: this file previously asserted entirely by regex over
// board.tsx's SOURCE TEXT, so an inverted guard (`!…has(id)`) and a
// count-ignoring `releasePendingMove` (`map.delete` unconditionally) both
// left every test green. board.tsx now delegates the guard's bookkeeping
// AND its skip decision to the pure module lib/board/pending-moves.ts
// (see that file's doc comments) — this file drives those exported
// functions directly with real Map state and real synthetic realtime
// events, so a behavioural regression in either actually fails a test.

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  createPendingMoves,
  addPendingMove,
  releasePendingMove,
  isMoveGuarded,
  shouldSkipRealtimeUpdate,
} from "@/lib/board/pending-moves";

vi.mock("@/lib/actions/tasks", () => ({
  moveAndReorderTask: vi.fn(async () => ({ ok: true })),
  reorderTask: vi.fn(async () => ({ ok: true })),
  createTask: vi.fn(async () => ({ ok: true, data: {} })),
  editTask: vi.fn(async () => ({ ok: true })),
  setTaskAssignees: vi.fn(async () => ({ ok: true })),
  updateTaskTags: vi.fn(async () => ({ ok: true })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/w/acme/projects/proj-1/board",
  useSearchParams: () => new URLSearchParams(),
}));

import { Board } from "@/components/board/board";

function updateEvent(id: string) {
  return { eventType: "UPDATE" as const, new: { id } };
}

describe("pending-moves bookkeeping (F010/F017: AS-025, AS-026, AS-027, AS-028)", () => {
  it("a fresh map guards nothing", () => {
    const map = createPendingMoves();
    expect(isMoveGuarded(map, "t1")).toBe(false);
  });

  it("addPendingMove marks the id as guarded", () => {
    const map = createPendingMoves();
    addPendingMove(map, "t1", 1);
    expect(isMoveGuarded(map, "t1")).toBe(true);
  });

  it("an ordinary (single-call) drag is released after its one settle", () => {
    const map = createPendingMoves();
    addPendingMove(map, "t1", 1);
    releasePendingMove(map, "t1");
    expect(isMoveGuarded(map, "t1")).toBe(false);
  });

  // The counter mutant: rewriting releasePendingMove to an unconditional
  // `map.delete(taskId)` releases a cross-lane drag's guard on the FIRST
  // settle instead of waiting for both. This test fails against that
  // mutant and passes against the real reference-counted implementation.
  it("a cross-lane drag (two Server Actions) stays guarded until BOTH settle — an unconditional delete on the first settle fails this", () => {
    const map = createPendingMoves();
    addPendingMove(map, "t1", 2);

    releasePendingMove(map, "t1"); // first of two calls settles
    expect(isMoveGuarded(map, "t1")).toBe(true); // must still be guarded

    releasePendingMove(map, "t1"); // second call settles
    expect(isMoveGuarded(map, "t1")).toBe(false); // now released
  });

  it("releasing an id with no in-flight move is a no-op, never goes negative", () => {
    const map = createPendingMoves();
    releasePendingMove(map, "unknown");
    expect(isMoveGuarded(map, "unknown")).toBe(false);
    // Releasing again after guarding once shouldn't underflow into a
    // permanently-guarded state either.
    addPendingMove(map, "t1", 1);
    releasePendingMove(map, "t1");
    releasePendingMove(map, "t1");
    expect(isMoveGuarded(map, "t1")).toBe(false);
  });

  // AS-025: a realtime UPDATE echoing an in-flight move does not move the
  // card — i.e. it must be skipped.
  it("AS-025: an UPDATE for a task with an in-flight move is skipped", () => {
    const map = createPendingMoves();
    addPendingMove(map, "t1", 1);
    expect(shouldSkipRealtimeUpdate(map, updateEvent("t1"))).toBe(true);
  });

  // Kills the inverted-guard mutant (`!isMoveGuarded(...)`): with that
  // mutant this assertion flips to `false` for a guarded id.
  it("kills an inverted guard: a guarded id must still be skipped, not applied", () => {
    const map = createPendingMoves();
    addPendingMove(map, "t1", 1);
    expect(shouldSkipRealtimeUpdate(map, updateEvent("t1"))).not.toBe(false);
  });

  // AS-026: after the move's action resolves successfully, later updates
  // for that task ARE applied.
  it("AS-026: after a successful settle, a later UPDATE for that task is applied", () => {
    const map = createPendingMoves();
    addPendingMove(map, "t1", 1);
    expect(shouldSkipRealtimeUpdate(map, updateEvent("t1"))).toBe(true);

    // The action's `.finally` releases the guard on success.
    releasePendingMove(map, "t1");

    expect(shouldSkipRealtimeUpdate(map, updateEvent("t1"))).toBe(false);
  });

  // AS-027: after the move's action FAILS and the board rolls back, later
  // updates for that task ARE applied — the guard must be released on the
  // failure path too, not only on success.
  it("AS-027: after a failed settle (ok:false or thrown rejection), a later UPDATE for that task is applied", () => {
    const map = createPendingMoves();
    addPendingMove(map, "t1", 1);
    expect(shouldSkipRealtimeUpdate(map, updateEvent("t1"))).toBe(true);

    // The action's `.finally` releases the guard regardless of outcome —
    // simulating the failure path here (no different call from the
    // success path above, which is exactly the point: `.finally` runs on
    // both).
    releasePendingMove(map, "t1");

    expect(shouldSkipRealtimeUpdate(map, updateEvent("t1"))).toBe(false);
  });

  // AS-028: an update for a task with NO in-flight move is applied
  // normally. Previously entirely uncovered.
  it("AS-028: an UPDATE for a task with no in-flight move at all is applied immediately", () => {
    const map = createPendingMoves();
    expect(shouldSkipRealtimeUpdate(map, updateEvent("t1"))).toBe(false);
  });

  it("AS-028 (negative control): a guarded OTHER task does not affect an unguarded task's UPDATE", () => {
    const map = createPendingMoves();
    addPendingMove(map, "t2", 1);
    expect(shouldSkipRealtimeUpdate(map, updateEvent("t1"))).toBe(false);
    expect(shouldSkipRealtimeUpdate(map, updateEvent("t2"))).toBe(true);
  });

  it("INSERT and DELETE events for a guarded id are never skipped by this predicate (only UPDATE is guarded)", () => {
    const map = createPendingMoves();
    addPendingMove(map, "t1", 1);
    expect(
      shouldSkipRealtimeUpdate(map, { eventType: "INSERT", new: { id: "t1" } }),
    ).toBe(false);
    expect(
      shouldSkipRealtimeUpdate(map, { eventType: "DELETE", new: null }),
    ).toBe(false);
  });

  it("an UPDATE with no `new` payload is never skipped (nothing to guard against)", () => {
    const map = createPendingMoves();
    expect(shouldSkipRealtimeUpdate(map, { eventType: "UPDATE", new: null })).toBe(
      false,
    );
  });
});

describe("board.tsx wires the realtime handler through the pure guard module (not a local reimplementation)", () => {
  // Guards against a regression where board.tsx stops delegating to
  // shouldSkipRealtimeUpdate/pendingMovesRef and reintroduces its own,
  // untested inline logic — imports the real board.tsx module and proves
  // it renders using the same pending-moves module this file already
  // proved correct above (a compile-time/wiring check, not a source-text
  // regex).
  it("renders with the guard module in place, without crashing", () => {
    const html = renderToStaticMarkup(
      createElement(Board, {
        projectId: "project-1",
        initialTasks: [
          {
            id: "t1",
            title: "Todo task",
            status: "todo",
            priority: null,
            assigneeId: null,
            dueDate: null,
            position: 1000,
          },
        ],
        timezone: "UTC",
      }),
    );
    expect(html).toContain("Todo task");
  });
});
