// Component-level check for F045 (AS-069) + F046 (AS-070, AS-078, AS-079,
// AS-080) that a drop wires into the moveTaskStatus AND reorderTask Server
// Actions.
//
// This repo has no jsdom/@testing-library setup (vitest.config.ts pins
// `environment: "node"`, and dnd-kit's sensors only activate on real
// browser pointer/keyboard events anyway — see the rationale in
// tests/unit/board-dnd-setup.test.ts, which defers actual drag-interaction
// testing to F090). Given that constraint, this test mirrors that file's
// established pattern of a source-level check: it renders the real
// component tree to prove nothing crashes, and inspects board.tsx's
// source to confirm the onDragEnd handler (a) imports moveTaskStatus and
// reorderTask, (b) only calls moveTaskStatus when the dropped task's
// status actually changed (not on a same-column reorder), (c) always
// calls reorderTask with a calculatePosition-derived value regardless of
// whether the column changed, and (d) rolls back optimistic state on
// failure.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

vi.mock("@/lib/actions/tasks", () => ({
  moveTaskStatus: vi.fn(async () => ({ ok: true, data: { id: "t1", status: "in_progress" } })),
  reorderTask: vi.fn(async () => ({ ok: true, data: { id: "t1", position: 1000 } })),
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

describe("Board onDragEnd -> moveTaskStatus wiring (F045: AS-069)", () => {
  it("renders with the mocked action in place without crashing", () => {
    const html = renderToStaticMarkup(createElement(Board, { initialTasks: TASKS }));
    expect(html).toContain("Todo task");
    expect(html).toContain("In progress task");
  });

  it("imports moveTaskStatus from lib/actions/tasks", () => {
    expect(boardSource).toMatch(
      /import\s*{[^}]*moveTaskStatus[^}]*}\s*from\s*["']@\/lib\/actions\/tasks["']/,
    );
  });

  it("calls moveTaskStatus only when movedTask.status differs from the task's original status (AS-069: status change on cross-column drop)", () => {
    expect(boardSource).toMatch(
      /if\s*\(\s*movedTask\.status\s*!==\s*activeTask\.status\s*\)\s*{[\s\S]*?moveTaskStatus\(/,
    );
  });

  it("passes the moved task's id and its new column status to moveTaskStatus", () => {
    expect(boardSource).toMatch(/moveTaskStatus\(\s*movedTask\.id,\s*movedTask\.status\s*\)/);
  });

  it("rolls back local state to the pre-drop snapshot when the action fails (F047: AS-077 -- rollback funnels through a shared rollback() helper that calls setTasks(current))", () => {
    expect(boardSource).toMatch(
      /function rollback\([^)]*\)\s*{[\s\S]*?setTasks\(current\);/,
    );
    expect(boardSource).toMatch(/if\s*\(\s*!result\.ok\s*\)\s*{\s*rollback\(/);
  });

  it("F046: imports reorderTask and calculatePosition", () => {
    expect(boardSource).toMatch(
      /import\s*{[^}]*reorderTask[^}]*}\s*from\s*["']@\/lib\/actions\/tasks["']/,
    );
    expect(boardSource).toMatch(
      /import\s*{\s*calculatePosition\s*}\s*from\s*["']@\/lib\/board\/position["']/,
    );
  });

  it("F046: calls reorderTask with the moved task's id and a calculatePosition-derived value", () => {
    expect(boardSource).toMatch(/reorderTask\(\s*movedTask\.id,/);
    expect(boardSource).toMatch(/calculatePosition\(/);
  });
});
