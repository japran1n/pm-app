// @vitest-environment jsdom
//
// F087 accessibility/perf audit fixes.
//
// Item 1: components/portal/phase-timeline.tsx and
// components/portal/hours-burndown-chart.tsx wrapped their whole chart
// (including the focusable, per-row/per-week `role="button"` elements
// with their own accessible names) in `role="img"` -- ARIA flattens a
// `role="img"` subtree into a single presentational image, so those
// focusable rows were unreachable by Tab and unannounced by name. Fixed
// by changing the wrapper to `role="group"` (keeps the same
// `aria-label` summary, but no longer hides focusable descendants).
//
// Item 2 (timeline-bar-draggable's resize-handle keyboard fix) covered
// the now-removed Timeline feature (dedicated feature request) -- that
// coverage was dropped from this file along with the deleted components.

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { PhaseTimeline } from "@/components/portal/phase-timeline";
import { HoursBurndownChart } from "@/components/portal/hours-burndown-chart";
import type { PortalPhase } from "@/lib/queries/portal";

afterEach(cleanup);

function makePhase(overrides: Partial<PortalPhase> = {}): PortalPhase {
  return {
    id: "phase-1",
    name: "Design",
    position: 1,
    state: "active",
    plannedStart: "2026-06-01",
    plannedEnd: "2026-06-14",
    actualStart: null,
    actualEnd: null,
    clientDescription: null,
    totalClientVisibleTasks: 4,
    doneClientVisibleTasks: 1,
    progressPercent: 25,
    inFlightTaskTitle: null,
    blockedReason: null,
    ...overrides,
  };
}

describe("test_phase_timeline_focusable_rows_are_not_hidden_by_role_img", () => {
  it("wraps the chart in role=group (not role=img), which would hide focusable descendants", () => {
    render(<PhaseTimeline phases={[makePhase()]} today="2026-06-05" />);
    const chart = screen.getByTestId("phase-timeline");
    expect(chart).toHaveAttribute("role", "group");
    expect(chart).not.toHaveAttribute("role", "img");
  });

  it("each phase row is reachable as a named, focusable button inside the chart", () => {
    render(
      <PhaseTimeline
        phases={[makePhase({ id: "p1", name: "Design" }), makePhase({ id: "p2", name: "Build" })]}
        today="2026-06-05"
      />,
    );
    const chart = screen.getByTestId("phase-timeline");
    const row = within(chart).getByRole("button", { name: /Design/ });
    expect(row).toHaveAttribute("tabindex", "0");
    row.focus();
    expect(row).toHaveFocus();
  });
});

describe("test_hours_burndown_chart_focusable_columns_are_not_hidden_by_role_img", () => {
  it("wraps the chart in role=group (not role=img)", () => {
    render(
      <HoursBurndownChart
        weekly={[{ isoWeek: "2026-W23", minutes: 300, cumulativeMinutes: 300 }]}
        soldMinutes={1200}
        todayIso="2026-06-08"
      />,
    );
    const chart = screen.getByTestId("hours-burndown-chart");
    expect(chart).toHaveAttribute("role", "group");
    expect(chart).not.toHaveAttribute("role", "img");
  });
});
