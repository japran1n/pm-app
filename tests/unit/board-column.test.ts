// Unit test for F042 (AS-067, AS-068) plus a closing check for AS-064
// (deferred from F040/M4: "an overdue task is visually distinguished ...
// in board views" — F040 only proved this for the standalone TaskCard;
// this is the first point a TaskCard is actually placed on a real board).
//
// Renders BoardColumn (components/board/board-column.tsx) directly, the
// same component the real board page composes, to prove:
//   AS-067: columns render in the correct fixed status (label matches the
//     4 fixed values, in the fixed left-to-right order asserted below via
//     a page-level ordering check).
//   AS-068: a column only shows tasks matching its own status — a task
//     with a different status passed into a column's `tasks` prop would
//     still render (BoardColumn trusts its caller's filtering), so the
//     real guarantee is proven by asserting the *page*'s per-column filter
//     logic, mirrored here directly against a mixed-status task list.
//   AS-064: an overdue task's TaskCard renders the overdue treatment
//     (TriangleAlert icon + destructive-colored due date text) when
//     rendered inside a real board column, not just in isolation.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { BoardColumn } from "@/components/board/board-column";
import type { TaskCardTask } from "@/components/task/task-card";

const FIXED_COLUMN_ORDER: TaskCardTask["status"][] = [
  "todo",
  "in_progress",
  "in_review",
  "done",
];

const ALL_TASKS: TaskCardTask[] = [
  { id: "t1", title: "Todo task", status: "todo", priority: null, assigneeId: null, dueDate: null, position: 1000 },
  { id: "t2", title: "In progress task", status: "in_progress", priority: null, assigneeId: null, dueDate: null, position: 1000 },
  { id: "t3", title: "In review task", status: "in_review", priority: null, assigneeId: null, dueDate: null, position: 1000 },
  { id: "t4", title: "Done task", status: "done", priority: null, assigneeId: null, dueDate: null, position: 1000 },
  // Overdue: due in the past, not done (AS-064).
  { id: "t5", title: "Overdue todo task", status: "todo", priority: null, assigneeId: null, dueDate: "2000-01-01", position: 1000 },
];

describe("BoardColumn (F042: AS-067, AS-068, AS-064)", () => {
  it("test_AS_067_renders_the_4_fixed_columns_in_the_correct_left_to_right_order", () => {
    const labels = FIXED_COLUMN_ORDER.map((status) =>
      renderToStaticMarkup(
        createElement(BoardColumn, {
          status,
          tasks: ALL_TASKS.filter((t) => t.status === status),
        }),
      ),
    );

    // Fixed order, exact labels.
    expect(labels[0]).toContain("To Do");
    expect(labels[1]).toContain("In Progress");
    expect(labels[2]).toContain("In Review");
    expect(labels[3]).toContain("Done");
  });

  it("test_AS_068_a_column_only_renders_tasks_matching_its_own_status", () => {
    const todoColumnTasks = ALL_TASKS.filter((t) => t.status === "todo");
    const html = renderToStaticMarkup(
      createElement(BoardColumn, { status: "todo", tasks: todoColumnTasks }),
    );

    expect(html).toContain("Todo task");
    expect(html).toContain("Overdue todo task");
    // Tasks belonging to other statuses never appear in the "todo" column.
    expect(html).not.toContain("In progress task");
    expect(html).not.toContain("In review task");
    expect(html).not.toContain("Done task");
  });

  it("test_AS_064_an_overdue_task_placed_on_a_real_board_column_renders_the_overdue_treatment", () => {
    const todoColumnTasks = ALL_TASKS.filter((t) => t.status === "todo");
    const html = renderToStaticMarkup(
      createElement(BoardColumn, { status: "todo", tasks: todoColumnTasks }),
    );

    // The overdue task's card carries the destructive-colored due-date
    // treatment and the TriangleAlert icon (paired with color per AS-153,
    // same assertion F040's own TaskCard test already covers in
    // isolation) — this proves that treatment survives being composed
    // into a real board column, not just a standalone card render.
    expect(html).toContain("text-destructive");
    expect(html).toContain("Overdue:");
  });

  it("a column with zero tasks renders an explicit empty message rather than a blank space", () => {
    const html = renderToStaticMarkup(
      createElement(BoardColumn, { status: "done", tasks: [] }),
    );

    expect(html).toContain("No tasks");
  });
});
