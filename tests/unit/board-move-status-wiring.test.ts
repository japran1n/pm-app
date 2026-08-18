// Component-level check for F045 (AS-069) + F046 (AS-070, AS-078, AS-079,
// AS-080), updated by F102 (fixing M5-scrutiny.md Finding 2), that a drop
// wires into the correct Server Action(s): moveAndReorderTask for a
// cross-column drag (status changed), reorderTask alone for a same-column
// reorder (status unchanged).
//
// This repo has no jsdom/@testing-library setup (vitest.config.ts pins
// `environment: "node"`, and dnd-kit's sensors only activate on real
// browser pointer/keyboard events anyway — see the rationale in
// tests/unit/board-dnd-setup.test.ts, which defers actual drag-interaction
// testing to F090). Given that constraint, this test mirrors that file's
// established pattern of a source-level check: it renders the real
// component tree to prove nothing crashes, and inspects board.tsx's
// source to confirm the onDragEnd handler (a) imports moveAndReorderTask
// and reorderTask, (b) only calls moveAndReorderTask when the dropped
// task's status actually changed (not on a same-column reorder), passing
// both the new status and the new position together, (c) calls reorderTask
// alone (no status arg) when the column didn't change, and (d) rolls back
// optimistic state on failure.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

vi.mock("@/lib/actions/tasks", () => ({
  moveAndReorderTask: vi.fn(async () => ({ ok: true, data: { id: "t1", status: "in_progress", position: 1000 } })),
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

describe("Board onDragEnd -> moveAndReorderTask/reorderTask wiring (F045: AS-069, F102: AS-077)", () => {
  it("renders with the mocked actions in place without crashing", () => {
    const html = renderToStaticMarkup(createElement(Board, { projectId: "project-1", initialTasks: TASKS }));
    expect(html).toContain("Todo task");
    expect(html).toContain("In progress task");
  });

  it("imports moveAndReorderTask from lib/actions/tasks", () => {
    expect(boardSource).toMatch(
      /import\s*{[^}]*moveAndReorderTask[^}]*}\s*from\s*["']@\/lib\/actions\/tasks["']/,
    );
  });

  it("calls moveAndReorderTask only when movedTask.status differs from the task's original status (AS-069/AS-077: cross-column drop persists status+position atomically)", () => {
    expect(boardSource).toMatch(
      /if\s*\(\s*movedTask\.status\s*!==\s*activeTask\.status\s*\)\s*{[\s\S]*?moveAndReorderTask\(/,
    );
  });

  it("passes the moved task's id, its new column status, AND its new position to moveAndReorderTask", () => {
    expect(boardSource).toMatch(
      /moveAndReorderTask\(\s*movedTask\.id,\s*movedTask\.status,\s*newPosition\s*\)/,
    );
  });

  it("calls reorderTask (not moveAndReorderTask) when the status did NOT change, i.e. a same-column reorder", () => {
    expect(boardSource).toMatch(
      /}\s*else\s*{[\s\S]*?reorderTask\(\s*movedTask\.id,\s*newPosition\s*\)/,
    );
  });

  it("rolls back local state to the pre-drop snapshot when either action fails (F047: AS-077 -- rollback funnels through a shared rollback() helper that calls setTasks(current))", () => {
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

  it("computes the moved task's new position via calculatePosition before either action is called", () => {
    expect(boardSource).toMatch(/calculatePosition\(/);
  });
});
