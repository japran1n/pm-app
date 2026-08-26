// @vitest-environment jsdom
//
// F338 (M18 scrutiny BLOCKER-2/MAJ-3, AS-525/AS-526): priority was
// conveyed by colour alone on the calendar (day-cell/agenda-list/
// day-overflow) and by bar/marker fill colour alone on the timeline
// (timeline-bar / timeline-bar-draggable), with no text/accessible-name
// equivalent -- and `text-white` over the fixed `PRIORITY_COLORS` hex
// failed 4.5:1 for urgent/high/low on the timeline surfaces. This file
// asserts both fixes: every surface's accessible name/text now contains
// the priority label, and the resolved text colour clears 4.5:1 against
// the resolved background for every priority.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { DayCell } from "@/components/calendar/day-cell";
import { AgendaList } from "@/components/calendar/agenda-list";
import { TimelineBar } from "@/components/timeline/timeline-bar";
import { TimelineBarDraggable } from "@/components/timeline/timeline-bar-draggable";
import type { CalendarDay } from "@/lib/calendar/month-grid";
import type { CalendarTask } from "@/lib/queries/calendar";
import type { TimelineTask } from "@/lib/queries/timeline";
import type { TimelineBarLayout } from "@/lib/timeline/layout";
import { PRIORITY_COLORS, PRIORITY_TEXT_ON_COLOR } from "@/lib/task-colors";

afterEach(cleanup);

function relativeLuminance(hex: string): number {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;
  const linearize = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

function contrastRatio(hexA: string, hexB: string): number {
  const L1 = relativeLuminance(hexA);
  const L2 = relativeLuminance(hexB);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

function makeCalendarTask(priority: CalendarTask["priority"]): CalendarTask {
  return {
    id: "t1",
    title: "Urgent-looking task",
    status: "todo",
    statusCategory: "todo",
    isDone: false,
    priority,
    dueDate: "2026-06-10",
    number: 1,
    projectId: "project-1",
    projectKey: "PM",
    projectName: "Project",
    assignees: [],
  };
}

const DAY: CalendarDay = { date: "2026-06-10", isCurrentMonth: true, isToday: false };

function makeTimelineTask(priority: string | null): TimelineTask {
  return {
    id: "t1",
    title: "Ship the release",
    status: "todo",
    statusCategory: "todo",
    isDone: false,
    priority,
    startDate: "2026-06-01",
    dueDate: "2026-06-05",
    number: 1,
    projectId: "project-1",
    projectKey: "PM",
    projectName: "Project",
    assignees: [],
  };
}

const RANGE_LAYOUT: TimelineBarLayout = { id: "t1", leftPx: 0, widthPx: 80, kind: "range" };
const MARKER_LAYOUT: TimelineBarLayout = { id: "t1", leftPx: 0, widthPx: 16, kind: "marker" };

describe("test_AS_525_calendar_priority_is_not_color_only", () => {
  it("day-cell task chip's accessible content includes the priority label", () => {
    render(<DayCell day={DAY} tasks={[makeCalendarTask("urgent")]} workspaceSlug="acme" />);
    expect(screen.getByText("Urgent")).toBeInTheDocument();
  });

  it("agenda-list row's accessible content includes the priority label", () => {
    render(
      <AgendaList
        days={[DAY]}
        tasksByDate={{ [DAY.date]: [makeCalendarTask("high")] }}
        workspaceSlug="acme"
      />,
    );
    expect(screen.getByText("High")).toBeInTheDocument();
  });
});

describe("test_AS_525_timeline_priority_is_not_color_only", () => {
  it("timeline-bar range bar's accessible name includes the priority label", () => {
    render(
      <TimelineBar task={makeTimelineTask("urgent")} layout={RANGE_LAYOUT} workspaceSlug="acme" />,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAccessibleName(/Urgent priority/);
  });

  it("timeline-bar marker (no visible text at all) still carries the priority label in its accessible name", () => {
    render(
      <TimelineBar task={makeTimelineTask("low")} layout={MARKER_LAYOUT} workspaceSlug="acme" />,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAccessibleName(/Low priority/);
    // The marker branch renders no visible text node.
    expect(link.textContent).toBe("");
  });

  it("timeline-bar-draggable's accessible name includes the priority label", () => {
    render(
      <TimelineBarDraggable
        task={makeTimelineTask("backlog")}
        layout={RANGE_LAYOUT}
        workspaceSlug="acme"
        canDrag={false}
      />,
    );
    expect(screen.getByTestId("timeline-bar")).toHaveAccessibleName(/Backlog priority/);
  });
});

describe("test_AS_526_timeline_bar_text_color_meets_wcag_aa_on_its_priority_background", () => {
  const AA_NORMAL_TEXT_MIN_RATIO = 4.5;

  it.each(Object.entries(PRIORITY_COLORS))(
    "PRIORITY_TEXT_ON_COLOR.%s clears 4.5:1 against PRIORITY_COLORS.%s",
    (priority) => {
      const bg = PRIORITY_COLORS[priority as keyof typeof PRIORITY_COLORS];
      const fg = PRIORITY_TEXT_ON_COLOR[priority as keyof typeof PRIORITY_TEXT_ON_COLOR];
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT_MIN_RATIO);
    },
  );

  it("the previous fixed text-white would have FAILED 4.5:1 for urgent/high/low (regression guard)", () => {
    expect(contrastRatio("#ffffff", PRIORITY_COLORS.urgent)).toBeLessThan(AA_NORMAL_TEXT_MIN_RATIO);
    expect(contrastRatio("#ffffff", PRIORITY_COLORS.high)).toBeLessThan(AA_NORMAL_TEXT_MIN_RATIO);
    expect(contrastRatio("#ffffff", PRIORITY_COLORS.low)).toBeLessThan(AA_NORMAL_TEXT_MIN_RATIO);
  });

  it("timeline-bar actually applies the computed text color inline", () => {
    render(
      <TimelineBar task={makeTimelineTask("urgent")} layout={RANGE_LAYOUT} workspaceSlug="acme" />,
    );
    const link = screen.getByRole("link");
    expect(link.style.color).toBe("rgb(0, 0, 0)");
  });
});
