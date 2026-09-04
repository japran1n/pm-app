// @vitest-environment jsdom
//
// F021 (missions/20260903-portal, AS-041, AS-042): covers this feature's
// own definition of done directly:
//   - primary success: a `direction = 'lower'` metric whose "Now" is
//     lower than its baseline renders as an improvement (done token); the
//     SAME raw numbers on a `direction = 'higher'` metric render as a
//     regression (blocked token) -- this is the exact "direction decides
//     what counts as improvement" rule the feature spec is written
//     around, tested against the derived status this component renders,
//     not against the component's own internals.
//   - failure: a metric with no snapshot renders the not-measured
//     treatment ("not measured yet") and no bar chart at all.
//   - side-effect: no fabricated value anywhere -- a metric with a
//     snapshot but no baseline (can't happen once frozen, but the type
//     allows it) also gets the not-measured treatment, never a bar drawn
//     against a missing baseline.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import {
  MetricComparisonCard,
  computeMetricBarLayout,
} from "@/components/portal/metric-comparison-card";
import { deriveMetricMeasurementStatus } from "@/lib/queries/metrics";
import type { MetricSnapshot, ProjectMetric } from "@/lib/queries/metrics";

afterEach(() => {
  cleanup();
});

function makeMetric(overrides: Partial<ProjectMetric> & { id: string }): ProjectMetric {
  return {
    projectId: "proj-1",
    name: "Organic sessions",
    unit: null,
    source: "ga4",
    baselineValue: 100,
    baselineAt: "2026-01-01",
    targetValue: 150,
    direction: "higher",
    displayMax: null,
    clientVisible: true,
    position: 1,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<MetricSnapshot> & { id: string; metricId: string }): MetricSnapshot {
  return {
    value: 100,
    measuredAt: "2026-02-01",
    note: null,
    createdBy: "user-1",
    createdAt: "2026-02-01T00:00:00Z",
    ...overrides,
  };
}

describe("MetricComparisonCard", () => {
  it("test_AS_041_primary_success_lower_metric_lower_now_is_improvement_higher_metric_same_numbers_is_regression", () => {
    // Same raw baseline (100) -> now (60): a smaller "Now" is an
    // improvement for a `lower` metric (e.g. bounce rate) ...
    const lowerMetric = makeMetric({ id: "m-lower", direction: "lower", baselineValue: 100 });
    const lowerSnapshot = makeSnapshot({ id: "s-lower", metricId: "m-lower", value: 60 });
    const lowerStatus = deriveMetricMeasurementStatus(lowerMetric, lowerSnapshot);
    expect(lowerStatus).toBe("improved");

    render(
      <MetricComparisonCard metric={lowerMetric} latestSnapshot={lowerSnapshot} status={lowerStatus} />,
    );
    expect(screen.getByTestId("metric-status-label")).toHaveTextContent("Improved");

    cleanup();

    // ... but a regression for a `higher` metric (e.g. sessions) with the
    // exact same before/after numbers.
    const higherMetric = makeMetric({ id: "m-higher", direction: "higher", baselineValue: 100 });
    const higherSnapshot = makeSnapshot({ id: "s-higher", metricId: "m-higher", value: 60 });
    const higherStatus = deriveMetricMeasurementStatus(higherMetric, higherSnapshot);
    expect(higherStatus).toBe("regressed");

    render(
      <MetricComparisonCard metric={higherMetric} latestSnapshot={higherSnapshot} status={higherStatus} />,
    );
    expect(screen.getByTestId("metric-status-label")).toHaveTextContent("Regressed");
  });

  it("test_AS_041_failure_metric_with_no_snapshot_renders_not_measured_and_no_bar", () => {
    const metric = makeMetric({ id: "m-unmeasured" });
    const status = deriveMetricMeasurementStatus(metric, null);
    expect(status).toBe("not_measured");

    render(<MetricComparisonCard metric={metric} latestSnapshot={null} status={status} />);

    expect(screen.getByTestId("metric-not-measured")).toHaveTextContent("Not measured yet");
    expect(screen.queryByTestId("metric-bar-chart")).not.toBeInTheDocument();
    // Never a zero bar and never an em dash standing in for a value.
    expect(screen.queryByText("—")).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("test_AS_041_side_effect_snapshot_without_baseline_also_renders_not_measured", () => {
    const metric = makeMetric({ id: "m-no-baseline", baselineValue: null });
    const snapshot = makeSnapshot({ id: "s-1", metricId: "m-no-baseline", value: 42 });
    const status = deriveMetricMeasurementStatus(metric, snapshot);
    expect(status).toBe("not_measured");

    render(<MetricComparisonCard metric={metric} latestSnapshot={snapshot} status={status} />);

    expect(screen.getByTestId("metric-not-measured")).toBeInTheDocument();
    expect(screen.queryByTestId("metric-bar-chart")).not.toBeInTheDocument();
  });

  it("test_AS_042_renders_before_now_and_target_as_a_bar_chart_with_target_tick", () => {
    const metric = makeMetric({ id: "m-1", direction: "higher", baselineValue: 100, targetValue: 150 });
    const snapshot = makeSnapshot({ id: "s-1", metricId: "m-1", value: 120 });
    const status = deriveMetricMeasurementStatus(metric, snapshot);

    render(<MetricComparisonCard metric={metric} latestSnapshot={snapshot} status={status} />);

    const chart = screen.getByTestId("metric-bar-chart");
    expect(chart).toHaveAttribute("role", "img");
    expect(chart.getAttribute("aria-label")).toContain("before 100");
    expect(chart.getAttribute("aria-label")).toContain("now 120");
    expect(chart.getAttribute("aria-label")).toContain("target 150");
    expect(screen.getByTestId("metric-target-tick")).toBeInTheDocument();
  });

  it("F021c: a snapshot measured before the baseline was set also renders not_measured, never improved", () => {
    const metric = makeMetric({ id: "m-pre-baseline", direction: "lower", baselineValue: 4200, baselineAt: "2026-03-01" });
    const snapshot = makeSnapshot({ id: "s-1", metricId: "m-pre-baseline", value: 2000, measuredAt: "2026-01-15" });
    const status = deriveMetricMeasurementStatus(metric, snapshot);
    expect(status).toBe("not_measured");

    render(<MetricComparisonCard metric={metric} latestSnapshot={snapshot} status={status} />);
    expect(screen.getByTestId("metric-status-label")).toHaveTextContent("Not yet measured");
    expect(screen.queryByTestId("metric-bar-chart")).not.toBeInTheDocument();
  });

  describe("computeMetricBarLayout", () => {
    it("positions the target tick proportionally to the scale, never off the chart", () => {
      const layout = computeMetricBarLayout(100, 120, 150, null);
      expect(layout.targetXPx).not.toBeNull();
      expect(layout.targetXPx!).toBeGreaterThan(0);
      expect(layout.targetXPx!).toBeLessThanOrEqual(layout.chartWidthPx);
      expect(layout.nowWidthPx).toBeGreaterThan(layout.beforeWidthPx);
    });

    it("omits the target tick when there is no target", () => {
      const layout = computeMetricBarLayout(100, 120, null, null);
      expect(layout.targetXPx).toBeNull();
    });

    it("clamps bar widths to the chart width even when a value exceeds displayMax", () => {
      const layout = computeMetricBarLayout(100, 500, 200, 200);
      expect(layout.nowWidthPx).toBe(layout.chartWidthPx);
    });
  });
});
