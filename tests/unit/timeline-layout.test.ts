// Unit tests for F237's pure timeline layout maths (AS-451, AS-452,
// AS-457, AS-458). No DB, no network -- pure function tests, mirroring
// tests/unit/calendar-month-grid.test.ts's own coverage shape.

import { describe, expect, it } from "vitest";

import {
  DEFAULT_PIXELS_PER_DAY,
  buildTimelineDayTicks,
  computeBarLayout,
  diffCalendarDays,
  isPlaceableOnTimeline,
  timelineRangeForMonth,
  timelineTotalWidthPx,
  todayLineOffsetPx,
} from "@/lib/timeline/layout";

describe("F237 timelineRangeForMonth (month/quarter boundaries)", () => {
  it("test_AS_451_range_spans_the_month_before_current_and_after", () => {
    const { start, end } = timelineRangeForMonth(2026, 8);
    expect(start).toBe("2026-07-01");
    expect(end).toBe("2026-09-30");
  });

  it("test_AS_451_range_correctly_crosses_a_year_boundary", () => {
    // December -> the range spans Nov of the same year through Jan of
    // the NEXT year -- a bar spanning this range must not silently wrap
    // or misplace across the Dec 31 / Jan 1 boundary.
    const { start, end } = timelineRangeForMonth(2026, 12);
    expect(start).toBe("2026-11-01");
    expect(end).toBe("2027-01-31");
  });

  it("test_AS_451_range_correctly_crosses_a_quarter_boundary", () => {
    // March -> range spans Feb through Apr, crossing Q1/Q2.
    const { start, end } = timelineRangeForMonth(2026, 3);
    expect(start).toBe("2026-02-01");
    expect(end).toBe("2026-04-30");
  });

  it("test_AS_451_range_handles_a_leap_year_february_correctly", () => {
    // 2028 is a leap year -- February has 29 days.
    const { start, end } = timelineRangeForMonth(2028, 2);
    expect(start).toBe("2028-01-01");
    expect(end).toBe("2028-03-31");
    // Confirm Feb 29 exists in the tick set for this range.
    const ticks = buildTimelineDayTicks(start, end, DEFAULT_PIXELS_PER_DAY);
    expect(ticks.some((t) => t.date === "2028-02-29")).toBe(true);
  });

  it("test_AS_451_range_handles_a_dst_transition_month", () => {
    // March 2026: US spring-forward DST (2026-03-08). This module is
    // UTC-anchored throughout, so the transition must not perturb the
    // day count at all.
    const { start, end } = timelineRangeForMonth(2026, 3);
    expect(diffCalendarDays(start, end)).toBe(diffCalendarDays("2026-02-01", "2026-04-30"));
    const ticks = buildTimelineDayTicks(start, end);
    expect(ticks.length % 1).toBe(0);
    // No gap/duplicate across the DST date itself.
    const marchTicks = ticks.filter((t) => t.date.startsWith("2026-03"));
    expect(marchTicks.length).toBe(31);
    expect(new Set(marchTicks.map((t) => t.date)).size).toBe(31);
  });
});

describe("F237 diffCalendarDays", () => {
  it("test_AS_451_diff_is_zero_for_the_same_date", () => {
    expect(diffCalendarDays("2026-06-15", "2026-06-15")).toBe(0);
  });

  it("test_AS_451_diff_is_correct_across_a_year_boundary", () => {
    expect(diffCalendarDays("2026-12-30", "2027-01-02")).toBe(3);
  });
});

describe("F237 computeBarLayout (AS-451, AS-452)", () => {
  const RANGE_START = "2026-08-01";
  const RANGE_END = "2026-08-31";

  it("test_AS_451_a_task_with_both_dates_renders_as_a_range_bar_spanning_start_to_due", () => {
    const layout = computeBarLayout(
      { id: "t1", startDate: "2026-08-05", dueDate: "2026-08-10" },
      RANGE_START,
      RANGE_END,
      10,
    );
    expect(layout).not.toBeNull();
    expect(layout!.kind).toBe("range");
    expect(layout!.leftPx).toBe(diffCalendarDays(RANGE_START, "2026-08-05") * 10);
    // Inclusive of both endpoints: Aug 5 through Aug 10 = 6 days.
    expect(layout!.widthPx).toBe(6 * 10);
  });

  it("test_AS_452_a_task_without_a_start_date_renders_as_a_single_day_marker_on_its_due_date", () => {
    const layout = computeBarLayout(
      { id: "t2", startDate: null, dueDate: "2026-08-12" },
      RANGE_START,
      RANGE_END,
      10,
    );
    expect(layout).not.toBeNull();
    expect(layout!.kind).toBe("marker");
    expect(layout!.markerDate).toBe("2026-08-12");
    expect(layout!.widthPx).toBe(10);
  });

  it("test_AS_452_a_task_with_a_start_date_but_no_due_date_renders_as_a_single_day_marker_on_its_start_date", () => {
    const layout = computeBarLayout(
      { id: "t3", startDate: "2026-08-20", dueDate: null },
      RANGE_START,
      RANGE_END,
      10,
    );
    expect(layout).not.toBeNull();
    expect(layout!.kind).toBe("marker");
    expect(layout!.markerDate).toBe("2026-08-20");
  });

  it("test_AS_452_a_task_with_neither_date_is_not_placeable_and_layout_returns_null", () => {
    expect(isPlaceableOnTimeline({ id: "t4", startDate: null, dueDate: null })).toBe(false);
    const layout = computeBarLayout(
      { id: "t4", startDate: null, dueDate: null },
      RANGE_START,
      RANGE_END,
      10,
    );
    expect(layout).toBeNull();
  });

  it("test_AS_451_a_bar_spanning_a_year_boundary_is_clipped_to_the_visible_range_but_positioned_correctly", () => {
    const layout = computeBarLayout(
      { id: "t5", startDate: "2026-12-20", dueDate: "2027-01-10" },
      "2026-12-01",
      "2027-01-31",
      10,
    );
    expect(layout).not.toBeNull();
    expect(layout!.kind).toBe("range");
    expect(layout!.leftPx).toBe(diffCalendarDays("2026-12-01", "2026-12-20") * 10);
    // Dec 20 through Jan 10 inclusive = 22 days.
    expect(layout!.widthPx).toBe(22 * 10);
  });

  it("test_AS_451_a_bar_extending_before_the_visible_range_is_clipped_at_the_left_edge", () => {
    const layout = computeBarLayout(
      { id: "t6", startDate: "2026-07-01", dueDate: "2026-08-05" },
      RANGE_START,
      RANGE_END,
      10,
    );
    expect(layout!.leftPx).toBe(0);
  });
});

describe("F237 todayLineOffsetPx (AS-457)", () => {
  it("test_AS_457_today_inside_the_range_returns_its_pixel_offset", () => {
    const offset = todayLineOffsetPx("2026-08-15", "2026-08-01", "2026-08-31", 10);
    expect(offset).toBe(diffCalendarDays("2026-08-01", "2026-08-15") * 10);
  });

  it("test_AS_457_today_outside_the_range_returns_null", () => {
    expect(todayLineOffsetPx("2026-09-01", "2026-08-01", "2026-08-31", 10)).toBeNull();
  });
});

describe("F237 timelineTotalWidthPx / buildTimelineDayTicks (AS-458)", () => {
  it("test_AS_458_total_width_covers_every_day_in_the_range_inclusive", () => {
    const width = timelineTotalWidthPx("2026-08-01", "2026-08-31", 10);
    expect(width).toBe(31 * 10);
  });

  it("test_AS_458_day_ticks_are_monotonically_increasing_with_no_gaps", () => {
    const ticks = buildTimelineDayTicks("2026-08-01", "2026-08-05", 10);
    expect(ticks.map((t) => t.date)).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
    ]);
    expect(ticks.map((t) => t.leftPx)).toEqual([0, 10, 20, 30, 40]);
  });
});
