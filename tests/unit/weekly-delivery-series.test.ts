// F111 (missions/20260903-portal, docs/client-portal-visual-plan.md 3.6):
// pure series-math coverage for computeWeeklyDeliverySeries -- no
// Supabase, no DOM. See lib/portal/weekly-delivery.ts's own header for
// the full definition this function implements.

import { describe, expect, it } from "vitest";
import { computeWeeklyDeliverySeries } from "@/lib/portal/weekly-delivery";

describe("test_F111_weekly_delivery_series_project_span_not_trailing_window", () => {
  it("spans exactly the project's own weeks, not a fixed trailing window", () => {
    // Project started 2026-08-03 (a Monday), today is 2026-08-24 -- a
    // four-week-old project. A fixed trailing window (e.g. 12 weeks)
    // would show eight empty weeks before the project existed.
    const weeks = computeWeeklyDeliverySeries([], "2026-08-03", "2026-08-24");
    expect(weeks).toHaveLength(4);
    expect(weeks[0]!.isoWeek).toBe("2026-W32");
    expect(weeks[weeks.length - 1]!.isoWeek).toBe("2026-W35");
  });

  it("a project a week old shows exactly one week, not a padded range", () => {
    // 2026-08-17 (start) and 2026-08-20 (today) both fall in ISO week
    // 2026-W34.
    const weeks = computeWeeklyDeliverySeries([], "2026-08-17", "2026-08-20");
    expect(weeks).toHaveLength(1);
    expect(weeks[0]!.count).toBe(0);
  });
});

describe("test_F111_weekly_delivery_series_no_completed_work_reads_as_zero", () => {
  it("returns every span week at count 0, never an empty series, when nothing has completed", () => {
    const weeks = computeWeeklyDeliverySeries([], "2026-08-03", "2026-08-24");
    expect(weeks.length).toBeGreaterThan(0);
    expect(weeks.every((w) => w.count === 0)).toBe(true);
  });
});

describe("test_F111_weekly_delivery_series_empty_week_amid_shipped_weeks", () => {
  it("a week with nothing shipped stays a real zero-count entry between two shipped weeks", () => {
    const weeks = computeWeeklyDeliverySeries(
      ["2026-08-05", "2026-08-19"],
      "2026-08-03",
      "2026-08-24",
    );
    expect(weeks.map((w) => w.count)).toEqual([1, 0, 1, 0]);
  });
});

describe("test_F111_weekly_delivery_series_counts_multiple_completions_same_week", () => {
  it("sums more than one completion landing in the same week", () => {
    const weeks = computeWeeklyDeliverySeries(
      ["2026-08-04", "2026-08-06", "2026-08-07"],
      "2026-08-03",
      "2026-08-10",
    );
    expect(weeks).toHaveLength(2);
    expect(weeks[0]!.count).toBe(3);
    expect(weeks[1]!.count).toBe(0);
  });
});

describe("test_F111_weekly_delivery_series_clamps_out_of_span_dates", () => {
  it("clamps a completion recorded before the project's own start into the first week rather than extending the range", () => {
    const weeks = computeWeeklyDeliverySeries(
      ["2026-07-20"],
      "2026-08-03",
      "2026-08-10",
    );
    expect(weeks).toHaveLength(2);
    expect(weeks[0]!.isoWeek).toBe("2026-W32");
    expect(weeks[0]!.count).toBe(1);
  });

  it("clamps a completion recorded after today into the last week rather than extending the range", () => {
    const weeks = computeWeeklyDeliverySeries(
      ["2026-09-01"],
      "2026-08-03",
      "2026-08-10",
    );
    expect(weeks).toHaveLength(2);
    expect(weeks[weeks.length - 1]!.count).toBe(1);
  });
});
