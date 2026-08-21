// Unit tests for F167's getEstimateProgress pure helper (AS-300, AS-301,
// AS-302). Same "single pure helper, unit-tested independent of any
// component" convention as tests/unit/is-overdue.test.ts.

import { describe, expect, it } from "vitest";

import { getEstimateProgress } from "@/lib/tasks/estimate-progress";

describe("getEstimateProgress", () => {
  it("test_AS_302_returns_null_when_estimateMinutes_is_null", () => {
    expect(getEstimateProgress(null, 45)).toBeNull();
  });

  it("test_AS_302_returns_null_when_estimateMinutes_is_undefined", () => {
    expect(getEstimateProgress(undefined, 45)).toBeNull();
  });

  it("test_AS_302_returns_null_when_estimateMinutes_is_zero_or_negative", () => {
    expect(getEstimateProgress(0, 45)).toBeNull();
    expect(getEstimateProgress(-30, 45)).toBeNull();
  });

  it("test_AS_300_computes_a_clamped_percent_of_logged_over_estimate", () => {
    expect(getEstimateProgress(120, 60)).toEqual({
      percent: 50,
      isOverEstimate: false,
    });
    expect(getEstimateProgress(120, 0)).toEqual({
      percent: 0,
      isOverEstimate: false,
    });
  });

  it("test_AS_301_flags_isOverEstimate_only_when_logged_strictly_exceeds_estimate", () => {
    expect(getEstimateProgress(60, 61)?.isOverEstimate).toBe(true);
    // exactly at estimate is NOT over — "over," not "at."
    expect(getEstimateProgress(60, 60)?.isOverEstimate).toBe(false);
    expect(getEstimateProgress(60, 59)?.isOverEstimate).toBe(false);
  });

  it("test_AS_301_clamps_percent_to_100_even_when_far_over_estimate", () => {
    const result = getEstimateProgress(60, 600);
    expect(result?.percent).toBe(100);
    expect(result?.isOverEstimate).toBe(true);
  });

  it("test_AS_302_treats_a_negative_or_NaN_logged_total_as_zero", () => {
    expect(getEstimateProgress(60, -10)).toEqual({
      percent: 0,
      isOverEstimate: false,
    });
    expect(getEstimateProgress(60, Number.NaN)).toEqual({
      percent: 0,
      isOverEstimate: false,
    });
  });
});
