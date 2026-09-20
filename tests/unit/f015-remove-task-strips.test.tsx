// @vitest-environment jsdom
//
// F015 (AS-033): "The Planner renders no task strips and no task chips."
// WeekView no longer accepts (or has anywhere to plug in) a tasksByDate
// prop at all -- the all-day strip row that used to sit above the timed
// grid (week-time-grid.tsx) and the task rows the mobile agenda
// (week-agenda.tsx) used to render are both gone. This proves the
// resulting markup carries none of the old task-strip/task-chip anchors,
// regardless of how the underlying data flow is implemented.

import type { ComponentProps } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { WeekView } from "@/components/calendar/week-view";
import { buildCalendarWeek } from "@/lib/calendar/week-grid";
import type { CalendarBlock } from "@/lib/queries/calendar-blocks";

afterEach(cleanup);

const WEEK = buildCalendarWeek("2026-06-01", "UTC");

function makeBlock(id: string, date: string): CalendarBlock {
  return {
    id,
    title: "Standup",
    startsAt: `${date}T09:00:00.000Z`,
    endsAt: `${date}T09:30:00.000Z`,
    color: null,
    userId: "user-1",
  } as CalendarBlock;
}

describe("F015 Planner renders no task strips or chips (AS-033)", () => {
  it("test_AS_033_the_week_grid_never_renders_an_all_day_task_strip_row", () => {
    render(
      <WeekView
        week={WEEK}
        blocks={[]}
        workspaceSlug="acme"
        workspaceId="workspace-1"
        prevHref="/w/acme/calendar?week=2026-05-25"
        nextHref="/w/acme/calendar?week=2026-06-08"
        todayHref="/w/acme/calendar"
      />,
    );

    for (const day of WEEK.days) {
      expect(
        screen.queryByTestId(`calendar-week-allday-${day.date}`),
      ).not.toBeInTheDocument();
    }
  });

  it("test_AS_033_no_task_board_link_is_rendered_anywhere_in_the_week_view", () => {
    render(
      <WeekView
        week={WEEK}
        blocks={[makeBlock("block-1", WEEK.days[0]!.date)]}
        workspaceSlug="acme"
        workspaceId="workspace-1"
        prevHref="/w/acme/calendar?week=2026-05-25"
        nextHref="/w/acme/calendar?week=2026-06-08"
        todayHref="/w/acme/calendar"
      />,
    );

    // Task chips (both the desktop all-day strip and the mobile agenda
    // row) always linked to `/projects/<id>/board?taskId=<id>` -- that
    // link shape must never appear now that tasks are gone from the
    // Planner entirely.
    const taskLinks = screen
      .queryAllByRole("link")
      .filter((link) => link.getAttribute("href")?.includes("taskId="));
    expect(taskLinks).toHaveLength(0);
  });

  it("test_AS_033_week_view_no_longer_accepts_a_tasksByDate_prop", () => {
    // Compile-time guard: WeekViewProps has no `tasksByDate` key. If a
    // future change reintroduces it, this file fails to type-check.
    type WeekViewProps = ComponentProps<typeof WeekView>;
    type NoTasksByDate = "tasksByDate" extends keyof WeekViewProps ? false : true;
    const guard: NoTasksByDate = true;
    expect(guard).toBe(true);
  });
});
