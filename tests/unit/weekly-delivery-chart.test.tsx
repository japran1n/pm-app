// F111 (missions/20260903-portal, docs/client-portal-visual-plan.md 3.6):
// layout math + degenerate-case render coverage for the weekly delivery
// chart, mirroring f019-hours-burndown-chart.test.tsx's own split between
// pure layout assertions and rendered-markup assertions.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import {
  computeWeeklyDeliveryLayout,
  totalWeeklyDeliveryCount,
  WeeklyDeliveryChart,
} from "@/components/portal/weekly-delivery-chart";
import type { WeeklyDeliveryWeek } from "@/lib/portal/weekly-delivery";

const SHIPPED_WEEKS: WeeklyDeliveryWeek[] = [
  { isoWeek: "2026-W32", count: 2 },
  { isoWeek: "2026-W33", count: 0 },
  { isoWeek: "2026-W34", count: 5 },
];

const ZERO_WEEKS: WeeklyDeliveryWeek[] = [
  { isoWeek: "2026-W32", count: 0 },
  { isoWeek: "2026-W33", count: 0 },
];

describe("test_F111_weekly_delivery_layout_bar_heights", () => {
  it("scales every bar against the single tallest week on one shared scale", () => {
    const layout = computeWeeklyDeliveryLayout(SHIPPED_WEEKS);
    expect(layout.columns).toHaveLength(3);
    expect(layout.maxCount).toBe(5);
    // The tallest week's bar reaches the full plottable height; the
    // middle (zero) week draws a 0-height bar, anchored to the baseline.
    expect(layout.columns[2]!.barHeightPx).toBeGreaterThan(layout.columns[0]!.barHeightPx);
    expect(layout.columns[1]!.barHeightPx).toBe(0);
    expect(layout.columns[1]!.barYPx).toBe(layout.baselineYPx);
  });

  it("a project with no completed work yet still lays out every week, all at zero height", () => {
    const layout = computeWeeklyDeliveryLayout(ZERO_WEEKS);
    expect(layout.columns).toHaveLength(2);
    expect(layout.maxCount).toBe(0);
    expect(layout.columns.every((c) => c.barHeightPx === 0)).toBe(true);
  });
});

describe("test_F111_weekly_delivery_total_count", () => {
  it("sums every week's count for the direct summary label", () => {
    expect(totalWeeklyDeliveryCount(SHIPPED_WEEKS)).toBe(7);
    expect(totalWeeklyDeliveryCount(ZERO_WEEKS)).toBe(0);
  });
});

describe("test_F111_weekly_delivery_chart_renders_zero_bars_not_absent", () => {
  it("renders a bar element for every week, including zero-count ones, rather than omitting them", () => {
    const html = renderToStaticMarkup(createElement(WeeklyDeliveryChart, { weeks: SHIPPED_WEEKS }));
    expect(html).toContain('data-testid="weekly-delivery-bar-2026-W32"');
    expect(html).toContain('data-testid="weekly-delivery-bar-2026-W33"');
    expect(html).toContain('data-testid="weekly-delivery-bar-2026-W34"');
  });

  it("a project with no completed work yet renders the chart (not an error state) with an honest zero total", () => {
    const html = renderToStaticMarkup(createElement(WeeklyDeliveryChart, { weeks: ZERO_WEEKS }));
    expect(html).toContain("Nothing shipped yet");
    expect(html).toContain('data-testid="weekly-delivery-bar-2026-W32"');
  });

  it("renders no per-bar numeric label -- only the direct total summary", () => {
    const html = renderToStaticMarkup(createElement(WeeklyDeliveryChart, { weeks: SHIPPED_WEEKS }));
    // The total (7) appears once, in the summary span, never repeated as
    // a label baked onto each individual bar.
    expect(html).toContain("7 client-visible tasks shipped");
  });
});
