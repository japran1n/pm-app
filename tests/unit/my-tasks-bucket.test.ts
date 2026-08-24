// Unit tests for F230's pure bucketing logic (AS-436).

import { describe, expect, it } from "vitest";

import { bucketForDueDate } from "@/lib/my-tasks/bucket";

const TZ = "America/New_York";

describe("F230 bucketForDueDate (AS-436)", () => {
  it("test_AS_436_no_due_date_goes_to_later", () => {
    const instant = new Date("2026-08-24T12:00:00Z"); // Monday
    expect(bucketForDueDate(null, TZ, instant)).toBe("later");
  });

  it("test_AS_436_past_due_date_is_overdue", () => {
    const instant = new Date("2026-08-24T12:00:00Z"); // Monday, ET still Monday
    expect(bucketForDueDate("2026-08-20", TZ, instant)).toBe("overdue");
  });

  it("test_AS_436_due_date_equal_to_today_is_today", () => {
    const instant = new Date("2026-08-24T12:00:00Z"); // 08:00 ET Monday
    expect(bucketForDueDate("2026-08-24", TZ, instant)).toBe("today");
  });

  it("test_AS_436_due_date_later_this_iso_week_is_thisWeek", () => {
    // Monday 2026-08-24 (ET); ISO week runs through Sunday 2026-08-30.
    const instant = new Date("2026-08-24T12:00:00Z");
    expect(bucketForDueDate("2026-08-27", TZ, instant)).toBe("thisWeek");
    expect(bucketForDueDate("2026-08-30", TZ, instant)).toBe("thisWeek");
  });

  it("test_AS_436_due_date_beyond_this_week_is_later", () => {
    const instant = new Date("2026-08-24T12:00:00Z");
    expect(bucketForDueDate("2026-08-31", TZ, instant)).toBe("later");
  });

  it("test_AS_436_bucketing_respects_the_callers_timezone", () => {
    // 2026-08-24T02:30:00Z is still 2026-08-23 22:30 in America/New_York
    // (UTC-4 in August, DST) -- "today" for this caller is the 23rd, not
    // the 24th UTC would suggest, so a due date of 2026-08-24 is NOT yet
    // "today" for them.
    // 2026-08-23 is a Sunday -- the last day of its own ISO (Monday-start)
    // week, so the very next calendar day (the 24th) falls into next
    // week, i.e. "later" for this caller, even though 2026-08-24T02:30:00Z
    // is already "the 24th" in UTC.
    const instant = new Date("2026-08-24T02:30:00Z");
    expect(bucketForDueDate("2026-08-23", TZ, instant)).toBe("today");
    expect(bucketForDueDate("2026-08-24", TZ, instant)).toBe("later");
  });

  it("test_AS_436_invalid_timezone_degrades_to_later_never_throws", () => {
    const instant = new Date("2026-08-24T12:00:00Z");
    expect(() =>
      bucketForDueDate("2026-08-24", "Not/AZone", instant),
    ).not.toThrow();
    expect(bucketForDueDate("2026-08-24", "Not/AZone", instant)).toBe("later");
  });
});
