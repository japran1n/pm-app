// @vitest-environment jsdom
//
// F007 (AS-030..AS-036): the Home dashboard "My work" card renders its
// three buckets under distinctly labelled group headers, caps combined
// rows at 8 with a "show more" link to My Tasks, shows status as a
// read-only badge (not an editable dropdown), toggles the checkbox
// optimistically via the real `moveTaskStatus` action, and renders a
// purposeful empty state when all three buckets are empty.

import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import type { MyTaskRow } from "@/lib/queries/my-tasks";

const moveTaskStatus = vi.fn();
const startTimer = vi.fn();
const stopTimer = vi.fn();

vi.mock("@/lib/actions/tasks/ordering", () => ({
  moveTaskStatus: (...args: unknown[]) => moveTaskStatus(...args),
}));

vi.mock("@/lib/actions/time-entries", () => ({
  startTimer: (...args: unknown[]) => startTimer(...args),
  stopTimer: (...args: unknown[]) => stopTimer(...args),
}));

const routerRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { MyWorkCard } from "@/components/dashboard/my-work-card";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeRow(overrides: Partial<MyTaskRow>): MyTaskRow {
  return {
    id: "task-1",
    title: "Write report",
    status: "todo",
    statusCategory: "todo",
    priority: null,
    dueDate: "2026-09-21",
    number: 123,
    projectId: "proj-1",
    projectKey: "PROJ",
    projectName: "Marketing",
    isDone: false,
    bucket: "overdue",
    isWatched: false,
    isAssigned: true,
    clientVisible: false,
    pendingClientApproval: false,
    taskType: null,
    estimateMinutes: null,
    totalMinutes: 0,
    ...overrides,
  };
}

describe("MyWorkCard (F007)", () => {
  it("test_AS_030_overdue_tasks_render_under_a_red_overdue_group_header", () => {
    render(
      createElement(MyWorkCard, {
        overdue: [makeRow({ id: "od-1", bucket: "overdue" })],
        today: [],
        thisWeek: [],
        workspaceSlug: "acme",
        doneStatusIdByProject: {},
      }),
    );

    const header = screen.getByTestId("my-work-group-overdue");
    expect(header).toHaveTextContent("Overdue");
    expect(header.querySelector(".text-destructive")).not.toBeNull();
  });

  it("test_AS_031_tasks_due_today_render_under_a_today_group_header", () => {
    render(
      createElement(MyWorkCard, {
        overdue: [],
        today: [makeRow({ id: "td-1", bucket: "today" })],
        thisWeek: [],
        workspaceSlug: "acme",
        doneStatusIdByProject: {},
      }),
    );

    expect(screen.getByTestId("my-work-group-today")).toHaveTextContent("Today");
  });

  it("test_AS_032_tasks_due_this_week_render_under_a_this_week_group_header", () => {
    render(
      createElement(MyWorkCard, {
        overdue: [],
        today: [],
        thisWeek: [makeRow({ id: "wk-1", bucket: "thisWeek" })],
        workspaceSlug: "acme",
        doneStatusIdByProject: {},
      }),
    );

    expect(screen.getByTestId("my-work-group-thisWeek")).toHaveTextContent(
      "This week",
    );
  });

  it("test_AS_033_combined_rows_are_capped_at_8_with_a_link_to_my_tasks_for_the_remainder", () => {
    const overdue = Array.from({ length: 5 }, (_, i) =>
      makeRow({ id: `od-${i}`, bucket: "overdue" }),
    );
    const today = Array.from({ length: 4 }, (_, i) =>
      makeRow({ id: `td-${i}`, bucket: "today" }),
    );
    const thisWeek = Array.from({ length: 3 }, (_, i) =>
      makeRow({ id: `wk-${i}`, bucket: "thisWeek" }),
    );

    render(
      createElement(MyWorkCard, {
        overdue,
        today,
        thisWeek,
        workspaceSlug: "acme",
        doneStatusIdByProject: {},
      }),
    );

    const rows = screen.getAllByTestId("my-work-row");
    expect(rows.length).toBe(8);

    const link = screen.getByTestId("my-work-show-more");
    expect(link).toHaveTextContent("4 more");
    expect(link).toHaveAttribute("href", "/w/acme/my-tasks");
  });

  it("test_AS_034_each_row_shows_status_as_a_read_only_badge_not_a_dropdown", () => {
    render(
      createElement(MyWorkCard, {
        overdue: [makeRow({ id: "od-1", status: "in_progress" })],
        today: [],
        thisWeek: [],
        workspaceSlug: "acme",
        doneStatusIdByProject: {},
      }),
    );

    const badge = screen.getByTestId("my-work-status-badge");
    expect(badge.tagName).not.toBe("SELECT");
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(badge).toHaveTextContent(/in progress/i);
  });

  it("test_AS_035_checking_the_checkbox_optimistically_marks_the_task_done_via_movetaskstatus", async () => {
    let resolveMove: (value: unknown) => void = () => {};
    moveTaskStatus.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMove = resolve;
        }),
    );

    render(
      createElement(MyWorkCard, {
        overdue: [makeRow({ id: "od-1", projectId: "proj-1" })],
        today: [],
        thisWeek: [],
        workspaceSlug: "acme",
        doneStatusIdByProject: { "proj-1": "done" },
      }),
    );

    const checkbox = screen.getByLabelText(/mark "write report" done/i);
    fireEvent.click(checkbox);

    // Optimistic flip happens before the server resolves.
    await waitFor(() => expect(checkbox).toHaveAttribute("aria-checked", "true"));

    expect(moveTaskStatus).toHaveBeenCalledWith("od-1", "done");

    await act(async () => {
      resolveMove({ ok: true, data: { id: "od-1", status: "done" } });
      await Promise.resolve();
    });
  });

  it("test_AS_035_a_failed_status_mutation_reverts_the_optimistic_checkbox", async () => {
    moveTaskStatus.mockResolvedValue({ ok: false, error: "Something went wrong." });

    render(
      createElement(MyWorkCard, {
        overdue: [makeRow({ id: "od-1", projectId: "proj-1" })],
        today: [],
        thisWeek: [],
        workspaceSlug: "acme",
        doneStatusIdByProject: { "proj-1": "done" },
      }),
    );

    const checkbox = screen.getByLabelText(/mark "write report" done/i);
    fireEvent.click(checkbox);

    await waitFor(() =>
      expect(checkbox).toHaveAttribute("aria-checked", "false"),
    );
  });

  it("test_AS_036_when_all_three_buckets_are_empty_the_card_shows_the_empty_state", () => {
    render(
      createElement(MyWorkCard, {
        overdue: [],
        today: [],
        thisWeek: [],
        workspaceSlug: "acme",
        doneStatusIdByProject: {},
      }),
    );

    expect(screen.getByTestId("my-work-empty-state")).toHaveTextContent(
      "You're all clear — nothing due soon.",
    );
    expect(screen.queryByTestId("my-work-row")).toBeNull();
  });
});
