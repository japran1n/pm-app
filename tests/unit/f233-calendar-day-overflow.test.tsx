// @vitest-environment jsdom
//
// F233 (AS-444, AS-447): the calendar day cell's overflow control -- a
// day with more tasks than fit inline shows a "+N more" control that
// reveals the rest in a popover, and each task chip (inline or inside the
// overflow popover) is a real click-through to the board's `?taskId=`
// deep link -- the same real path board.tsx's own click-to-open effect
// already listens on (AS-444's real path is proven end-to-end against the
// real getTaskDetail Server Action in
// tests/integration/f233-calendar-task-interactions.test.ts; this file
// proves the UI actually renders and wires that link/control correctly).

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { DayCell } from "@/components/calendar/day-cell";
import type { CalendarDay } from "@/lib/calendar/month-grid";
import type { CalendarTask } from "@/lib/queries/calendar";

afterEach(cleanup);

function makeTask(id: string, title: string): CalendarTask {
  return {
    id,
    title,
    status: "todo",
    statusCategory: "todo",
    isDone: false,
    priority: "medium",
    dueDate: "2026-06-10",
    number: 1,
    projectId: "project-1",
    projectKey: "PM",
    projectName: "Project",
    assignees: [],
  };
}

const DAY: CalendarDay = {
  date: "2026-06-10",
  isCurrentMonth: true,
  isToday: false,
};

describe("F233 DayCell overflow control (AS-444, AS-447)", () => {
  it("test_AS_447_a_day_with_fewer_tasks_than_the_visible_cap_shows_no_overflow_control", () => {
    const tasks = [makeTask("t1", "Task one"), makeTask("t2", "Task two")];
    render(<DayCell day={DAY} tasks={tasks} workspaceSlug="acme" />);
    expect(screen.queryByRole("button", { name: /more/i })).not.toBeInTheDocument();
  });

  it("test_AS_447_a_day_with_more_tasks_than_fit_shows_an_overflow_control_revealing_the_rest", () => {
    const tasks = [
      makeTask("t1", "Task one"),
      makeTask("t2", "Task two"),
      makeTask("t3", "Task three"),
      makeTask("t4", "Task four"),
      makeTask("t5", "Task five"),
    ];
    render(<DayCell day={DAY} tasks={tasks} workspaceSlug="acme" />);

    // Only the first 3 render inline.
    expect(screen.getByText("Task one")).toBeInTheDocument();
    expect(screen.getByText("Task two")).toBeInTheDocument();
    expect(screen.getByText("Task three")).toBeInTheDocument();
    expect(screen.queryByText("Task four")).not.toBeInTheDocument();
    expect(screen.queryByText("Task five")).not.toBeInTheDocument();

    const trigger = screen.getByRole("button", { name: "Show 2 more tasks" });
    // Keyboard reachability (this feature's clarified requirement: "must
    // be keyboard reachable, not hover-only"): the trigger is a real
    // native <button> element, focusable and activatable via keyboard by
    // construction -- not a hover-only <div>.
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).not.toHaveAttribute("tabindex", "-1");

    fireEvent.click(trigger);

    expect(screen.getByText("Task four")).toBeInTheDocument();
    expect(screen.getByText("Task five")).toBeInTheDocument();

    const revealedLink = screen.getByText("Task four").closest("a");
    expect(revealedLink).toHaveAttribute(
      "href",
      "/w/acme/projects/project-1/board?taskId=t4",
    );
  });

  it("test_AS_444_each_inline_task_chip_links_to_the_real_board_deep_link_route", () => {
    const tasks = [makeTask("t1", "Task one")];
    render(<DayCell day={DAY} tasks={tasks} workspaceSlug="acme" />);
    const link = screen.getByText("Task one").closest("a");
    expect(link).toHaveAttribute(
      "href",
      "/w/acme/projects/project-1/board?taskId=t1",
    );
  });
});
