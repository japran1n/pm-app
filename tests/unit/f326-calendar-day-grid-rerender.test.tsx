// @vitest-environment jsdom
//
// F326 (M16 scrutiny B1 -- AS-442, AS-443, AS-448): regression guard for
// the calendar desktop grid going stale after a soft navigation (month
// nav or a filter change), which the pre-fix suite could never catch
// because every prior test mounted the component fresh. This file
// exercises a REAL prop change across a real React re-render (RTL
// `rerender`, not a hand-built remount) and asserts the newly-rendered
// props win.
//
// Fix under test: `<CalendarDayGrid>` is now given a `key` derived from
// the month + active filters (calendar/page.tsx's `dataKey`, threaded
// through month-grid.tsx). Month nav and filter changes are soft
// navigations that flip that key, forcing dnd-kit's optimistic
// `useState` mirror (F234's `byDate`) to re-initialize from the fresh
// `tasksByDate` prop instead of going stale. An INCIDENTAL parent
// re-render that does NOT change the key (e.g. an unrelated state update
// while a drag's optimistic update is in flight) must NOT reset the
// mirror -- that's the whole reason `key` was chosen over an
// unconditional `useEffect` sync, which would wipe an in-flight
// optimistic drag on any such re-render. Both directions are asserted
// below.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { createElement } from "react";

import { CalendarDayGrid } from "@/components/calendar/calendar-day-grid";
import type { CalendarDay } from "@/lib/calendar/month-grid";
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

const JUNE_DAYS: CalendarDay[] = [
  { date: "2026-06-15", isCurrentMonth: true, isToday: false },
];
const JULY_DAYS: CalendarDay[] = [
  { date: "2026-07-15", isCurrentMonth: true, isToday: false },
];

describe("F326 CalendarDayGrid re-renders with fresh props (AS-442, AS-443, AS-448)", () => {
  it("test_AS_443_navigating_from_one_month_to_the_next_replaces_the_rendered_tasks_not_shows_stale_ones", () => {
    const { rerender } = render(
      createElement(CalendarDayGrid, {
        key: "2026-06",
        days: JUNE_DAYS,
        tasksByDate: { "2026-06-15": [makeTask("june-task", "June task", "2026-06-15")] },
        workspaceSlug: "acme",
      }),
    );

    expect(screen.getByText("June task")).toBeInTheDocument();

    // The real soft-navigation shape: a NEW key (month changed), NEW
    // days, NEW tasksByDate -- exactly what calendar/page.tsx -> MonthGrid
    // produces when the "->" link is clicked.
    rerender(
      createElement(CalendarDayGrid, {
        key: "2026-07",
        days: JULY_DAYS,
        tasksByDate: { "2026-07-15": [makeTask("july-task", "July task", "2026-07-15")] },
        workspaceSlug: "acme",
      }),
    );

    expect(screen.queryByText("June task")).not.toBeInTheDocument();
    expect(screen.getByText("July task")).toBeInTheDocument();
  });

  it("test_AS_448_applying_a_filter_within_the_same_month_replaces_the_rendered_tasks", () => {
    const { rerender } = render(
      createElement(CalendarDayGrid, {
        key: "2026-06",
        days: JUNE_DAYS,
        tasksByDate: {
          "2026-06-15": [makeTask("unfiltered", "Unfiltered task", "2026-06-15")],
        },
        workspaceSlug: "acme",
      }),
    );
    expect(screen.getByText("Unfiltered task")).toBeInTheDocument();

    // Same month, but the filter querystring changed -- calendar/page.tsx's
    // `dataKey` includes the filter suffix, so this is also a key change.
    rerender(
      createElement(CalendarDayGrid, {
        key: "2026-06&assigneeId=user-1",
        days: JUNE_DAYS,
        tasksByDate: {
          "2026-06-15": [makeTask("filtered", "Filtered task", "2026-06-15")],
        },
        workspaceSlug: "acme",
      }),
    );

    expect(screen.queryByText("Unfiltered task")).not.toBeInTheDocument();
    expect(screen.getByText("Filtered task")).toBeInTheDocument();
  });

  it("test_AS_442_an_incidental_rerender_with_an_unchanged_key_does_not_reset_in_flight_optimistic_state", () => {
    // Same `key` both times -- simulates a parent re-render that is NOT a
    // real navigation (e.g. some unrelated state update happening while a
    // drag's optimistic update is in flight). The component must stay
    // mounted and keep its own internal `byDate` mirror rather than
    // snapping back to whatever the (possibly stale, possibly
    // just-different) incoming `tasksByDate` prop says -- this is F234's
    // rollback safety, and the reason `key` was chosen over an
    // unconditional prop-sync `useEffect`.
    const { rerender } = render(
      createElement(CalendarDayGrid, {
        key: "2026-06",
        days: JUNE_DAYS,
        tasksByDate: { "2026-06-15": [makeTask("original", "Original task", "2026-06-15")] },
        workspaceSlug: "acme",
      }),
    );
    expect(screen.getByText("Original task")).toBeInTheDocument();

    rerender(
      createElement(CalendarDayGrid, {
        key: "2026-06",
        days: JUNE_DAYS,
        tasksByDate: { "2026-06-15": [makeTask("incidental", "Incidental task", "2026-06-15")] },
        workspaceSlug: "acme",
      }),
    );

    // The key didn't change, so React reused the same component instance
    // and its `byDate` state -- the original task is still the one shown.
    expect(screen.getByText("Original task")).toBeInTheDocument();
    expect(screen.queryByText("Incidental task")).not.toBeInTheDocument();
  });
});
