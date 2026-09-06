// @vitest-environment jsdom
//
// F338 (M18 scrutiny BLOCKER-2/MAJ-3, AS-525/AS-526): priority was
// conveyed by colour alone on the calendar (day-cell/agenda-list/
// day-overflow), with no text/accessible-name equivalent -- and
// `text-white` over the fixed `PRIORITY_COLORS` hex failed 4.5:1 for
// urgent/high/low. This file asserts both fixes: every surface's
// accessible name/text now contains the priority label, and the resolved
// text colour clears 4.5:1 against the resolved background for every
// priority.
//
// Timeline was removed entirely (dedicated feature request) -- its own
// timeline-bar/timeline-bar-draggable coverage was dropped from this file
// rather than left pointing at dead code.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { DayCell } from "@/components/calendar/day-cell";
import { AgendaList } from "@/components/calendar/agenda-list";
import type { CalendarDay } from "@/lib/calendar/month-grid";
import type { CalendarTask } from "@/lib/queries/calendar";
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

describe("test_AS_526_priority_text_color_meets_wcag_aa_on_its_priority_background", () => {
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
});
