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
    taskType: null,
    estimateMinutes: null,
    totalMinutes: 0,
    ...overrides,
  } as MyTaskRow;
}

function renderRow(
  row: MyTaskRow,
  taskTypeOptions: { id: string; name: string; color: string }[] = [],
) {
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
          taskTypeOptions,
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

  // Dashboard/Project List parity follow-up: My Tasks previously omitted
  // the Type/Estimate/Logged columns TaskListTable's own row always shows —
  // these assert the same cells now render here too, using the identical
  // shared components (ListTaskTypeSelect, formatDuration), not lookalikes.
  it("test_my_task_row_renders_a_type_column_using_the_shared_type_select", () => {
    renderRow(makeRow({ taskType: { id: "type-1", name: "Bug", color: "#f00" } }), [
      { id: "type-1", name: "Bug", color: "#f00" },
    ]);

    expect(
      screen.getByLabelText(/Change task type for task task-1/i),
    ).toBeInTheDocument();
  });

  it("test_my_task_row_renders_estimate_and_logged_columns", () => {
    renderRow(makeRow({ estimateMinutes: 120, totalMinutes: 60 }));

    expect(screen.getByText("2 hr")).toBeInTheDocument();
    expect(screen.getByText("1 hr")).toBeInTheDocument();
  });

  it("test_my_task_row_renders_dash_when_no_estimate_or_logged_time", () => {
    renderRow(makeRow({ estimateMinutes: null, totalMinutes: 0 }));

    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("test_my_task_row_does_not_render_an_assignee_column", () => {
    // Intentionally omitted: every row on this page belongs to the current
    // user by definition, so an Assignee column would repeat the same
    // person on every row — see this feature's handoff for the rationale.
    renderRow(makeRow());

    expect(screen.queryByLabelText(/Change assignee/i)).not.toBeInTheDocument();
  });

  // Krug 2 UX audit fix: My Tasks previously showed the raw DB status
  // value ("done", "in_progress", "todo") in this column while the
  // project List view, rendering the exact same task, showed the
  // formatted label ("Done", "In Progress", "To Do") -- both now flow
  // through the single shared statusLabelFor lookup (lib/task-colors.ts).
  it("test_my_task_row_status_column_shows_the_formatted_label_not_the_raw_db_value", () => {
    renderRow(makeRow({ status: "in_progress" }));

    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.queryByText("in_progress")).not.toBeInTheDocument();
  });

  it("test_my_task_row_status_column_formats_a_projects_real_column_name_the_same_way_the_list_view_does", () => {
    // Mirrors my-tasks/page.tsx's per-project statusOptionsByProject map,
    // built from `project_statuses.name` -- for a project still on the
    // default (un-renamed) seed columns, that raw column name is the same
    // lowercase snake_case value as the legacy fixed-four status union.
    renderRow(
      makeRow({ status: "done" }),
      [],
    );

    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.queryByText("done")).not.toBeInTheDocument();
  });
});
