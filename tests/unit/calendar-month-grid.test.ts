// Unit tests for F232's pure calendar month-grid date maths
// (AS-442, AS-443, AS-450). No DB, no network -- pure function tests.

import { describe, expect, it } from "vitest";

import {
  buildCalendarMonth,
  currentMonthKey,
  monthDateRange,
  nextMonthKey,
  parseMonthKey,
  previousMonthKey,
  toMonthKey,
} from "@/lib/calendar/month-grid";

describe("F232 buildCalendarMonth (AS-442, AS-443)", () => {
  it("test_AS_442_month_boundaries_first_and_last_of_month_are_correct", () => {
    const grid = buildCalendarMonth(2026, 8, "UTC");
    expect(grid.firstOfMonth).toBe("2026-08-01");
    expect(grid.lastOfMonth).toBe("2026-08-31");
    expect(grid.monthKey).toBe("2026-08");
  });

  it("test_AS_443_week_start_is_monday", () => {
    // August 1, 2026 is a Saturday -- the grid's first cell must be the
    // Monday of that week (2026-07-27), not August 1 itself.
    const grid = buildCalendarMonth(2026, 8, "UTC");
    expect(grid.days[0]!.date).toBe("2026-07-27");
    const firstDate = new Date(`${grid.days[0]!.date}T12:00:00Z`);
    expect(firstDate.getUTCDay()).toBe(1); // Monday
  });

  it("test_AS_442_leading_and_trailing_days_from_adjacent_months_are_marked_not_current_month", () => {
    const grid = buildCalendarMonth(2026, 8, "UTC");
    const leading = grid.days.find((d) => d.date === "2026-07-27")!;
    expect(leading.isCurrentMonth).toBe(false);
    const inMonth = grid.days.find((d) => d.date === "2026-08-15")!;
    expect(inMonth.isCurrentMonth).toBe(true);
  });

  it("test_AS_442_grid_always_spans_a_whole_number_of_weeks", () => {
    const grid = buildCalendarMonth(2026, 8, "UTC");
    expect(grid.days.length % 7).toBe(0);
  });

  it("test_AS_442_dst_transition_month_has_no_gap_or_duplicate_day", () => {
    // March 2026: US spring-forward DST transition falls on 2026-03-08.
    // Verify every day of March appears exactly once in sequence with no
    // skip/repeat, when the grid's "isToday" is evaluated against an
    // America/New_York timezone that actually observes the transition.
    const grid = buildCalendarMonth(2026, 3, "America/New_York");
    const marchDays = grid.days.filter((d) => d.isCurrentMonth).map((d) => d.date);
    expect(marchDays[0]).toBe("2026-03-01");
    expect(marchDays[marchDays.length - 1]).toBe("2026-03-31");
    expect(marchDays.length).toBe(31);
    // No duplicates.
    expect(new Set(marchDays).size).toBe(31);
  });

  it("test_AS_450_isToday_flag_is_computed_in_the_supplied_timezone", () => {
    // 2026-08-24T02:30:00Z is still 2026-08-23 in America/Los_Angeles
    // (UTC-7 in August) but already 2026-08-24 in UTC.
    const instant = new Date("2026-08-24T02:30:00Z");
    const laGrid = buildCalendarMonth(2026, 8, "America/Los_Angeles", instant);
    const laToday = laGrid.days.find((d) => d.isToday);
    expect(laToday?.date).toBe("2026-08-23");

    const utcGrid = buildCalendarMonth(2026, 8, "UTC", instant);
    const utcToday = utcGrid.days.find((d) => d.isToday);
    expect(utcToday?.date).toBe("2026-08-24");
  });
});

describe("F232 month navigation (AS-443)", () => {
  it("test_AS_443_previous_month_key_crosses_year_boundary", () => {
    expect(previousMonthKey(2026, 1)).toEqual({ year: 2025, month: 12 });
  });

  it("test_AS_443_next_month_key_crosses_year_boundary", () => {
    expect(nextMonthKey(2026, 12)).toEqual({ year: 2027, month: 1 });
  });

  it("test_AS_443_previous_next_month_key_within_year", () => {
    expect(previousMonthKey(2026, 8)).toEqual({ year: 2026, month: 7 });
    expect(nextMonthKey(2026, 8)).toEqual({ year: 2026, month: 9 });
  });

  it("test_AS_450_current_month_key_reflects_the_supplied_timezone", () => {
    const instant = new Date("2026-08-01T02:30:00Z"); // already Aug 1 UTC
    expect(currentMonthKey("UTC", instant)).toEqual({ year: 2026, month: 8 });
    // In America/Los_Angeles (UTC-7 in August), this instant is still
    // 2026-07-31 -- the current month must be July, not August.
    expect(currentMonthKey("America/Los_Angeles", instant)).toEqual({
      year: 2026,
      month: 7,
    });
  });

  it("test_AS_443_parseMonthKey_rejects_malformed_input", () => {
    expect(parseMonthKey(undefined)).toBeNull();
    expect(parseMonthKey("")).toBeNull();
    expect(parseMonthKey("2026-13")).toBeNull();
    expect(parseMonthKey("not-a-month")).toBeNull();
  });

  it("test_AS_443_parseMonthKey_and_toMonthKey_round_trip", () => {
    expect(parseMonthKey("2026-08")).toEqual({ year: 2026, month: 8 });
    expect(toMonthKey(2026, 8)).toBe("2026-08");
  });
});

describe("F232 monthDateRange (AS-442)", () => {
  it("test_AS_442_range_includes_leading_and_trailing_days", () => {
    const { start, end } = monthDateRange(2026, 8);
    expect(start).toBe("2026-07-27");
    expect(end < "2026-09-07").toBe(true);
    expect(end >= "2026-08-31").toBe(true);
  });
});
