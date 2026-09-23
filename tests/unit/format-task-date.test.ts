import { describe, expect, it } from "vitest";

import { formatTaskDate } from "@/lib/format";

describe("formatTaskDate (TT-002, TT-003, TT-004)", () => {
  it("test_TT_002_null_due_date_renders_No_due_date", () => {
    expect(formatTaskDate(null)).toBe("No due date");
  });

  it("test_TT_002_valid_date_renders_en_GB_day_month_year_short_month", () => {
    expect(formatTaskDate("2026-09-11")).toBe("11 Sep 2026");
  });

  it("test_TT_002_never_renders_the_en_US_Sep_14_2026_shape", () => {
    // TT-003: no surface should still be producing the retired en-US
    // "Sep 14, 2026" string once it's routed through formatTaskDate.
    const result = formatTaskDate("2026-09-14");
    expect(result).toBe("14 Sep 2026");
    expect(result).not.toMatch(/^[A-Za-z]{3} \d{1,2}, \d{4}$/);
    expect(result).not.toContain(",");
  });

  it("test_TT_002_is_timezone_stable_for_a_date_only_value", () => {
    // due_date has no time component — the same stored calendar date
    // must render identically regardless of which zone formats it,
    // exactly like its sibling formatDueDate (AS-207).
    const expected = "20 Aug 2026";
    expect(formatTaskDate("2026-08-20", "UTC")).toBe(expected);
    expect(formatTaskDate("2026-08-20", "America/New_York")).toBe(expected);
    expect(formatTaskDate("2026-08-20", "America/Los_Angeles")).toBe(
      expected,
    );
    expect(formatTaskDate("2026-08-20", "Asia/Tokyo")).toBe(expected);
  });

  it("test_TT_002_malformed_date_or_unrecognized_timezone_falls_back_to_the_raw_string", () => {
    expect(formatTaskDate("not-a-date", "UTC")).toBe("not-a-date");
    expect(formatTaskDate("2026-08-20", "Not/A_Real_Zone")).toBe(
      "2026-08-20",
    );
  });

  it("test_TT_004_string_output_alone_carries_no_colour_the_caller_decides_overdue_styling", () => {
    // TT-004 (destructive colour for overdue) is a UI/class-name concern
    // owned by the components that call isOverdueInTimeZone; this
    // formatter's job ends at producing the plain date string, which
    // must be identical whether or not the date is overdue.
    const overdueDate = formatTaskDate("2020-01-01", "UTC");
    const futureDate = formatTaskDate("2099-01-01", "UTC");
    expect(overdueDate).toBe("1 Jan 2020");
    expect(futureDate).toBe("1 Jan 2099");
    expect(overdueDate).not.toContain("destructive");
    expect(futureDate).not.toContain("destructive");
  });
});
