import { describe, it, expect } from "vitest";
import { computeTimeLeft, resolveDueDate } from "@/lib/projects/time-left";

const now = new Date("2026-01-30T15:00:00Z");
describe("computeTimeLeft", () => {
  it("test_PL_014_null", () => {
    expect(computeTimeLeft(null, now)).toBeNull();
    expect(computeTimeLeft(undefined, now)).toBeNull();
  });
  it("test_PL_014_today", () => expect(computeTimeLeft("2026-01-30", now)).toBe("Due today"));
  it("test_PL_014_days_singular_plural", () => {
    expect(computeTimeLeft("2026-01-31", now)).toBe("1 day left");
    expect(computeTimeLeft("2026-02-12", now)).toBe("13 days left");
  });
  it("test_PL_014_weeks_floor", () => {
    expect(computeTimeLeft("2026-02-13", now)).toBe("2 weeks left");
    expect(computeTimeLeft("2026-02-19", now)).toBe("2 weeks left");
    expect(computeTimeLeft("2026-02-20", now)).toBe("3 weeks left");
  });
  it("test_PL_014_overdue", () => {
    expect(computeTimeLeft("2026-01-29", now)).toBe("1 day overdue");
    expect(computeTimeLeft("2026-01-25", now)).toBe("5 days overdue");
  });
  it("test_PL_014_month_year_boundaries", () => {
    expect(computeTimeLeft("2026-02-01", now)).toBe("2 days left");
    expect(computeTimeLeft("2027-01-01", new Date("2026-12-31T23:00:00Z"))).toBe("1 day left");
    expect(computeTimeLeft("2025-12-31", new Date("2026-01-01T00:30:00Z"))).toBe("1 day overdue");
  });
});
describe("resolveDueDate", () => {
  it("test_PL_015_precedence", () => {
    expect(resolveDueDate({ end_date: "a", target_launch_date: "b" })).toBe("a");
    expect(resolveDueDate({ end_date: null, target_launch_date: "b" })).toBe("b");
    expect(resolveDueDate({ end_date: null, target_launch_date: null })).toBeNull();
    expect(resolveDueDate({})).toBeNull();
  });
});
