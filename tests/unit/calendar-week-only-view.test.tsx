// @vitest-environment jsdom
//
// Week-only calendar: month view removed entirely per product decision --
// Week is now the SOLE view, with no Month/Week toggle anywhere. This is
// the component-level regression guard for that markup change: proves
// <WeekView> itself never renders a toggle, and that its own mobile
// fallback copy no longer references a "Month view" that no longer
// exists (a stale string would silently point users at a dead feature).
//
// F088: WeekView's own "Today" nav link moved out into the shared
// <PlannerHeader> (rendered once by page.tsx, above the layout branch) --
// that link's own view-param regression coverage now lives in
// tests/unit/f088-planner-header-lift.test.tsx alongside the rest of the
// header's rendered-href assertions.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { WeekView } from "@/components/calendar/week-view";
import { buildCalendarWeek } from "@/lib/calendar/week-grid";

afterEach(cleanup);

const WEEK = buildCalendarWeek("2026-06-01", "UTC");

describe("Week-only calendar view (month view removed)", () => {
  it("test_week_view_never_renders_a_month_or_view_toggle", () => {
    render(
      <WeekView
        week={WEEK}
        blocks={[]}
        workspaceSlug="acme"
        workspaceId="workspace-1"
        currentUserId="user-1"
      />,
    );

    expect(screen.queryByTestId("calendar-view-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("calendar-view-toggle-month")).not.toBeInTheDocument();
    expect(screen.queryByTestId("calendar-view-toggle-week")).not.toBeInTheDocument();
    expect(screen.queryByText(/month view/i)).not.toBeInTheDocument();
  });

  it("test_week_view_renders_the_real_time_grid_body", () => {
    render(
      <WeekView
        week={WEEK}
        blocks={[]}
        workspaceSlug="acme"
        workspaceId="workspace-1"
        currentUserId="user-1"
      />,
    );

    expect(screen.getByTestId("calendar-week-time-grid")).toBeInTheDocument();
  });
});
