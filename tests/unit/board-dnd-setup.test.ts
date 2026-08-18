// Smoke test for F043 (dnd-kit setup, no assertions — foundation feature).
//
// This feature is inherently interactive drag behavior (pointer/keyboard
// drag-and-drop), and per this feature's own clarified spec a full E2E
// drag test isn't required at this stage — that's F090, once F045/F046
// have added server persistence to actually verify end-to-end. What *can*
// and should be verified now, without a browser:
//
//   1. The real component tree (Board -> DndContext -> BoardColumn's
//      SortableContext/useDroppable -> SortableTaskCard's useSortable)
//      renders server-side without crashing and produces the expected
//      task/column markup — proves the dnd-kit wiring doesn't blow up the
//      render, which is the main risk of a "just wire it up" infra
//      feature like this one.
//   2. The KeyboardSensor is actually configured (source-level check),
//      since the DoD calls it out as "required, not optional" and a
//      render-only test can't otherwise distinguish "keyboard sensor
//      wired up" from "keyboard sensor silently missing" — dnd-kit's
//      sensors only activate on real browser input events, which a
//      jsdom-less `environment: "node"` unit test (this repo's existing
//      pattern for board tests, see board-column.test.ts) cannot simulate.
//
// A jsdom/Testing-Library-driven interaction test (actually pressing
// arrow keys and asserting a card moves) is left to F090 per the
// clarified spec, once there's real persisted state worth asserting
// end-to-end against.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

// Board now renders <NewTaskDialog>, which calls useRouter — stub it out
// since this test SSR-renders Board directly with no Next app-router
// context mounted (this repo's tests use `environment: "node"`, no jsdom).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
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

describe("Board dnd-kit setup (F043, no assertions)", () => {
  it("renders the DndContext-wrapped board without crashing, with all columns and tasks present", () => {
    const html = renderToStaticMarkup(createElement(Board, { projectId: "project-1", initialTasks: TASKS, timezone: "UTC" }));

    // All 4 fixed columns still present (DndContext/SortableContext
    // wiring doesn't disturb F042's column rendering).
    expect(html).toContain("To Do");
    expect(html).toContain("In Progress");
    expect(html).toContain("In Review");
    expect(html).toContain("Done");

    // Both seeded tasks render inside their columns.
    expect(html).toContain("Todo task");
    expect(html).toContain("In progress task");
  });

  it("renders an empty board (no tasks in any column) without crashing", () => {
    const html = renderToStaticMarkup(createElement(Board, { projectId: "project-1", initialTasks: [], timezone: "UTC" }));

    expect(html).toContain("No tasks");
  });

  it("configures both a PointerSensor and a KeyboardSensor with a sortable keyboard coordinate getter", () => {
    // Source-level check (see file header for why): confirms the sensors
    // array actually wires up KeyboardSensor, not just imports it unused.
    expect(boardSource).toMatch(/import\s*\{[^}]*PointerSensor[^}]*\}\s*from\s*["']@dnd-kit\/core["']/);
    expect(boardSource).toMatch(/import\s*\{[^}]*KeyboardSensor[^}]*\}\s*from\s*["']@dnd-kit\/core["']/);
    expect(boardSource).toMatch(/useSensor\(\s*PointerSensor/);
    expect(boardSource).toMatch(/useSensor\(\s*KeyboardSensor/);
    expect(boardSource).toMatch(/coordinateGetter:\s*sortableKeyboardCoordinates/);
  });

  it("renders a DragOverlay element in the tree (for the actively-dragged card)", () => {
    // DragOverlay with no active drag renders an empty portal-less
    // container in SSR; presence of the import/usage plus a crash-free
    // render is the meaningful signal here (an actual dragged-card
    // snapshot requires real pointer/keyboard events, out of scope per
    // the file header above).
    expect(boardSource).toMatch(/import\s*\{[^}]*DragOverlay[^}]*\}\s*from\s*["']@dnd-kit\/core["']/);
    expect(boardSource).toMatch(/<DragOverlay>/);
  });
});
