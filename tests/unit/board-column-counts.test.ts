// F051 (AS-083): the board's column task counts must update immediately
// after a drag-and-drop move (or a Realtime reconciliation event), without
// a manual refresh -- because the count BoardColumn renders is derived
// directly from the `tasks` prop it's given each render, and board.tsx
// passes it a live filter of its own `tasks` state array (`useState` in
// Board), the same array both handleDragEnd's optimistic update and
// useBoardRealtime's reconcileTask both mutate via setTasks. There is no
// separate "count computed once" value anywhere.
//
// This repo has no jsdom/@testing-library setup (vitest.config.ts pins
// `environment: "node"` -- see tests/unit/board-dnd-setup.test.ts for the
// rationale, and tests/unit/board-move-status-wiring.test.ts /
// board-optimistic-rollback-toast.test.ts for the established pattern this
// test follows: render the real BoardColumn component to prove the count
// text, plus a source-level check that board.tsx never computes a count
// independently of `tasks`).
//
// The two "render" tests below simulate exactly what handleDragEnd's
// setTasks updater in board.tsx produces on a real cross-column drop: a
// new `next` tasks array with the moved task's status flipped, filtered
// per-column the same way board.tsx's JSX does
// (`tasks.filter((task) => task.status === status)`). Rendering
// BoardColumn against the pre-move and post-move arrays proves both the
// source and destination columns' displayed counts update correctly.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { BoardColumn } from "@/components/board/board-column";
import type { TaskCardTask } from "@/components/task/task-card";

const boardSource = readFileSync(
  fileURLToPath(new URL("../../components/board/board.tsx", import.meta.url)),
  "utf-8",
);
const boardColumnSource = readFileSync(
  fileURLToPath(new URL("../../components/board/board-column.tsx", import.meta.url)),
  "utf-8",
);

const INITIAL_TASKS: TaskCardTask[] = [
  { id: "t1", title: "Todo task A", status: "todo", priority: null, assigneeId: null, dueDate: null, position: 1000 },
  { id: "t2", title: "Todo task B", status: "todo", priority: null, assigneeId: null, dueDate: null, position: 2000 },
  { id: "t3", title: "In progress task", status: "in_progress", priority: null, assigneeId: null, dueDate: null, position: 1000 },
];

function countFor(tasks: TaskCardTask[], status: TaskCardTask["status"]) {
  const html = renderToStaticMarkup(
    createElement(BoardColumn, {
      status,
      tasks: tasks.filter((t) => t.status === status),
    }),
  );
  return html;
}

describe("BoardColumn task count (F051: AS-083)", () => {
  it("renders the count in the column header, e.g. 'To Do (2)'", () => {
    const html = renderToStaticMarkup(
      createElement(BoardColumn, {
        status: "todo",
        tasks: INITIAL_TASKS.filter((t) => t.status === "todo"),
      }),
    );
    expect(html).toContain("To Do");
    expect(html).toContain("(2)");
  });

  it("test_AS_083_source_and_destination_column_counts_update_after_a_simulated_drag_and_drop_move", () => {
    // Pre-move: todo has 2, in_progress has 1 -- mirrors board.tsx's
    // per-column filter of its live `tasks` state before any drop.
    const beforeTodo = countFor(INITIAL_TASKS, "todo");
    const beforeInProgress = countFor(INITIAL_TASKS, "in_progress");
    expect(beforeTodo).toContain("(2)");
    expect(beforeInProgress).toContain("(1)");

    // Simulate exactly what handleDragEnd's setTasks updater in board.tsx
    // does on a cross-column drop of t1 (todo -> in_progress): build the
    // `next` array with the moved task's status flipped, everything else
    // untouched -- no separate count state exists anywhere to update.
    const movedTask = { ...INITIAL_TASKS[0], status: "in_progress" as const };
    const next = [movedTask, INITIAL_TASKS[1], INITIAL_TASKS[2]];

    // Post-move: todo drops to 1, in_progress grows to 2, derived by
    // re-rendering BoardColumn with the same live-filter approach --
    // proving both the source (todo) and destination (in_progress)
    // columns' displayed counts update correctly, immediately, from the
    // same state array.
    const afterTodo = countFor(next, "todo");
    const afterInProgress = countFor(next, "in_progress");
    expect(afterTodo).toContain("(1)");
    expect(afterTodo).not.toContain("(2)");
    expect(afterInProgress).toContain("(2)");
    expect(afterInProgress).not.toContain("(1)");
  });

  it("BoardColumn's count is computed from the `tasks` prop's length, not a separate prop or static value", () => {
    expect(boardColumnSource).toMatch(/tasks\.length/);
  });

  it("board.tsx passes each column the same live `tasks` state, filtered per status, that both onDragEnd and Realtime reconciliation mutate via setTasks -- so no stale/static count source exists", () => {
    expect(boardSource).toMatch(/const \[tasks, setTasks\] = useState\(initialTasks\)/);
    expect(boardSource).toMatch(
      /tasks=\{tasks\.filter\(\(task\) => task\.status === status\)\}/,
    );
    // The optimistic drag-and-drop path updates the same `tasks` state
    // (F107: via a plain `setTasks(next)` call in handleDragEnd's own
    // scope, not a functional updater — see
    // board-setstate-not-during-render.test.ts for why).
    expect(boardSource).toMatch(/setTasks\(next\);/);
    // Realtime reconciliation updates the same `tasks` state too.
    expect(boardSource).toMatch(
      /useBoardRealtime\(projectId, \(event\) => \{\s*setTasks\(\(current\) => reconcileTask\(current, event\)\);/,
    );
  });
});
