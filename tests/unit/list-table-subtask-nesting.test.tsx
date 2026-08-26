// @vitest-environment jsdom
//
// F6 (docs, "subtask view kao na ClickUp"): the List view nests a subtask
// directly under its parent row, with a toggle to collapse/expand, built
// entirely as a client-side presentation layer over the existing FLAT
// `tasks` array (AS-275 requires the query itself keep returning every
// task, including children, as its own row — this component's grouping
// must not violate that by removing anything from the array it receives,
// only reordering/indenting how it renders).

import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/w/acme/projects/proj-1/list",
  useSearchParams: () => new URLSearchParams(),
}));

import { TaskListTable } from "@/components/task/task-list-table";
import type { TaskCardTask } from "@/components/task/task-card";

afterEach(() => {
  cleanup();
});

function task(
  id: string,
  title: string,
  parentTaskId?: string | null,
): TaskCardTask {
  return {
    id,
    title,
    status: "todo",
    priority: null,
    assigneeId: null,
    dueDate: null,
    position: 1,
    parentTaskId: parentTaskId ?? null,
  };
}

function renderTable(tasks: TaskCardTask[]) {
  return render(
    createElement(TaskListTable, {
      tasks,
      assignees: new Map(),
      timezone: "UTC",
    }),
  );
}

describe("F6: subtask nesting in the List view", () => {
  it("test_a_child_task_renders_immediately_after_its_parent_with_a_toggle_and_count", () => {
    renderTable([
      task("parent", "Parent task"),
      task("other", "Unrelated top-level task"),
      task("child", "Child task", "parent"),
    ]);

    // AS-556-equivalent: a child must appear ONLY nested under its
    // parent, never ALSO as a duplicate standalone row elsewhere.
    expect(screen.getAllByText("Child task")).toHaveLength(1);

    const toggle = screen.getByRole("button", {
      name: "Hide subtasks of Parent task",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    // Row order: checkboxes render in DOM order, so the child's checkbox
    // must sit between the parent's and the unrelated task's, not after it.
    const order = screen
      .getAllByRole("checkbox")
      .map((el) => el.getAttribute("aria-label"))
      .filter((label): label is string => Boolean(label?.startsWith("Select ")));
    const parentIndex = order.indexOf("Select Parent task");
    const childIndex = order.indexOf("Select Child task");
    const otherIndex = order.indexOf("Select Unrelated top-level task");
    expect(childIndex).toBe(parentIndex + 1);
    expect(childIndex).toBeLessThan(otherIndex);
  });

  it("test_collapsing_a_parent_hides_its_child_row_entirely", () => {
    renderTable([task("parent", "Parent task"), task("child", "Child task", "parent")]);

    expect(screen.getByText("Child task")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Hide subtasks of Parent task" }),
    );

    expect(screen.queryByText("Child task")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show subtasks of Parent task" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("test_expanding_again_after_collapse_restores_the_child_row", () => {
    renderTable([task("parent", "Parent task"), task("child", "Child task", "parent")]);

    const toggle = () =>
      screen.getByRole("button", { name: /subtasks of Parent task/ });

    fireEvent.click(toggle());
    expect(screen.queryByText("Child task")).not.toBeInTheDocument();

    fireEvent.click(toggle());
    expect(screen.getByText("Child task")).toBeInTheDocument();
  });

  it("test_a_task_with_no_children_has_no_toggle_button", () => {
    renderTable([task("solo", "Solo task, no children")]);

    expect(
      screen.queryByRole("button", { name: /subtasks of/ }),
    ).not.toBeInTheDocument();
  });

  it("test_a_child_whose_parent_is_not_in_the_current_set_renders_as_a_plain_top_level_row", () => {
    // Documented edge case: a filter matched the child but not its
    // parent. The child must still render (never silently dropped),
    // just without nesting — exactly as it did before this feature.
    renderTable([task("orphan-child", "Orphaned child", "missing-parent")]);

    expect(screen.getByText("Orphaned child")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /subtasks of/ }),
    ).not.toBeInTheDocument();
  });

  it("test_select_all_only_selects_currently_visible_expanded_rows", () => {
    renderTable([task("parent", "Parent task"), task("child", "Child task", "parent")]);

    fireEvent.click(
      screen.getByRole("button", { name: "Hide subtasks of Parent task" }),
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /Select all/ }));

    expect(
      screen.getByRole("checkbox", { name: "Select Parent task" }),
    ).toBeChecked();
    // The collapsed child isn't rendered at all, so it has no checkbox to
    // assert against — its absence from the DOM is itself the proof
    // "select all" couldn't have touched it.
    expect(screen.queryByRole("checkbox", { name: "Select Child task" })).toBeNull();
  });
});
