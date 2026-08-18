// F107: regression test for M8-scrutiny.md Finding 1 — a React "Cannot
// update a component while rendering a different component" (setState
// during render) console warning was observed during the board's
// drag-and-drop reorder flow, caused by board.tsx's onDragEnd handler
// computing its optimistic update AND kicking off the persistence Server
// Action calls (plus a rollback() that itself calls setTasks) all from
// inside a `setTasks((current) => { ... })` functional-updater callback.
// React can invoke that updater during its own render/commit work for the
// update, so starting async work and a nested setTasks call from in there
// is the anti-pattern that produced the warning.
//
// The fix hoists the whole computation, the `setTasks(next)` call, the
// action calls, and the `rollback` closure into handleDragEnd's own
// scope — a genuine event-handler context — so no `setTasks` call is ever
// triggered from inside another state updater. This test inspects
// board.tsx's source (following the same source-inspection pattern as
// board-optimistic-rollback-toast.test.ts and board-move-status-wiring.
// test.ts, since this repo's vitest environment is "node" with no jsdom,
// so real pointer-drag interaction is only exercised by tests/e2e/
// board-reorder.spec.ts) to prove the anti-pattern is gone and stays gone.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const boardSource = readFileSync(
  fileURLToPath(new URL("../../components/board/board.tsx", import.meta.url)),
  "utf-8",
);

function extractHandleDragEndBody(source: string): string {
  const start = source.indexOf("function handleDragEnd(");
  if (start === -1) throw new Error("handleDragEnd not found in board.tsx");
  const end = source.indexOf("\n  return (", start);
  if (end === -1) throw new Error("Could not find end of handleDragEnd");
  return source.slice(start, end);
}

const handleDragEndBody = extractHandleDragEndBody(boardSource);

describe("Board handleDragEnd does not setState during render (F107)", () => {
  it("does not use a setTasks functional updater (`setTasks((current) => ...)`) anywhere inside handleDragEnd", () => {
    // The old pattern computed the whole drop, the action calls, and the
    // rollback helper inside this callback. Its complete absence from
    // handleDragEnd specifically (the realtime reconciliation callback
    // elsewhere in the component legitimately uses a functional updater,
    // since it's a genuine subscription-event callback, not something
    // that runs during another component's render) is the signal that the
    // drop computation moved out into the handler's own scope.
    expect(handleDragEndBody).not.toMatch(/setTasks\(\s*\(\s*current\s*\)\s*=>/);
  });

  it("calls setTasks with a plain computed value (`setTasks(next)`), not from inside another setState updater", () => {
    expect(boardSource).toMatch(/setTasks\(next\);/);
  });

  it("kicks off the persistence Server Action calls (moveAndReorderTask/reorderTask) only after the plain setTasks(next) commit, in handleDragEnd's own scope", () => {
    const handleDragEndIndex = boardSource.indexOf("function handleDragEnd(");
    const setTasksNextIndex = boardSource.indexOf("setTasks(next);");
    const moveAndReorderTaskCallIndex = boardSource.indexOf(
      "void moveAndReorderTask(",
    );
    const reorderTaskCallIndex = boardSource.indexOf("void reorderTask(");
    const nextHandlerOrReturnIndex = boardSource.indexOf(
      "return (",
      handleDragEndIndex,
    );

    expect(handleDragEndIndex).toBeGreaterThan(-1);
    expect(setTasksNextIndex).toBeGreaterThan(handleDragEndIndex);
    expect(moveAndReorderTaskCallIndex).toBeGreaterThan(setTasksNextIndex);
    expect(reorderTaskCallIndex).toBeGreaterThan(setTasksNextIndex);
    // Both calls (and the setTasks(next) commit before them) still live
    // inside handleDragEnd, not after it closes into the component's JSX
    // return.
    expect(moveAndReorderTaskCallIndex).toBeLessThan(nextHandlerOrReturnIndex);
    expect(reorderTaskCallIndex).toBeLessThan(nextHandlerOrReturnIndex);
  });

  it("rollback() calls setTasks(snapshot) from handleDragEnd's own scope, not from inside a setState updater", () => {
    expect(boardSource).toMatch(
      /function rollback\([^)]*\)\s*{[\s\S]*?setTasks\(snapshot\);/,
    );
  });
});
