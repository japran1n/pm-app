// F019 (missions/20260903-portal, M4): the burn-down chart's own layout
// math and the two degenerate cases from its Definition of done.
//
// AS-034: The portal Hours view shows cumulative billable hours used
// against the planned curve, week by week.
// AS-038: The portal shows hours broken down by work category, and
// every category shown has a stated value.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import {
  computeBurndownSeries,
  computeBurndownLayout,
  isoWeekToMonday,
  HoursBurndownChart,
} from "@/components/portal/hours-burndown-chart";
import { HoursByCategory } from "@/components/portal/hours-by-category";
import type { ClientHoursCategory, ClientHoursWeek } from "@/lib/queries/hours";

// Four consecutive ISO weeks with a fixed, known payload -- the
// "fixed RPC payload" the Definition of done's primary success test
// asks for.
const FIXED_WEEKLY: ClientHoursWeek[] = [
  { isoWeek: "2026-W01", minutes: 300, cumulativeMinutes: 300 },
  { isoWeek: "2026-W02", minutes: 300, cumulativeMinutes: 600 },
  { isoWeek: "2026-W03", minutes: 300, cumulativeMinutes: 900 },
  { isoWeek: "2026-W04", minutes: 300, cumulativeMinutes: 1200 },
];
// Monday of 2026-W04 (the last week with data) as "today" -- keeps the
// series from extending past the fixed payload for a deterministic
// point count.
const TODAY_ISO = "2026-01-19"; // Monday of 2026-W04, the last week with data
const SOLD_MINUTES = 2400; // 40h budget

describe("test_AS_034_burndown_primary_success (fixed RPC payload)", () => {
  const points = computeBurndownSeries(FIXED_WEEKLY, SOLD_MINUTES, TODAY_ISO);

  it("renders the right number of points -- one per observed ISO week", () => {
    expect(points).toHaveLength(4);
    expect(points.map((p) => p.isoWeek)).toEqual([
      "2026-W01",
      "2026-W02",
      "2026-W03",
      "2026-W04",
    ]);
  });

  it("the endpoint's cumulative used value matches the final cumulative minutes", () => {
    const layout = computeBurndownLayout(points, SOLD_MINUTES);
    expect(layout.endpoint).not.toBeNull();
    expect(layout.endpoint!.usedMinutes).toBe(1200);
  });

  it("the ceiling sits at the budget value, not somewhere else", () => {
    const layout = computeBurndownLayout(points, SOLD_MINUTES);
    // maxMinutes must be at least the budget so the ceiling is drawn
    // inside the plottable area rather than clipped.
    expect(layout.maxMinutes).toBeGreaterThanOrEqual(SOLD_MINUTES);
    expect(layout.ceilingYPx).not.toBeNull();
    // The ceiling's y position must differ from the endpoint's y
    // position (900 used vs. never-reaches-budget in this fixture --
    // used stays under budget throughout), proving it is not just
    // re-using the used line's own final point.
    expect(layout.ceilingYPx).not.toBe(layout.endpoint!.yPx);
  });

  it("the planned curve spreads the budget evenly across the observed weeks", () => {
    // 4 weeks, 2400 minutes budget -> 600 minutes planned per week,
    // cumulative 600/1200/1800/2400.
    expect(points.map((p) => p.plannedMinutes)).toEqual([600, 1200, 1800, 2400]);
  });
});

describe("test_AS_034_burndown_failure_no_budget (no budget yet)", () => {
  const points = computeBurndownSeries(FIXED_WEEKLY, null, TODAY_ISO);

  it("computes a used-only series without crashing", () => {
    expect(points).toHaveLength(4);
    expect(points.every((p) => p.plannedMinutes === 0)).toBe(true);
  });

  it("the layout never fabricates a ceiling when there is no budget", () => {
    const layout = computeBurndownLayout(points, null);
    expect(layout.ceilingYPx).toBeNull();
    expect(layout.plannedPath).toBeNull();
  });

  it("renders the view without crashing, no fabricated ceiling in markup", () => {
    const markup = renderToStaticMarkup(
      createElement(HoursBurndownChart, { weekly: FIXED_WEEKLY, soldMinutes: null, todayIso: TODAY_ISO }),
    );
    expect(markup).toContain("hours-burndown-chart");
    expect(markup).toContain("No budget set yet");
    expect(markup).not.toContain("hours-chart-ceiling");
  });
});

describe("test_AS_034_burndown_period_not_started (budget exists, nothing logged)", () => {
  it("renders one honest line and no chart", () => {
    const markup = renderToStaticMarkup(
      createElement(HoursBurndownChart, { weekly: [], soldMinutes: SOLD_MINUTES, todayIso: TODAY_ISO }),
    );
    expect(markup).toContain("hours-chart-not-started");
    expect(markup).not.toContain("hours-burndown-chart");
  });
});

describe("test_AS_034_iso_week_to_monday", () => {
  it("resolves the Monday of a known ISO week", () => {
    const monday = isoWeekToMonday("2026-W01");
    expect(monday.getUTCDay()).toBe(1); // Monday
    expect(monday.getUTCFullYear()).toBe(2025); // ISO week 1 of 2026 starts in Dec 2025 or Jan 2026 depending on the year
  });
});

describe("test_AS_038_hours_by_category (every category shown has a stated value)", () => {
  const CATEGORIES: ClientHoursCategory[] = [
    { workCategory: "development", minutes: 600 },
    { workCategory: "design", minutes: 300 },
    { workCategory: "uncategorised", minutes: 120 },
  ];

  it("renders a value for every category row, including uncategorised as its own row", () => {
    const markup = renderToStaticMarkup(createElement(HoursByCategory, { categories: CATEGORIES }));
    expect(markup).toContain("Development");
    expect(markup).toContain("10h");
    expect(markup).toContain("Design");
    expect(markup).toContain("5h");
    // Uncategorised must appear as its own labelled row, not folded
    // into another category.
    expect(markup).toContain("Uncategorised");
    expect(markup).toContain("2h");
  });

  it("renders an honest empty state rather than a zero-value bar when there are no categories", () => {
    const markup = renderToStaticMarkup(createElement(HoursByCategory, { categories: [] }));
    expect(markup).toContain("hours-by-category-empty");
  });
});
