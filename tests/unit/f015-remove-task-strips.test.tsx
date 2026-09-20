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
import type { TimeOffEntry } from "@/lib/queries/time-off";

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

function makeTimeOffEntry(id: string, date: string): TimeOffEntry {
  return {
    id,
    workspaceId: "workspace-1",
    userId: "user-1",
    startDate: date,
    endDate: date,
    note: "Out of office",
    userName: "Jamie Rivera",
    userEmail: "jamie@example.com",
  };
}

describe("F015 Planner renders no task strips or chips (AS-033)", () => {
  it("test_AS_033_week_view_render_tree_contains_no_task_shaped_testids", () => {
    // Realistic fixtures: 5 calendar blocks spread across the week plus
    // time-off entries, no task data of any kind (there is no task prop
    // to even plug in). Every data-testid in the rendered tree is
    // collected and asserted to be task-free by substring, so this fails
    // on ANY task-shaped node regardless of how it's named.
    const blocks: CalendarBlock[] = WEEK.days
      .slice(0, 5)
      .map((day, index) => makeBlock(`block-${index}`, day.date));
    const timeOffEntries: TimeOffEntry[] = [
      makeTimeOffEntry("pto-1", WEEK.days[0]!.date),
      makeTimeOffEntry("pto-2", WEEK.days[2]!.date),
    ];

    const { container } = render(
      <WeekView
        week={WEEK}
        blocks={blocks}
        timeOffEntries={timeOffEntries}
        workspaceSlug="acme"
        workspaceId="workspace-1"
        currentUserId="user-1"
        prevHref="/w/acme/calendar?week=2026-05-25"
        nextHref="/w/acme/calendar?week=2026-06-08"
        todayHref="/w/acme/calendar"
      />,
    );

    const testIds = Array.from(
      container.querySelectorAll("[data-testid]"),
    ).map((el) => el.getAttribute("data-testid") ?? "");

    expect(testIds.length).toBeGreaterThan(0);

    for (const testId of testIds) {
      expect(testId).not.toContain("task");
      expect(testId).not.toContain("allday-chip");
      expect(testId).not.toContain("agenda-task");
    }
  });

  it("test_AS_033_no_task_board_link_is_rendered_anywhere_in_the_week_view", () => {
    render(
      <WeekView
        week={WEEK}
        blocks={[makeBlock("block-1", WEEK.days[0]!.date)]}
        workspaceSlug="acme"
        workspaceId="workspace-1"
        currentUserId="user-1"
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
