// @vitest-environment jsdom
//
// F235 (AS-449): "the calendar renders usably on a phone-width viewport."
// This is the component-level regression guard for that markup -- the
// real live-interaction proof (a real Chromium session at 375px, with
// both grid/agenda visibility asserted and evidence screenshots) is
// tests/e2e/f235-calendar-responsive.spec.ts; this file proves BOTH trees
// (the month grid and the agenda-list fallback) render from the exact
// same real props, and that the responsive classes doing the "pick one
// per viewport" work (Tailwind's `md:hidden` / `hidden md:block`, the
// same breakpoint components/nav/app-sidebar.tsx already uses for its own
// phone-vs-desktop layout) are actually present, not accidentally
// dropped in a refactor -- jsdom doesn't evaluate CSS media queries, so
// this can't assert which one a real phone WOULD show, only that both
// trees exist and are wired to switch.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { MonthGrid } from "@/components/calendar/month-grid";
import { AgendaList } from "@/components/calendar/agenda-list";
import { buildCalendarMonth, type CalendarDay } from "@/lib/calendar/month-grid";
import type { CalendarTask } from "@/lib/queries/calendar";

afterEach(cleanup);

function makeTask(id: string, title: string, dueDate: string): CalendarTask {
  return {
    id,
    title,
    status: "todo",
    statusCategory: "todo",
    isDone: false,
    priority: "medium",
    dueDate,
    number: 1,
    projectId: "project-1",
    projectKey: "PM",
    projectName: "Project",
    assignees: [],
  };
}

const GRID = buildCalendarMonth(2026, 6, "UTC");
const DAYS: CalendarDay[] = [
  { date: "2026-06-01", isCurrentMonth: true, isToday: false },
  { date: "2026-06-02", isCurrentMonth: true, isToday: true },
];

describe("F235 calendar responsive markup (AS-449)", () => {
  it("test_AS_449_the_grid_container_is_hidden_by_default_and_only_shown_at_md_and_above", () => {
    render(
      <MonthGrid
        grid={GRID}
        tasksByDate={new Map([["2026-06-01", [makeTask("t1", "Grid task", "2026-06-01")]]])}
        workspaceSlug="acme"
        dataKey="2026-06"
        prevHref="/w/acme/calendar?month=2026-05"
        nextHref="/w/acme/calendar?month=2026-07"
        todayHref="/w/acme/calendar?month=2026-06"
      />,
    );

    const grid = screen.getByTestId("calendar-day-grid");
    // The grid's own direct wrapper carries `hidden md:block` -- present
    // by default (mobile-first), only overridden at md and above.
    const gridWrapper = grid.parentElement!;
    expect(gridWrapper.className).toContain("hidden");
    expect(gridWrapper.className).toContain("md:block");
  });

  it("test_AS_449_the_agenda_list_container_is_shown_by_default_and_hidden_at_md_and_above", () => {
    render(
      <MonthGrid
        grid={GRID}
        tasksByDate={new Map([["2026-06-01", [makeTask("t1", "Agenda task", "2026-06-01")]]])}
        workspaceSlug="acme"
        dataKey="2026-06"
        prevHref="/w/acme/calendar?month=2026-05"
        nextHref="/w/acme/calendar?month=2026-07"
        todayHref="/w/acme/calendar?month=2026-06"
      />,
    );

    const agenda = screen.getByTestId("calendar-agenda-list");
    const agendaWrapper = agenda.parentElement!;
    expect(agendaWrapper.className).toContain("md:hidden");
    expect(agendaWrapper.className).not.toContain("hidden md:block");
  });

  it("test_AS_449_the_agenda_list_renders_every_task_from_the_same_real_tasksByDate_prop_the_grid_uses_grouped_by_day", () => {
    render(
      <AgendaList
        days={DAYS}
        tasksByDate={{
          "2026-06-01": [makeTask("t1", "First task", "2026-06-01")],
          "2026-06-02": [makeTask("t2", "Second task", "2026-06-02")],
        }}
        workspaceSlug="acme"
      />,
    );

    expect(screen.getByTestId("calendar-agenda-day-2026-06-01")).toBeInTheDocument();
    expect(screen.getByTestId("calendar-agenda-day-2026-06-02")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /First task/ })).toHaveAttribute(
      "href",
      "/w/acme/projects/project-1/board?taskId=t1",
    );
    expect(screen.getByRole("link", { name: /Second task/ })).toHaveAttribute(
      "href",
      "/w/acme/projects/project-1/board?taskId=t2",
    );
  });

  it("test_AS_449_a_day_with_no_tasks_is_not_rendered_as_an_empty_agenda_section_no_overflow_cap_needed", () => {
    render(
      <AgendaList
        days={DAYS}
        tasksByDate={{ "2026-06-01": [makeTask("t1", "Only task", "2026-06-01")] }}
        workspaceSlug="acme"
      />,
    );

    expect(screen.getByTestId("calendar-agenda-day-2026-06-01")).toBeInTheDocument();
    expect(screen.queryByTestId("calendar-agenda-day-2026-06-02")).not.toBeInTheDocument();
  });

  it("test_AS_449_zero_tasks_at_all_renders_the_agendas_own_empty_state_not_a_blank_area", () => {
    render(<AgendaList days={DAYS} tasksByDate={{}} workspaceSlug="acme" />);
    expect(screen.getByTestId("calendar-agenda-empty")).toBeInTheDocument();
  });
});
