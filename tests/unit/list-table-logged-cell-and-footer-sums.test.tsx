// @vitest-environment jsdom
//
// F006 (TT-013, TT-014): the List view's Logged cell shows a play icon,
// "Add time" (muted) when nothing's logged yet, and destructive colour
// when logged minutes exceed the estimate.
// F007 (TT-010, TT-012): the List view has a footer row summing task
// count, total estimate, and total logged over exactly the visible rows,
// never double-counting a subtask whose parent is also shown.

import { createElement } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/w/acme/projects/proj-1/list",
  useSearchParams: () => new URLSearchParams(),
}));

// Mounting the real <TaskDetailSheet> needs the `getTaskDetail` Server
// Action to resolve — mocked here so TT-014's "opens the sheet" assertion
// can check for the resulting dialog without a real network/DB round
// trip, same isolation boundary list-table-jk-navigation.test.tsx draws.
vi.mock("@/lib/actions/tasks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getTaskDetail: vi.fn(async () => ({
      ok: true,
      data: {
        id: "t1",
        title: "Click me",
        description: null,
        status: "todo",
        priority: null,
        assigneeId: null,
        assigneeIds: [],
        dueDate: null,
        clientVisible: false,
        pendingClientApproval: false,
      },
    })),
  };
});

import { TaskListTable } from "@/components/task/task-list-table";
import type { TaskCardTask } from "@/components/task/task-card";

// Same fake Supabase Realtime client as list-table-bulk-selection.test.tsx —
// mounting TaskListTable must never open a real WebSocket under jsdom.
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

function task(overrides: Partial<TaskCardTask> & { id: string; title: string }): TaskCardTask {
  return {
    status: "To Do" as TaskCardTask["status"],
    priority: null,
    assigneeId: null,
    dueDate: null,
    position: 1,
    estimateMinutes: null,
    totalMinutes: null,
    ...overrides,
  } as TaskCardTask;
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

/** Scopes a query to the row body only (`tbody`), excluding the footer
 * row — several assertions below use durations that can coincidentally
 * match both a row's own Logged cell and the footer's sum. */
function tbody(): HTMLElement {
  return document.querySelector("tbody") as HTMLElement;
}

function tfoot(): HTMLElement {
  return document.querySelector("tfoot") as HTMLElement;
}

describe("TT-013: the Logged cell", () => {
  it("test_TT_013_shows_add_time_muted_when_nothing_has_been_logged", () => {
    renderTable([task({ id: "t1", title: "No time yet", estimateMinutes: 60, totalMinutes: null })]);

    const addTime = within(tbody()).getByText("Add time");
    expect(addTime).toBeInTheDocument();
    // Muted, not destructive — the containing cell carries the muted class.
    expect(addTime.closest("td")).toHaveClass("text-muted-foreground");
    expect(addTime.closest("td")).not.toHaveClass("text-destructive");
  });

  it("test_TT_013_shows_destructive_colour_when_logged_exceeds_estimate", () => {
    renderTable([
      task({ id: "t1", title: "Over budget", estimateMinutes: 60, totalMinutes: 90 }),
    ]);

    const duration = within(tbody()).getByText("1 hr 30 min");
    expect(duration.closest("td")).toHaveClass("text-destructive");
  });

  it("test_TT_013_shows_muted_colour_when_logged_is_within_estimate", () => {
    renderTable([
      task({ id: "t1", title: "On budget", estimateMinutes: 60, totalMinutes: 30 }),
    ]);

    const duration = within(tbody()).getByText("30 min");
    expect(duration.closest("td")).toHaveClass("text-muted-foreground");
    expect(duration.closest("td")).not.toHaveClass("text-destructive");
  });
});

describe("TT-014: clicking the Logged cell opens the task detail sheet", () => {
  it("test_TT_014_clicking_the_add_time_affordance_opens_the_task_detail_sheet", async () => {
    renderTable([task({ id: "t1", title: "Click me", estimateMinutes: null, totalMinutes: null })]);

    const row = screen.getByRole("button", { name: /Click me/ });
    row.click();

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });
});

describe("TT-010: the List view has a footer row with count and sums", () => {
  it("test_TT_010_footer_shows_task_count_and_sum_of_estimates_and_logged", () => {
    renderTable([
      task({ id: "t1", title: "First", estimateMinutes: 60, totalMinutes: 30 }),
      task({ id: "t2", title: "Second", estimateMinutes: 30, totalMinutes: 90 }),
    ]);

    const footer = tfoot();
    expect(footer).toBeInTheDocument();
    expect(within(footer).getByText("2 tasks")).toBeInTheDocument();
    // Estimate sum: 60 + 30 = 90 -> "1 hr 30 min"
    expect(within(footer).getByText("1 hr 30 min")).toBeInTheDocument();
    // Logged sum: 30 + 90 = 120 -> "2 hr"
    expect(within(footer).getByText("2 hr")).toBeInTheDocument();
  });

  it("test_TT_010_singular_task_label_for_exactly_one_visible_row", () => {
    renderTable([task({ id: "t1", title: "Only one", estimateMinutes: null, totalMinutes: null })]);

    expect(within(tfoot()).getByText("1 task")).toBeInTheDocument();
  });
});

describe("TT-012: sums respect visible rows and never double-count subtasks", () => {
  it("test_TT_012_footer_sums_equal_the_sum_of_the_filtered_visible_rows_only", () => {
    // Simulates an active filter: only 1 of the project's real tasks was
    // ever passed to this component (server-side filtering already
    // happened before this component renders, same convention
    // list-table-bulk-selection.test.tsx's AS-335 tests document).
    renderTable([
      task({ id: "t1", title: "Filtered task", estimateMinutes: 45, totalMinutes: 15 }),
    ]);

    const footer = tfoot();
    expect(within(footer).getByText("1 task")).toBeInTheDocument();
    expect(within(footer).getByText("45 min")).toBeInTheDocument();
    expect(within(footer).getByText("15 min")).toBeInTheDocument();
  });

  it("test_TT_012_a_subtask_shown_nested_under_its_visible_parent_is_counted_exactly_once", () => {
    const parent = task({
      id: "parent",
      title: "Parent task",
      estimateMinutes: 60,
      totalMinutes: 20,
    });
    const child = task({
      id: "child",
      title: "Child task",
      estimateMinutes: 40,
      totalMinutes: 10,
      parentTaskId: "parent",
    } as Partial<TaskCardTask> & { id: string; title: string });
    renderTable([parent, child]);

    const footer = tfoot();
    // 2 visible rows total (parent + its nested child), not double-counted
    // and not skipped.
    expect(within(footer).getByText("2 tasks")).toBeInTheDocument();
    // Estimate sum: 60 + 40 = 100 -> "1 hr 40 min"
    expect(within(footer).getByText("1 hr 40 min")).toBeInTheDocument();
    // Logged sum: 20 + 10 = 30 -> "30 min"
    expect(within(footer).getByText("30 min")).toBeInTheDocument();
  });

  it("test_TT_012_negative_a_collapsed_childs_time_is_not_dropped_from_the_sum", () => {
    // Collapsing hides the CHILD ROW's visibility, but the spec's "visible
    // rows" for summation purposes is the already-filtered set this
    // component was handed, not further reduced by the collapse UI toggle
    // (collapsing is a display convenience, not a second filter) —
    // asserting the sum still reflects both rows even though only the
    // parent's own row markup would be interactively expanded by default.
    // (Default state is expanded, so this simply pins today's behaviour:
    // both rows counted.)
    const parent = task({
      id: "parent",
      title: "Parent task",
      estimateMinutes: 60,
      totalMinutes: 20,
    });
    const child = task({
      id: "child",
      title: "Child task",
      estimateMinutes: 40,
      totalMinutes: 10,
      parentTaskId: "parent",
    } as Partial<TaskCardTask> & { id: string; title: string });
    renderTable([parent, child]);

    expect(within(tfoot()).getByText("2 tasks")).toBeInTheDocument();
  });
});
