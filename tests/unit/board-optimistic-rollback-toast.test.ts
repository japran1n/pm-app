// F047 (AS-077): on drop, the board's local state must already reflect the
// card's new column/position *before* either Server Action call resolves
// (dnd-kit's sortable visuals already do this during the drag gesture, but
// F047 is about the state persisting through the async window after drop),
// and roll back to the pre-drop snapshot with an error toast if EITHER
// action comes back ok:false (or throws).
//
// Updated for F102 (fixing M5-scrutiny.md Finding 2): a cross-column drag
// no longer calls moveTaskStatus and reorderTask as two independent calls
// — it calls the single atomic moveAndReorderTask instead, so a failure
// can never leave the server with a committed status and a stale position.
// A same-column reorder (status unchanged) still calls reorderTask alone.
//
// This repo has no jsdom/@testing-library setup (vitest.config.ts pins
// `environment: "node"` — see the rationale in tests/unit/board-dnd-setup.
// test.ts, which defers real drag-gesture interaction testing to F090's
// Playwright suite, since dnd-kit's sensors only activate on real browser
// pointer/keyboard events). Given that constraint this test follows the
// same established pattern as tests/unit/board-move-status-wiring.test.ts:
// it renders the real component tree to prove nothing crashes with the
// mocked actions in place, and inspects board.tsx's source to prove (a)
// the optimistic update happens synchronously inside the same setTasks
// updater that computes the drop (i.e. before the action promises settle,
// not after), (b) a failure from either action triggers rollback to the
// pre-drop `current` snapshot, (c) a failure from either action shows an
// error toast via sonner, and (d) a thrown rejection is also caught and
// treated as a failure (not just an ok:false response).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

vi.mock("@/lib/actions/tasks", () => ({
  moveAndReorderTask: vi.fn(async () => ({ ok: false, error: "Could not move task." })),
  reorderTask: vi.fn(async () => ({ ok: false, error: "Could not reorder task." })),
}));

import { Board } from "@/components/board/board";
import type { TaskCardTask } from "@/components/task/task-card";

const TASKS: TaskCardTask[] = [
  { id: "t1", title: "Todo task", status: "todo", priority: null, assigneeId: null, dueDate: null, position: 1000 },
  { id: "t2", title: "In progress task", status: "in_progress", priority: null, assigneeId: null, dueDate: null, position: 1000 },
];

const boardSource = readFileSync(
  fileURLToPath(new URL("../../components/board/board.tsx", import.meta.url)),
  "utf-8",
);

describe("Board optimistic drop + rollback + error toast (F047: AS-077)", () => {
  it("renders with both actions mocked to fail, without crashing", () => {
    const html = renderToStaticMarkup(createElement(Board, { projectId: "project-1", initialTasks: TASKS }));
    expect(html).toContain("Todo task");
    expect(html).toContain("In progress task");
  });

  it("imports sonner's toast for error feedback", () => {
    expect(boardSource).toMatch(
      /import\s*{\s*toast\s*}\s*from\s*["']sonner["']/,
    );
  });

  it("computes and applies the moved card's new status/position synchronously inside the setTasks updater, before either Server Action call", () => {
    // The `next` array (containing `movedTask` with its final status/
    // position already applied) must be returned by the setTasks updater
    // — i.e. committed to local state — and the action calls must appear
    // textually after that computation, proving the optimistic update
    // isn't deferred until the actions resolve.
    const setTasksUpdaterIndex = boardSource.indexOf("setTasks((current) => {");
    const movedTaskIndex = boardSource.indexOf("const movedTask = {");
    const moveAndReorderTaskCallIndex = boardSource.indexOf("void moveAndReorderTask(");
    const reorderTaskCallIndex = boardSource.indexOf("void reorderTask(");
    const returnNextIndex = boardSource.indexOf("return next;");

    expect(setTasksUpdaterIndex).toBeGreaterThan(-1);
    expect(movedTaskIndex).toBeGreaterThan(setTasksUpdaterIndex);
    expect(moveAndReorderTaskCallIndex).toBeGreaterThan(movedTaskIndex);
    expect(reorderTaskCallIndex).toBeGreaterThan(movedTaskIndex);
    // The optimistic state (`next`, built from `movedTask`) is returned
    // from the same synchronous updater pass that kicks off the async
    // action calls — the UI is already showing the new position while the
    // network calls below are still in flight.
    expect(returnNextIndex).toBeGreaterThan(reorderTaskCallIndex);
  });

  it("defines a shared rollback() helper that restores the pre-drop `current` snapshot and shows an error toast", () => {
    expect(boardSource).toMatch(
      /function rollback\([^)]*\)\s*{[\s\S]*?setTasks\(current\);[\s\S]*?toast\.error\(/,
    );
  });

  it("rolls back via the shared helper when moveAndReorderTask resolves ok:false", () => {
    expect(boardSource).toMatch(
      /void moveAndReorderTask\([\s\S]*?if\s*\(\s*!result\.ok\s*\)\s*{\s*rollback\(/,
    );
  });

  it("rolls back via the shared helper when reorderTask resolves ok:false", () => {
    expect(boardSource).toMatch(
      /void reorderTask\([\s\S]*?if\s*\(\s*!result\.ok\s*\)\s*{\s*rollback\(/,
    );
  });

  it("also rolls back if either action call throws/rejects, not just on ok:false", () => {
    const catchBlocks = boardSource.match(/\.catch\(\(\)\s*=>\s*{\s*rollback\(/g) ?? [];
    // One .catch(...) => rollback(...) per action call (moveTaskStatus and
    // reorderTask).
    expect(catchBlocks.length).toBeGreaterThanOrEqual(2);
  });

  it("guards against a double rollback/double toast when both actions fail", () => {
    expect(boardSource).toMatch(/let rolledBack = false;/);
    expect(boardSource).toMatch(/if\s*\(\s*rolledBack\s*\)\s*return;/);
  });
});
