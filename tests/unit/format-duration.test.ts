// Unit test for F113 (AS-171): the minutes -> "Xh Ym" formatting helper
// (lib/time/format-duration.ts) used both by TimeTracking's total display
// (task detail sheet) and TaskCard's time indicator, so the two never
// disagree on how a duration reads.

import { describe, expect, it } from "vitest";

import { formatDuration } from "@/lib/time/format-duration";

describe("formatDuration", () => {
  it("test_AS_171_formats_zero_minutes_as_0m", () => {
    expect(formatDuration(0)).toBe("0m");
  });

  it("test_AS_171_formats_sub_hour_minutes_without_leading_0h", () => {
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(1)).toBe("1m");
  });

  it("test_AS_171_formats_whole_hours_without_trailing_0m", () => {
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(180)).toBe("3h");
  });

  it("test_AS_171_formats_hours_and_minutes_together", () => {
    expect(formatDuration(90)).toBe("1h 30m");
    expect(formatDuration(125)).toBe("2h 5m");
  });

  it("test_AS_171_rounds_fractional_minutes", () => {
    expect(formatDuration(90.6)).toBe("1h 31m");
  });

  it("test_AS_171_clamps_negative_or_non_finite_input_to_zero", () => {
    expect(formatDuration(-15)).toBe("0m");
    expect(formatDuration(Number.NaN)).toBe("0m");
  });
});
