// @vitest-environment jsdom
//
// F034 (AS-066): approved time off for a member is shown as a strip above
// that member's stacked row.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { StackedPersonRow } from "@/components/calendar/stacked-person-row";
import type { TimeOffEntry } from "@/lib/queries/time-off";

afterEach(() => {
  cleanup();
});

// Monday of the test week, 2026-09-14 (a real Monday). Tuesday is
// 2026-09-15.
const WEEK_KEY = "2026-09-14";
const TUESDAY = "2026-09-15";

function makeTimeOff(overrides: Partial<TimeOffEntry>): TimeOffEntry {
  return {
    id: "pto-1",
    workspaceId: "ws-1",
    userId: "user-1",
    startDate: TUESDAY,
    endDate: TUESDAY,
    note: null,
    userName: "Ada Lovelace",
    userEmail: "ada@example.com",
    ...overrides,
  };
}

describe("F034 stacked time-off strip", () => {
  it("AS-066: a user with a time-off block on Tuesday shows the strip on Tuesday", () => {
    render(
      <StackedPersonRow
        userId="user-1"
        blocks={[]}
        timeOffEntries={[makeTimeOff({})]}
        weekKey={WEEK_KEY}
      />,
    );

    const strip = screen.getByTestId("stacked-time-off-strip");
    expect(strip).toBeInTheDocument();
    // Tuesday is isoWeekday 2 -- the strip's entries should be present in
    // that column's rendered content.
    expect(strip).toHaveTextContent("Ada Lovelace");
  });

  it("AS-066: a user with no time-off blocks renders no strip", () => {
    render(
      <StackedPersonRow
        userId="user-1"
        blocks={[]}
        timeOffEntries={[]}
        weekKey={WEEK_KEY}
      />,
    );

    expect(
      screen.queryByTestId("stacked-time-off-strip"),
    ).not.toBeInTheDocument();
  });

  it("AS-066: the strip appears above (before, as a sibling of) the time-grid, not inside it", () => {
    render(
      <StackedPersonRow
        userId="user-1"
        blocks={[]}
        timeOffEntries={[makeTimeOff({})]}
        weekKey={WEEK_KEY}
      />,
    );

    const strip = screen.getByTestId("stacked-time-off-strip");
    const grid = screen.getByTestId("stacked-grid");

    // Same parent -- the strip is a sibling, not a descendant of the grid.
    expect(strip.parentElement).toBe(grid.parentElement);
    // Sibling ordering: strip's DOM position precedes the grid's.
    expect(
      strip.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // And it must not be a descendant of the grid.
    expect(grid.contains(strip)).toBe(false);
  });

  it("mutation guard: an entry outside the visible week's date range must not render a strip", () => {
    // A time-off entry entirely in a different week (no overlap with
    // WEEK_KEY's Mon-Fri) must produce zero bucketed dates, so no strip
    // renders -- this is the negative-space check for the per-date
    // bucketing logic (eachDateInRange), analogous to a wrong
    // block-type filter silently admitting unrelated entries.
    render(
      <StackedPersonRow
        userId="user-1"
        blocks={[]}
        timeOffEntries={[
          makeTimeOff({ startDate: "2026-01-01", endDate: "2026-01-02" }),
        ]}
        weekKey={WEEK_KEY}
      />,
    );

    expect(
      screen.queryByTestId("stacked-time-off-strip"),
    ).not.toBeInTheDocument();
  });
});
