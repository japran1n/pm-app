// @vitest-environment jsdom
//
// F326 (B1 -- AS-442, AS-443, AS-448): proves `<MonthGrid>` actually
// forwards its `dataKey` prop as `<CalendarDayGrid>`'s React `key`, end
// to end from the Server Component boundary -- i.e. that calendar/page.tsx
// changing `dataKey` on month nav / filter change really does force a
// remount of the desktop grid, not just that CalendarDayGrid behaves
// correctly in isolation (that's f326-calendar-day-grid-rerender.test.tsx).

import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { createElement } from "react";

import { MonthGrid } from "@/components/calendar/month-grid";
import { buildCalendarMonth } from "@/lib/calendar/month-grid";
import type { CalendarTask } from "@/lib/queries/calendar";

afterEach(cleanup);

function makeTask(id: string, title: string, dueDate: string): CalendarTask {
  return {
    id,
    title,
    status: "todo",
    statusCategory: null,
    isDone: false,
    priority: null,
    dueDate,
    number: 1,
    projectId: "project-1",
    projectKey: "PRJ",
    projectName: "Project",
    assignees: [],
  };
}

describe("F326 MonthGrid forwards dataKey to CalendarDayGrid as its remount key", () => {
  it("test_AS_443_a_dataKey_change_across_a_rerender_replaces_the_desktop_grids_tasks", () => {
    const juneGrid = buildCalendarMonth(2026, 6, "UTC");
    const julyGrid = buildCalendarMonth(2026, 7, "UTC");

    const { container, rerender } = render(
      createElement(MonthGrid, {
        grid: juneGrid,
        tasksByDate: new Map([["2026-06-15", [makeTask("june-task", "June task", "2026-06-15")]]]),
        workspaceSlug: "acme",
        dataKey: "2026-06",
        prevHref: "/w/acme/calendar?month=2026-05",
        nextHref: "/w/acme/calendar?month=2026-07",
        todayHref: "/w/acme/calendar?month=2026-06",
      }),
    );
    const desktopGrid = () => container.querySelector<HTMLElement>('[data-testid="calendar-day-grid"]')!;
    expect(within(desktopGrid()).getByText("June task")).toBeInTheDocument();

    rerender(
      createElement(MonthGrid, {
        grid: julyGrid,
        tasksByDate: new Map([["2026-07-15", [makeTask("july-task", "July task", "2026-07-15")]]]),
        workspaceSlug: "acme",
        dataKey: "2026-07",
        prevHref: "/w/acme/calendar?month=2026-06",
        nextHref: "/w/acme/calendar?month=2026-08",
        todayHref: "/w/acme/calendar?month=2026-06",
      }),
    );

    expect(within(desktopGrid()).queryByText("June task")).not.toBeInTheDocument();
    expect(within(desktopGrid()).getByText("July task")).toBeInTheDocument();
  });
});
