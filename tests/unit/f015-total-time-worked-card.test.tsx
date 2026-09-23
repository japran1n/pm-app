// F015 (missions/20260923-180648, M4): "Total time worked" card -- total
// for the range, % delta vs the previous range, hand-rolled SVG area
// chart, footer with period start + grand total, and a no-NaN empty
// state.
//
// TT-032: "Total time worked" card: total for range, % delta vs previous
// range, SVG area chart, hover/point marker, footer with range start and
// grand total.
// TT-033: Card has empty state with no data and no NaN/Infinity.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { TeamHoursView } from "@/components/project/team-hours-view";
import type { TeamHoursEntry } from "@/lib/queries/hours";
import type { ProjectBudget } from "@/lib/queries/project-budgets";
import { computeAreaChartLayout, computePercentDelta } from "@/lib/hours/area-chart-layout";

const ENTRIES: TeamHoursEntry[] = [
  {
    entryId: "e1",
    userId: "u1",
    taskId: "t1",
    taskTitle: "Task one",
    minutes: 120,
    billable: true,
    entryDate: "2026-09-01",
    workCategory: "development",
  } as TeamHoursEntry,
  {
    entryId: "e2",
    userId: "u2",
    taskId: "t2",
    taskTitle: "Task two",
    minutes: 60,
    billable: false,
    entryDate: "2026-09-03",
    workCategory: "qa",
  } as TeamHoursEntry,
];

const PEOPLE: Record<string, string> = { u1: "Alice", u2: "Bob" };

const BUDGET: ProjectBudget = { soldMinutes: 600 } as ProjectBudget;

describe("test_TT_032_total_time_worked_card_with_data", () => {
  const html = renderToStaticMarkup(
    createElement(TeamHoursView, {
      entries: ENTRIES,
      people: PEOPLE,
      budget: BUDGET,
      canManage: false,
      periodStart: "2026-09-01",
      previousPeriodMinutes: 150,
    }),
  );

  it("renders the card with the grand total (180m = 3 hr)", () => {
    expect(html).toContain('data-testid="hours-total-time-worked"');
    expect(html).toContain("Total time worked");
    expect(html).toContain("3 hr");
  });

  it("renders a % delta badge vs the previous period ((180-150)/150 = +20%)", () => {
    expect(html).toContain('data-testid="hours-total-time-delta"');
    expect(html).toContain("+20%");
  });

  it("renders the SVG area chart with a marker at the last point", () => {
    expect(html).toContain('data-testid="hours-total-time-chart"');
    expect(html).toContain('data-testid="hours-total-time-marker"');
    expect(html).toContain("<circle");
    expect(html).toContain("<path");
  });

  it("renders a footer with the period start date and grand total", () => {
    expect(html).toContain("1 Sep 2026");
    expect(html).toContain("3 hr");
  });
});

describe("test_TT_032_total_time_worked_negative_delta", () => {
  const html = renderToStaticMarkup(
    createElement(TeamHoursView, {
      entries: ENTRIES,
      people: PEOPLE,
      budget: BUDGET,
      canManage: false,
      periodStart: "2026-09-01",
      previousPeriodMinutes: 300,
    }),
  );

  it("renders a negative % delta badge ((180-300)/300 = -40%)", () => {
    expect(html).toContain('data-testid="hours-total-time-delta"');
    expect(html).toContain("-40%");
  });
});

describe("test_TT_032_total_time_worked_no_previous_period", () => {
  const html = renderToStaticMarkup(
    createElement(TeamHoursView, {
      entries: ENTRIES,
      people: PEOPLE,
      budget: BUDGET,
      canManage: false,
      periodStart: "2026-09-01",
      previousPeriodMinutes: null,
    }),
  );

  it("omits the delta badge entirely when there is no previous-period data", () => {
    expect(html).not.toContain('data-testid="hours-total-time-delta"');
  });
});

describe("test_TT_033_total_time_worked_empty_state", () => {
  const html = renderToStaticMarkup(
    createElement(TeamHoursView, {
      entries: [],
      people: {},
      budget: null,
      canManage: false,
    }),
  );

  it("shows the empty-state message and no chart when there is no data logged", () => {
    expect(html).toContain('data-testid="hours-total-time-empty"');
    expect(html).toContain("No time logged in this period");
    expect(html).not.toContain('data-testid="hours-total-time-chart"');
  });

  it("never renders NaN or Infinity in the empty state", () => {
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });
});

describe("test_TT_033_area_chart_layout_no_nan", () => {
  it("produces a valid layout for an empty series", () => {
    const layout = computeAreaChartLayout([]);
    expect(layout.lastPoint).toBeNull();
    expect(layout.linePath).toBe("");
    expect(layout.areaPath).toBe("");
  });

  it("produces a valid layout for a single flat point (no divide-by-zero)", () => {
    const layout = computeAreaChartLayout([{ date: "2026-09-01", minutes: 0 }]);
    expect(layout.lastPoint).not.toBeNull();
    expect(Number.isNaN(layout.lastPoint!.x)).toBe(false);
    expect(Number.isNaN(layout.lastPoint!.y)).toBe(false);
    expect(Number.isFinite(layout.lastPoint!.x)).toBe(true);
    expect(Number.isFinite(layout.lastPoint!.y)).toBe(true);
  });

  it("produces a smooth cubic-bezier path for a multi-point series", () => {
    const layout = computeAreaChartLayout([
      { date: "2026-09-01", minutes: 60 },
      { date: "2026-09-02", minutes: 120 },
      { date: "2026-09-03", minutes: 30 },
    ]);
    expect(layout.linePath).toMatch(/^M[\d.]+,[\d.]+( C[\d.]+,[\d.]+ [\d.]+,[\d.]+ [\d.]+,[\d.]+)+$/);
    expect(layout.areaPath).toContain("Z");
    expect(layout.lastPoint).not.toBeNull();
  });

  it("computePercentDelta returns null (no fabricated 0%) when there is no or zero previous data", () => {
    expect(computePercentDelta(100, null)).toBeNull();
    expect(computePercentDelta(100, 0)).toBeNull();
  });

  it("computePercentDelta never returns NaN/Infinity for real inputs", () => {
    const delta = computePercentDelta(180, 150);
    expect(delta).not.toBeNull();
    expect(Number.isFinite(delta!)).toBe(true);
  });
});
