// Unit tests for the week view's pure date maths (lib/calendar/week-grid.ts),
// mirroring calendar-month-grid.test.ts's own conventions -- no DB, no
// network, pure function tests.

import { describe, expect, it } from "vitest";

import {
  buildCalendarWeek,
  currentWeekKey,
  nextWeekKey,
  parseWeekKey,
  previousWeekKey,
  toWeekKey,
  weekDateRange,
} from "@/lib/calendar/week-grid";

describe("week-grid toWeekKey / buildCalendarWeek", () => {
  it("test_week_view_resolves_any_date_onto_its_own_mondays_week", () => {
    // 2026-08-01 is a Saturday -- its week's Monday is 2026-07-27.
    expect(toWeekKey("2026-08-01")).toBe("2026-07-27");
  });

  it("test_week_view_grid_has_exactly_seven_days_monday_start", () => {
    const week = buildCalendarWeek("2026-08-01", "UTC");
    expect(week.days).toHaveLength(7);
    expect(week.weekKey).toBe("2026-07-27");
    expect(week.days[0]!.date).toBe("2026-07-27");
    expect(week.days[6]!.date).toBe("2026-08-02");
    const firstDate = new Date(`${week.days[0]!.date}T12:00:00Z`);
    expect(firstDate.getUTCDay()).toBe(1); // Monday
  });

  it("test_week_view_marks_the_matching_day_as_today", () => {
    const week = buildCalendarWeek("2026-08-01", "UTC", new Date("2026-07-29T12:00:00Z"));
    const today = week.days.find((d) => d.isToday);
    expect(today?.date).toBe("2026-07-29");
  });
});

describe("week-grid navigation", () => {
  it("test_week_view_previous_and_next_week_step_by_seven_days", () => {
    expect(previousWeekKey("2026-08-03")).toBe("2026-07-27");
    expect(nextWeekKey("2026-08-03")).toBe("2026-08-10");
  });

  it("test_week_view_current_week_key_uses_callers_timezone", () => {
    const key = currentWeekKey("UTC", new Date("2026-08-01T12:00:00Z"));
    expect(key).toBe("2026-07-27");
  });
});

describe("week-grid parseWeekKey", () => {
  it("test_week_view_parses_a_valid_date_only_string", () => {
    expect(parseWeekKey("2026-08-03")).toBe("2026-08-03");
  });

  it("test_week_view_rejects_malformed_or_impossible_dates", () => {
    expect(parseWeekKey(undefined)).toBeNull();
    expect(parseWeekKey("not-a-date")).toBeNull();
    expect(parseWeekKey("2026-13-40")).toBeNull();
  });
});

describe("week-grid weekDateRange", () => {
  it("test_week_view_date_range_spans_the_full_seven_days", () => {
    const range = weekDateRange("2026-08-01");
    expect(range).toEqual({ start: "2026-07-27", end: "2026-08-02" });
  });
});
