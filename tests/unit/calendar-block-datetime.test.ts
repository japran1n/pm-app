// Unit tests for the pure date/time helpers backing the Planner calendar
// blocks feature -- combining a "YYYY-MM-DD" day cell with an "HH:MM" form
// value into a real instant, and back again, plus the "move to another
// day, keep the time-of-day" helper the drag-to-move handler uses.

import { describe, expect, it } from "vitest";

import {
  combineDateAndTime,
  isoToLocalTime,
  isoToLocalDateOnly,
  moveIsoToDate,
  formatBlockTimeRange,
} from "@/lib/calendar/block-datetime";

describe("calendar block datetime helpers", () => {
  it("combines a date and a time into a round-trippable instant", () => {
    const iso = combineDateAndTime("2026-03-15", "08:05");
    expect(isoToLocalDateOnly(iso)).toBe("2026-03-15");
    expect(isoToLocalTime(iso)).toBe("08:05");
  });

  it("moveIsoToDate re-anchors an instant onto a new day, preserving its time-of-day", () => {
    const original = combineDateAndTime("2026-03-15", "14:30");
    const moved = moveIsoToDate(original, "2026-03-20");
    expect(isoToLocalDateOnly(moved)).toBe("2026-03-20");
    expect(isoToLocalTime(moved)).toBe("14:30");
  });

  it("formatBlockTimeRange renders a human start-end range", () => {
    const start = combineDateAndTime("2026-03-15", "10:00");
    const end = combineDateAndTime("2026-03-15", "14:30");
    const label = formatBlockTimeRange(start, end);
    expect(label).toContain("–");
    expect(label.length).toBeGreaterThan(0);
  });
});
