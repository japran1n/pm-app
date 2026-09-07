// Unit tests for lib/calendar/time-grid-layout.ts -- the pure pixel<->time
// maths behind the week view's time-axis positioning, drag-to-create, and
// block resize. No DOM/mouse events -- pure function tests, mirroring
// calendar-block-datetime.test.ts's own conventions.

import { describe, expect, it } from "vitest";

import {
  MINUTES_PER_DAY,
  PX_PER_HOUR,
  PX_PER_MINUTE,
  applyResize,
  blockLayoutForDay,
  dragRangeToTimes,
  minutesSinceMidnight,
  pixelOffsetToTime,
} from "@/lib/calendar/time-grid-layout";

describe("minutesSinceMidnight", () => {
  it("test_minutes_since_midnight_reads_local_hours_and_minutes", () => {
    const iso = new Date(2026, 7, 3, 9, 30, 0, 0).toISOString();
    expect(minutesSinceMidnight(iso)).toBe(9 * 60 + 30);
  });
});

describe("blockLayoutForDay", () => {
  it("test_AS_layout_block_within_a_single_day_gets_top_and_height_from_its_time_range", () => {
    const starts = new Date(2026, 7, 3, 9, 0, 0, 0).toISOString();
    const ends = new Date(2026, 7, 3, 10, 30, 0, 0).toISOString();
    const layout = blockLayoutForDay(starts, ends, "2026-08-03");
    expect(layout).not.toBeNull();
    expect(layout!.top).toBeCloseTo(9 * PX_PER_HOUR, 5);
    expect(layout!.height).toBeCloseTo(90 * PX_PER_MINUTE, 5);
  });

  it("test_layout_returns_null_for_a_day_the_block_does_not_overlap", () => {
    const starts = new Date(2026, 7, 3, 9, 0, 0, 0).toISOString();
    const ends = new Date(2026, 7, 3, 10, 0, 0, 0).toISOString();
    expect(blockLayoutForDay(starts, ends, "2026-08-04")).toBeNull();
  });

  it("test_layout_clamps_a_block_that_starts_before_the_days_midnight", () => {
    // Block spans 2026-08-02 23:00 -> 2026-08-03 01:00; on 2026-08-03 it
    // should be clamped to [00:00, 01:00), not carry a negative top.
    const starts = new Date(2026, 7, 2, 23, 0, 0, 0).toISOString();
    const ends = new Date(2026, 7, 3, 1, 0, 0, 0).toISOString();
    const layout = blockLayoutForDay(starts, ends, "2026-08-03");
    expect(layout).not.toBeNull();
    expect(layout!.top).toBe(0);
    expect(layout!.height).toBeCloseTo(60 * PX_PER_MINUTE, 5);
  });

  it("test_layout_enforces_a_minimum_visible_height_for_very_short_blocks", () => {
    const starts = new Date(2026, 7, 3, 9, 0, 0, 0).toISOString();
    const ends = new Date(2026, 7, 3, 9, 5, 0, 0).toISOString();
    const layout = blockLayoutForDay(starts, ends, "2026-08-03");
    expect(layout!.height).toBeGreaterThanOrEqual(15 * PX_PER_MINUTE);
  });
});

describe("pixelOffsetToTime", () => {
  it("test_pixel_offset_converts_and_snaps_to_the_nearest_quarter_hour", () => {
    // 9h07m in px, should snap to 09:00.
    const px = (9 * 60 + 7) * PX_PER_MINUTE;
    expect(pixelOffsetToTime(px)).toEqual({ hours: 9, minutes: 0 });
  });

  it("test_pixel_offset_clamps_to_the_visible_day_bounds", () => {
    expect(pixelOffsetToTime(-100)).toEqual({ hours: 0, minutes: 0 });
    expect(pixelOffsetToTime(MINUTES_PER_DAY * PX_PER_MINUTE + 500)).toEqual({
      hours: 24,
      minutes: 0,
    });
  });
});

describe("dragRangeToTimes", () => {
  it("test_drag_to_create_produces_the_exact_snapped_range_the_user_dragged", () => {
    const startPx = 9 * PX_PER_HOUR;
    const endPx = 10 * PX_PER_HOUR + 30 * PX_PER_MINUTE;
    const range = dragRangeToTimes(startPx, endPx);
    expect(range).toEqual({ startTime: "09:00", endTime: "10:30" });
  });

  it("test_drag_to_create_handles_an_upward_drag_by_normalizing_the_order", () => {
    const range = dragRangeToTimes(11 * PX_PER_HOUR, 9 * PX_PER_HOUR);
    expect(range).toEqual({ startTime: "09:00", endTime: "11:00" });
  });

  it("test_drag_to_create_never_produces_a_zero_length_range", () => {
    const px = 9 * PX_PER_HOUR;
    const range = dragRangeToTimes(px, px);
    expect(range.startTime).toBe("09:00");
    expect(range.endTime).toBe("09:15");
  });
});

describe("applyResize", () => {
  const dayDateOnly = "2026-08-03";
  const starts = new Date(2026, 7, 3, 9, 0, 0, 0).toISOString();
  const ends = new Date(2026, 7, 3, 11, 0, 0, 0).toISOString();

  it("test_resize_start_edge_moves_only_the_start_time", () => {
    const newOffsetPx = 8 * PX_PER_HOUR; // drag start handle up to 08:00
    const result = applyResize("start", starts, ends, dayDateOnly, newOffsetPx);
    expect(new Date(result.startsAt).getHours()).toBe(8);
    expect(result.endsAt).toBe(ends);
  });

  it("test_resize_end_edge_moves_only_the_end_time", () => {
    const newOffsetPx = 12 * PX_PER_HOUR; // drag end handle down to 12:00
    const result = applyResize("end", starts, ends, dayDateOnly, newOffsetPx);
    expect(result.startsAt).toBe(starts);
    expect(new Date(result.endsAt).getHours()).toBe(12);
  });

  it("test_resize_start_edge_cannot_cross_past_the_fixed_end_edge", () => {
    // Attempt to drag the start handle down to 13:00, past the fixed 11:00 end.
    const newOffsetPx = 13 * PX_PER_HOUR;
    const result = applyResize("start", starts, ends, dayDateOnly, newOffsetPx);
    expect(new Date(result.startsAt).getTime()).toBeLessThan(new Date(result.endsAt).getTime());
  });

  it("test_resize_end_edge_cannot_cross_before_the_fixed_start_edge", () => {
    const newOffsetPx = 7 * PX_PER_HOUR;
    const result = applyResize("end", starts, ends, dayDateOnly, newOffsetPx);
    expect(new Date(result.endsAt).getTime()).toBeGreaterThan(new Date(result.startsAt).getTime());
  });
});
