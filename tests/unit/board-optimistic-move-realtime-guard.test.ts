// F010 (AS-025, AS-026, AS-027, AS-028): pendingMovesRef guards an
// optimistic DRAG the same way pendingOptimisticCreatesRef already guards
// an optimistic CREATE (see handleTaskOptimisticAdd/handleTaskCreated in
// board.tsx) — a realtime `tasks` UPDATE for a task whose drag Server
// Action is still in flight must be ignored, or it can stomp the
// just-applied optimistic move with a stale pre-drop row.
//
// This repo has no jsdom/@testing-library setup (vitest.config.ts pins
// `environment: "node"`; see tests/unit/board-dnd-setup.test.ts and
// tests/unit/board-optimistic-rollback-toast.test.ts for the established
// rationale/pattern). Following that same established pattern, this file
// inspects board.tsx's source to prove: the guard is populated before the
// optimistic `setTasks(next)` call's follow-on Server Action dispatch, the
// realtime callback consults it and skips matching UPDATEs, and — the
// crux of this feature — the guard is released in EVERY terminal path
// (ok:true, ok:false, and a thrown rejection) of EVERY Server Action a
// single drop can dispatch, not just the success path.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

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

const boardSource = readFileSync(
  fileURLToPath(new URL("../../components/board/board.tsx", import.meta.url)),
  "utf-8",
);

describe("Board optimistic-move / realtime-echo guard (F010)", () => {
  it("declares a pendingMovesRef used to guard in-flight drags", () => {
    expect(boardSource).toMatch(/const pendingMovesRef = useRef</);
  });

  // AS-025: the realtime tasks UPDATE handler must skip an id currently
  // guarded by pendingMovesRef, leaving `current` untouched.
  it("the realtime UPDATE handler checks pendingMovesRef before applying the event, and bails out unchanged when the id is guarded", () => {
    const guardCheck = boardSource.match(
      /event\.eventType === "UPDATE"[\s\S]{0,120}pendingMovesRef\.current\.has\(event\.new\.id\)[\s\S]{0,40}\{\s*return current;\s*\}/,
    );
    expect(guardCheck).not.toBeNull();
  });

  // Mutant guard: the check must live INSIDE useBoardRealtime's callback,
  // ahead of the existing INSERT-placeholder-matching logic, so it can
  // never accidentally be reached only from a code path that doesn't run
  // for every event.
  it("the guard check precedes the existing INSERT optimistic-create handling in the same callback", () => {
    const useBoardRealtimeIndex = boardSource.indexOf("useBoardRealtime(projectId, (event) => {");
    const guardIndex = boardSource.indexOf("pendingMovesRef.current.has(event.new.id)");
    const insertPendingIndex = boardSource.indexOf(
      'event.eventType === "INSERT" && event.new',
      useBoardRealtimeIndex,
    );

    expect(useBoardRealtimeIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeGreaterThan(useBoardRealtimeIndex);
    expect(insertPendingIndex).toBeGreaterThan(guardIndex);
  });

  // AS-025/AS-026/AS-027: the id must be added to the guard BEFORE the
  // drag's Server Action(s) are dispatched (immediately after the
  // optimistic setTasks(next), same event-handler tick), not after.
  it("adds the moved task's id to the guard before dispatching its Server Action(s)", () => {
    const setTasksNextIndex = boardSource.indexOf("setTasks(next);");
    const addPendingMoveCallIndex = boardSource.indexOf(
      "addPendingMove(movedTask.id, pendingCallCount);",
    );
    const moveAndReorderTaskCallIndex = boardSource.indexOf("void moveAndReorderTask(");

    expect(setTasksNextIndex).toBeGreaterThan(-1);
    expect(addPendingMoveCallIndex).toBeGreaterThan(setTasksNextIndex);
    expect(moveAndReorderTaskCallIndex).toBeGreaterThan(addPendingMoveCallIndex);
  });

  // A single drop can dispatch a status/position call PLUS an independent
  // cross-lane group-field call (editTask/setTaskAssignees/updateTaskTags)
  // — the guard's count must account for both, or the id gets released
  // while a second call is still in flight.
  it("tracks a per-drop call count so a cross-lane drag (two independent Server Actions) isn't released early", () => {
    expect(boardSource).toMatch(
      /const pendingCallCount = crossLane \? 2 : 1;/,
    );
  });

  // AS-026, AS-027: releasePendingMove must fire on every terminal path —
  // this is the actual bug this feature exists to prevent, so the test
  // counts total release call sites and confirms each is wired into a
  // `.finally()` (which runs on both the `.then` and `.catch` branches),
  // not only inside the `.then` (success) branch.
  it("releases the guard from a .finally() on every Server Action call the drag handler can dispatch, not only on success", () => {
    const releaseCalls = boardSource.match(
      /\.finally\(\(\)\s*=>\s*{\s*(?:\/\/[^\n]*\n\s*)*releasePendingMove\(movedTask\.id\);\s*}\)/g,
    ) ?? [];
    // One release site per Server Action call handleDragEnd can dispatch:
    // moveAndReorderTask, reorderTask, editTask, setTaskAssignees,
    // updateTaskTags.
    expect(releaseCalls.length).toBe(5);
  });

  it("never releases the guard directly from inside a .then() success branch only (would race a still-in-flight sibling call)", () => {
    // A release call sitting directly inside `if (!result.ok) { ... }`
    // (i.e. only reachable on failure, or only reachable on success) would
    // fail to release on the opposite outcome. Assert every release call
    // site is reachable regardless of outcome by requiring it live in
    // `.finally`, already covered above — this test guards against a
    // regression where releasePendingMove is moved out of `.finally` and
    // into just one of `.then`/`.catch`.
    const thenOnlyRelease = /\.then\(\(result\)\s*=>\s*{\s*if\s*\(![\s\S]{0,40}releasePendingMove/;
    expect(boardSource).not.toMatch(thenOnlyRelease);
  });

  it("renders without crashing with the guard in place", () => {
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
