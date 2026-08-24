// F240 (AS-456): unit tests for the timeline's zoom levels (week/month/
// quarter). Pure module tests -- mirrors tests/unit/timeline-layout.ts's
// own "pure maths, no DB, no network" shape for its sibling F237/F238/
// F239 features. Also re-proves that F237's layout maths, F238's drag/
// resize planner, and F239's dependency connector geometry all stay
// correct once `pixelsPerDay` varies by zoom level -- this feature's own
// flagged top risk.

import { describe, expect, it } from "vitest";

import {
  DEFAULT_PIXELS_PER_DAY,
  PIXELS_PER_DAY_BY_ZOOM,
  TIMELINE_ZOOM_LEVELS,
  buildTimelineDayTicks,
  computeBarLayout,
  computeDependencyConnectors,
  computeTimelineRowPositions,
  diffCalendarDays,
  resolveTimelineZoom,
  timelineRangeForMonth,
  timelineRangeForZoom,
  type TimelineBarLayout,
  type TimelineZoomLevel,
} from "@/lib/timeline/layout";
import { pixelDeltaToDayDelta, planTimelineBarMove, planTimelineBarResize } from "@/lib/timeline/reschedule";

describe("F240 resolveTimelineZoom (AS-456: a stale/invalid zoom param degrades to the default)", () => {
  it("test_AS_456_valid_zoom_values_round_trip_unchanged", () => {
    expect(resolveTimelineZoom("week")).toBe("week");
    expect(resolveTimelineZoom("month")).toBe("month");
    expect(resolveTimelineZoom("quarter")).toBe("quarter");
  });

  it("test_AS_456_missing_zoom_param_degrades_to_the_default_month", () => {
    expect(resolveTimelineZoom(undefined)).toBe("month");
    expect(resolveTimelineZoom(null)).toBe("month");
  });

  it("test_AS_456_a_tampered_or_unknown_zoom_value_degrades_gracefully_never_throws", () => {
    expect(resolveTimelineZoom("decade")).toBe("month");
    expect(resolveTimelineZoom("")).toBe("month");
    expect(resolveTimelineZoom("WEEK")).toBe("month"); // case-sensitive, not coerced
    expect(() => resolveTimelineZoom("<script>")).not.toThrow();
    expect(resolveTimelineZoom("<script>")).toBe("month");
  });
});

describe("F240 timelineRangeForZoom (AS-456: each zoom level has a real, distinct, bounded window)", () => {
  it("test_AS_456_week_zoom_is_the_anchor_month_alone", () => {
    const { start, end } = timelineRangeForZoom(2026, 8, "week");
    expect(start).toBe("2026-08-01");
    expect(end).toBe("2026-08-31");
  });

  it("test_AS_456_month_zoom_matches_the_existing_three_month_window_unchanged", () => {
    const zoomed = timelineRangeForZoom(2026, 8, "month");
    const original = timelineRangeForMonth(2026, 8);
    expect(zoomed).toEqual(original);
  });

  it("test_AS_456_quarter_zoom_is_bounded_not_a_whole_workspace_history_fetch", () => {
    const { start, end } = timelineRangeForZoom(2026, 8, "quarter");
    expect(start).toBe("2026-02-01");
    expect(end).toBe("2027-02-28");
    // Bounded: 13 calendar months, not an open-ended/huge range.
    const totalDays = diffCalendarDays(start, end) + 1;
    expect(totalDays).toBeLessThan(400);
  });

  it("test_AS_456_quarter_zoom_handles_a_leap_year_february_correctly", () => {
    const { start, end } = timelineRangeForZoom(2028, 8, "quarter");
    expect(start).toBe("2028-02-01");
    expect(end).toBe("2029-02-28");
    const ticks = buildTimelineDayTicks(start, end, PIXELS_PER_DAY_BY_ZOOM.quarter);
    expect(ticks.some((t) => t.date === "2028-02-29")).toBe(true);
  });

  it("test_AS_456_zoom_change_preserves_the_centre_anchor_month_never_resets_to_today", () => {
    // Switching zoom levels for the SAME (year, month) anchor never
    // changes which month is the centre -- only the window width around
    // it varies. Verified by checking every zoom's range still contains
    // the anchor month itself.
    for (const zoom of TIMELINE_ZOOM_LEVELS) {
      const { start, end } = timelineRangeForZoom(2026, 8, zoom);
      expect(diffCalendarDays(start, "2026-08-01")).toBeGreaterThanOrEqual(0);
      expect(diffCalendarDays("2026-08-31", end)).toBeGreaterThanOrEqual(0);
    }
  });

  it("test_AS_456_dst_transition_month_stays_a_whole_number_of_days_at_every_zoom", () => {
    for (const zoom of TIMELINE_ZOOM_LEVELS) {
      const { start, end } = timelineRangeForZoom(2026, 3, zoom); // March 2026: US DST spring-forward
      expect(Number.isInteger(diffCalendarDays(start, end))).toBe(true);
    }
  });
});

describe("F240 header granularity differs per zoom level (days / weeks / months)", () => {
  it("test_AS_456_week_zoom_ticks_expose_a_flag_for_every_day", () => {
    const { start, end } = timelineRangeForZoom(2026, 8, "week");
    const ticks = buildTimelineDayTicks(start, end, PIXELS_PER_DAY_BY_ZOOM.week);
    // Every day is present (day-level granularity for "week" zoom).
    expect(ticks.length).toBe(diffCalendarDays(start, end) + 1);
    // Monday flags are correct (2026-08-03 is a Monday).
    const monday = ticks.find((t) => t.date === "2026-08-03");
    expect(monday?.isWeekStart).toBe(true);
  });

  it("test_AS_456_quarter_zoom_ticks_flag_quarter_starts", () => {
    const { start, end } = timelineRangeForZoom(2026, 8, "quarter");
    const ticks = buildTimelineDayTicks(start, end, PIXELS_PER_DAY_BY_ZOOM.quarter);
    const quarterStarts = ticks.filter((t) => t.isQuarterStart).map((t) => t.date);
    expect(quarterStarts).toEqual(["2026-04-01", "2026-07-01", "2026-10-01", "2027-01-01"]);
  });
});

describe("F240 drag/resize round trip stays exact at EVERY zoom level (off-by-one guard)", () => {
  const zoomLevels: TimelineZoomLevel[] = [...TIMELINE_ZOOM_LEVELS];

  for (const zoom of zoomLevels) {
    const pixelsPerDay = PIXELS_PER_DAY_BY_ZOOM[zoom];

    it(`test_AS_456_move_drag_resolves_to_a_whole_correct_date_at_${zoom}_zoom`, () => {
      // Drag exactly 3 whole days' worth of pixels.
      const deltaPx = pixelsPerDay * 3;
      const deltaDays = pixelDeltaToDayDelta(deltaPx, pixelsPerDay);
      expect(deltaDays).toBe(3);

      const plan = planTimelineBarMove(
        { id: "t1", startDate: "2026-06-10", dueDate: "2026-06-14" },
        deltaDays,
      );
      expect(plan).toEqual({ startDate: "2026-06-13", dueDate: "2026-06-17" });
      // Never fractional / off-by-one: both dates are exact YYYY-MM-DD.
      expect(plan?.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(plan?.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it(`test_AS_456_resize_drag_resolves_to_a_whole_correct_date_at_${zoom}_zoom`, () => {
      // Resize the start handle by exactly 2 whole days' worth of pixels.
      const deltaPx = pixelsPerDay * 2;
      const deltaDays = pixelDeltaToDayDelta(deltaPx, pixelsPerDay);
      expect(deltaDays).toBe(2);

      const plan = planTimelineBarResize(
        { id: "t1", startDate: "2026-06-10", dueDate: "2026-06-20" },
        "start",
        deltaDays,
      );
      expect(plan).toEqual({ startDate: "2026-06-12", dueDate: "2026-06-20" });
    });

    it(`test_AS_456_a_sub_day_pixel_delta_is_a_no_op_at_${zoom}_zoom_never_a_fractional_day`, () => {
      // A drag of less than half a day's pixel width rounds to zero days
      // -- never a fractional-day write at any zoom's pixel density.
      const deltaPx = Math.floor(pixelsPerDay * 0.4);
      const deltaDays = pixelDeltaToDayDelta(deltaPx, pixelsPerDay);
      expect(deltaDays).toBe(0);
      const plan = planTimelineBarMove({ id: "t1", startDate: "2026-06-10", dueDate: "2026-06-14" }, deltaDays);
      expect(plan).toBeNull();
    });
  }
});

describe("F240 bar layout / positioning maths re-derives correctly at every zoom level", () => {
  for (const zoom of TIMELINE_ZOOM_LEVELS) {
    const pixelsPerDay = PIXELS_PER_DAY_BY_ZOOM[zoom];

    it(`test_AS_456_bar_left_and_width_scale_with_pixels_per_day_at_${zoom}_zoom`, () => {
      const { start, end } = timelineRangeForZoom(2026, 8, zoom);
      const layout = computeBarLayout(
        { id: "t1", startDate: "2026-08-05", dueDate: "2026-08-07" },
        start,
        end,
        pixelsPerDay,
      );
      expect(layout).not.toBeNull();
      const leftDays = diffCalendarDays(start, "2026-08-05");
      expect(layout?.leftPx).toBe(leftDays * pixelsPerDay);
      expect(layout?.widthPx).toBe(3 * pixelsPerDay); // 3 inclusive days
    });
  }
});

describe("F240 dependency connector geometry stays correct at every zoom level", () => {
  for (const zoom of TIMELINE_ZOOM_LEVELS) {
    const pixelsPerDay = PIXELS_PER_DAY_BY_ZOOM[zoom];

    it(`test_AS_456_connector_geometry_re_derives_from_the_zoomed_bar_positions_at_${zoom}_zoom`, () => {
      const { start, end } = timelineRangeForZoom(2026, 8, zoom);
      const blockingLayout = computeBarLayout(
        { id: "blocking", startDate: "2026-08-05", dueDate: "2026-08-07" },
        start,
        end,
        pixelsPerDay,
      ) as TimelineBarLayout;
      const blockedLayout = computeBarLayout(
        { id: "blocked", startDate: "2026-08-10", dueDate: "2026-08-12" },
        start,
        end,
        pixelsPerDay,
      ) as TimelineBarLayout;

      const rowPositions = computeTimelineRowPositions([
        { tasks: [{ id: "blocking" }, { id: "blocked" }] },
      ]);
      const barLefts = new Map<string, TimelineBarLayout>([
        ["blocking", blockingLayout],
        ["blocked", blockedLayout],
      ]);

      const connectors = computeDependencyConnectors(
        [{ id: "edge1", blockingTaskId: "blocking", blockedTaskId: "blocked" }],
        rowPositions,
        barLefts,
      );

      expect(connectors).toHaveLength(1);
      // The connector's start x must equal the blocking bar's own
      // trailing edge at THIS zoom's pixel density -- never a stale
      // value computed at a different zoom's pixelsPerDay.
      const expectedX1 = blockingLayout.leftPx + blockingLayout.widthPx;
      expect(connectors[0].d.startsWith(`M ${expectedX1} `)).toBe(true);
    });
  }
});

describe("F240 default pixels-per-day for month zoom is unchanged (backward compatibility)", () => {
  it("test_AS_456_month_zoom_pixels_per_day_equals_the_pre_existing_default", () => {
    expect(PIXELS_PER_DAY_BY_ZOOM.month).toBe(DEFAULT_PIXELS_PER_DAY);
  });
});
