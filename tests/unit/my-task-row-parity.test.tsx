// @vitest-environment jsdom
//
// Portal-parity fix ("My Tasks should look like Dashboard"): My Tasks used
// to render each row as a bespoke flex-wrap <div>, visually different from
// the shared <TaskListTable> row used by the project List view and the
// workspace Dashboard table. <MyTaskRowItem> now renders inside the same
// <Table>/<TableRow>/<TableCell> primitives, with the whole row clickable
// (except interactive controls) — same convention as
// tests/unit/list-table-bulk-selection.test.tsx and
// tests/unit/list-table-subtask-nesting.test.tsx assert for TaskListTable.

import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/actions/tasks", () => ({
  editTask: vi.fn(async () => ({ ok: true })),
  moveTaskStatus: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/components/auth/membership-provider", () => ({
  useMembership: () => null,
}));

import { Table, TableBody } from "@/components/ui/table";
import { MyTaskRowItem } from "@/components/task/my-task-row";
import type { MyTaskRow } from "@/lib/queries/my-tasks";

afterEach(() => {
  cleanup();
  pushMock.mockClear();
});

function makeRow(overrides: Partial<MyTaskRow> = {}): MyTaskRow {
  return {
    id: "task-1",
    title: "Write the report",
    status: "todo",
    statusCategory: null,
    priority: "high",
    dueDate: null,
    number: 1,
    projectId: "proj-1",
    projectKey: "ACME",
    projectName: "Acme project",
    isDone: false,
    bucket: "today",
    isWatched: false,
    isAssigned: true,
    clientVisible: false,
    pendingClientApproval: false,
    ...overrides,
  } as MyTaskRow;
}

function renderRow(row: MyTaskRow) {
  return render(
    createElement(
      Table,
      null,
      createElement(
        TableBody,
        null,
        createElement(MyTaskRowItem, {
          row,
          workspaceSlug: "acme",
          timezone: "UTC",
        }),
      ),
    ),
  );
}

describe("Portal-parity: My Tasks row uses the shared table row primitives", () => {
  it("test_my_task_row_renders_as_a_table_row_with_key_title_and_project_badge", () => {
    renderRow(makeRow());

    expect(screen.getByRole("button", { name: /Write the report/ })).toBeInTheDocument();
    expect(screen.getByText("Write the report")).toBeInTheDocument();
    expect(screen.getByText("Acme project")).toBeInTheDocument();
    expect(screen.getByText("ACME-1")).toBeInTheDocument();
  });

  it("test_clicking_the_row_navigates_to_the_tasks_own_project_board", () => {
    renderRow(makeRow());

    fireEvent.click(screen.getByRole("button", { name: /Write the report/ }));

    expect(pushMock).toHaveBeenCalledWith(
      "/w/acme/projects/proj-1/board?taskId=task-1",
    );
  });

  it("test_clicking_the_priority_control_does_not_also_navigate_the_row", () => {
    renderRow(makeRow());

    // The priority control is a shadcn Select trigger — clicking it must
    // stopPropagation so it doesn't also trigger the row's own onClick
    // navigation, same convention TaskListTable's own cells use.
    const priorityTrigger = screen.getByLabelText(/Change priority for task/i);
    fireEvent.click(priorityTrigger);

    expect(pushMock).not.toHaveBeenCalled();
  });

  it("test_watched_only_row_shows_a_watching_badge", () => {
    renderRow(makeRow({ isWatched: true, isAssigned: false }));

    expect(screen.getByText("Watching")).toBeInTheDocument();
  });

  it("test_assigned_and_watched_row_does_not_show_a_watching_badge", () => {
    renderRow(makeRow({ isWatched: true, isAssigned: true }));

    expect(screen.queryByText("Watching")).not.toBeInTheDocument();
  });
});
