// Unit test for F113 (AS-171): the minutes -> "Xh Ym" formatting helper
// (lib/time/format-duration.ts) used both by TimeTracking's total display
// (task detail sheet) and TaskCard's time indicator, so the two never
// disagree on how a duration reads.

import { describe, expect, it } from "vitest";

import { formatDuration } from "@/lib/time/format-duration";

describe("formatDuration", () => {
  it("test_TT_001_spec_examples", () => {
    expect(formatDuration(90)).toBe("1 hr 30 min");
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(120)).toBe("2 hr");
    expect(formatDuration(0)).toBe("0 min");
  });

  it("test_AS_171_formats_zero_minutes_as_0m", () => {
    expect(formatDuration(0)).toBe("0 min");
  });

  it("test_AS_171_formats_sub_hour_minutes_without_leading_0h", () => {
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(1)).toBe("1 min");
  });

  it("test_AS_171_formats_whole_hours_without_trailing_0m", () => {
    expect(formatDuration(60)).toBe("1 hr");
    expect(formatDuration(180)).toBe("3 hr");
  });

  it("test_AS_171_formats_hours_and_minutes_together", () => {
    expect(formatDuration(90)).toBe("1 hr 30 min");
    expect(formatDuration(125)).toBe("2 hr 5 min");
  });

  it("test_AS_171_rounds_fractional_minutes", () => {
    expect(formatDuration(90.6)).toBe("1 hr 31 min");
  });

  it("test_AS_171_clamps_negative_or_non_finite_input_to_zero", () => {
    expect(formatDuration(-15)).toBe("0 min");
    expect(formatDuration(Number.NaN)).toBe("0 min");
  });
});
