// @vitest-environment jsdom
//
// F185: row-checkbox multi-select in the List view
// (components/task/task-list-table.tsx's new selection state + header
// select-all + shift-click range selection) and the floating action bar
// (components/task/bulk-action-bar.tsx) it drives.
//
// AS-334: tasks are selectable via row checkboxes.
// AS-335: select-all covers exactly the tasks matching the active filters
//   — proven here by rendering <TaskListTable> with only the ALREADY
//   FILTERED `tasks` prop (exactly what the real List page does: filters
//   are applied server-side in getProjectListTasks before this component
//   ever renders, per app/(workspace)/.../list/page.tsx) and confirming
//   select-all only ever selects what was actually rendered, never a
//   wider set.
// AS-336: the selected count and a clear control are shown.
// AS-342: the selection state supports being cleared programmatically —
//   this feature doesn't build the actual bulk actions yet (F186/F187 do,
//   see this file's own describe block below for the scope note), so this
//   proves the clearing MECHANISM (the "Clear selection" button, standing
//   in for what a completed bulk action will call).

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/w/acme/projects/proj-1/list",
  useSearchParams: () => new URLSearchParams(),
}));

import { TaskListTable } from "@/components/task/task-list-table";
import type { TaskCardTask } from "@/components/task/task-card";


// Realtime: mock the Supabase browser client so mounting this component
// never opens a real WebSocket. jsdom's undici-based WebSocket polyfill
// throws "TypeError: The \"event\" argument must be an instance of Event"
// against a live connection (see vitest.config.ts's own comment on why
// jsdom is opt-in per file), which escapes as an unhandled exception
// outside any test and fails the process even though every test passes.
// Same "channel().on().subscribe()" fake shape as
// tests/unit/f022-board-realtime-guard-call-site.test.tsx.
function makeFakeSupabaseRealtimeClient() {
  const channelObject = {
    on: vi.fn(() => channelObject),
    subscribe: vi.fn(() => channelObject),
  };
  return {
    channel: vi.fn(() => channelObject),
    removeChannel: vi.fn(),
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null } })),
    },
  };
}
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => makeFakeSupabaseRealtimeClient(),
}));

afterEach(() => {
  cleanup();
});

function task(id: string, title: string): TaskCardTask {
  return {
    id,
    title,
    status: "todo",
    priority: null,
    assigneeId: null,
    dueDate: null,
    position: 1,
  };
}

// The full, unfiltered project has 4 tasks; a status filter narrows the
// UI down to these 2 — exactly what the real page's server-side
// `getProjectListTasks(projectId, filters)` call would already have
// filtered down to before <TaskListTable> ever receives its `tasks` prop.
const FILTERED_TASKS: TaskCardTask[] = [
  task("t1", "Filtered task one"),
  task("t2", "Filtered task two"),
];

function renderTable(tasks: TaskCardTask[] = FILTERED_TASKS) {
  return render(
    createElement(TaskListTable, {
      tasks,
      assignees: new Map(),
      timezone: "UTC",
    }),
  );
}

describe("AS-334: tasks are selectable via row checkboxes", () => {
  it("test_AS_334_clicking_a_row_checkbox_selects_that_task_and_shows_it_as_checked", () => {
    renderTable();

    const checkbox = screen.getByRole("checkbox", {
      name: "Select Filtered task one",
    });
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);

    expect(checkbox).toBeChecked();
  });

  it("test_AS_334_clicking_a_selected_row_checkbox_again_deselects_it", () => {
    renderTable();

    const checkbox = screen.getByRole("checkbox", {
      name: "Select Filtered task one",
    });

    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });

  it("test_AS_334_clicking_a_row_checkbox_does_not_also_open_the_task_detail_sheet_underneath", () => {
    renderTable();

    const checkbox = screen.getByRole("checkbox", {
      name: "Select Filtered task one",
    });
    fireEvent.click(checkbox);

    // TaskDetailSheet is a Radix/base-ui Sheet — closed content isn't
    // portal-rendered, so its absence here proves the click never
    // triggered `openTask`, matching this file's ListStatusSelect
    // sibling cell's stopPropagation pattern already established above
    // it in task-list-table.tsx.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("AS-335: select-all covers exactly the tasks matching the active filters, never the whole unfiltered set", () => {
  it("test_AS_335_select_all_selects_only_the_filtered_tasks_actually_rendered", () => {
    // Simulates: a filter is applied, narrowing the project's real task
    // count down to 2 — <TaskListTable> only ever receives those 2 (the
    // real page always passes the already-filtered result, never the
    // full project set alongside a separate "which are visible" flag).
    renderTable(FILTERED_TASKS);

    const selectAll = screen.getByRole("checkbox", {
      name: "Select all 2 tasks",
    }) as HTMLInputElement;
    fireEvent.click(selectAll);

    const rowCheckboxes = screen.getAllByRole("checkbox", {
      name: /^Select Filtered task/,
    });
    expect(rowCheckboxes).toHaveLength(2);
    for (const cb of rowCheckboxes) {
      expect(cb).toBeChecked();
    }

    // Exactly 2 selected — the count shown in the action bar is bounded
    // by the filtered set this component was actually handed, not some
    // larger unfiltered project total.
    expect(screen.getByText("2 tasks selected")).toBeInTheDocument();
  });

  it("test_AS_335_unfiltered_render_with_more_tasks_select_all_scales_to_that_larger_set_not_a_fixed_number", () => {
    // Proves select-all's scope tracks whatever `tasks` it was actually
    // given (i.e. the caller's active filter/sort state), not a hardcoded
    // total — rendering with 4 tasks instead of 2 selects all 4, not 2.
    const allTasks = [
      ...FILTERED_TASKS,
      task("t3", "Unfiltered task three"),
      task("t4", "Unfiltered task four"),
    ];
    renderTable(allTasks);

    const selectAll = screen.getByRole("checkbox", {
      name: "Select all 4 tasks",
    });
    fireEvent.click(selectAll);

    expect(screen.getByText("4 tasks selected")).toBeInTheDocument();
  });

  it("test_AS_335_negative_selecting_a_single_row_does_not_select_the_rest_of_the_filtered_set", () => {
    renderTable();

    const checkbox = screen.getByRole("checkbox", {
      name: "Select Filtered task one",
    });
    fireEvent.click(checkbox);

    expect(screen.getByText("1 task selected")).toBeInTheDocument();
    const other = screen.getByRole("checkbox", {
      name: "Select Filtered task two",
    });
    expect(other).not.toBeChecked();
  });
});

describe("AS-336: the selected count and a clear control are shown", () => {
  it("test_AS_336_no_action_bar_when_selection_is_empty", () => {
    renderTable();
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /clear selection/i }),
    ).not.toBeInTheDocument();
  });

  it("test_AS_336_action_bar_shows_count_and_a_clear_control_once_a_task_is_selected", () => {
    renderTable();

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select Filtered task one" }),
    );

    const bar = screen.getByRole("status");
    expect(within(bar).getByText("1 task selected")).toBeInTheDocument();
    expect(
      within(bar).getByRole("button", { name: /clear selection/i }),
    ).toBeInTheDocument();
  });
});

describe("AS-342: the selection clears (programmatically) — full proof depends on F186/F187's bulk actions, not yet built", () => {
  it("test_AS_342_the_clear_control_resets_the_selection_state_and_hides_the_action_bar", () => {
    renderTable();

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select Filtered task one" }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select Filtered task two" }),
    );
    expect(screen.getByText("2 tasks selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /clear selection/i }));

    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
    const checkbox = screen.getByRole("checkbox", {
      name: "Select Filtered task one",
    });
    expect(checkbox).not.toBeChecked();
  });
});

describe("F185 shift-click range selection (spec: 'click row A, shift-click row B, everything between gets selected')", () => {
  it("test_shift_click_selects_every_row_between_the_last_clicked_row_and_the_shift_clicked_row_inclusive", () => {
    const tasks = [
      task("t1", "Row A"),
      task("t2", "Row B"),
      task("t3", "Row C"),
      task("t4", "Row D"),
    ];
    renderTable(tasks);

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Row A" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Row D" }), {
      shiftKey: true,
    });

    for (const label of ["Row A", "Row B", "Row C", "Row D"]) {
      const cb = screen.getByRole("checkbox", {
        name: `Select ${label}`,
      });
      expect(cb).toBeChecked();
    }
    expect(screen.getByText("4 tasks selected")).toBeInTheDocument();
  });
});
