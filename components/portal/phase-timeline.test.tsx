// @vitest-environment jsdom
//
// F006 (missions/20260903-portal, AS-010): the overview's phase
// timeline. Covers this feature's own definition of done directly:
//   - primary success: a project with two phases in `active` renders
//     both as active simultaneously (AS-010's own assertion text).
//   - failure: a project with no phases renders no timeline and no
//     error.
//   - the layout math's own dateless-fallback rule (equal-width slots,
//     never zero width) is exercised directly on
//     `computePhaseTimelineLayout`, which is easier to assert precisely
//     than through rendered pixel positions.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import {
  PhaseTimeline,
  computePhaseTimelineLayout,
} from "@/components/portal/phase-timeline";
import type { PortalPhase } from "@/lib/queries/portal";

afterEach(() => {
  cleanup();
});

const TODAY = "2026-06-15";

function makePhase(overrides: Partial<PortalPhase> & { id: string; name: string }): PortalPhase {
  return {
    clientDescription: null,
    state: "not_started",
    plannedStart: null,
    plannedEnd: null,
    actualStart: null,
    actualEnd: null,
    position: 1,
    totalClientVisibleTasks: 0,
    doneClientVisibleTasks: 0,
    progressPercent: 0,
    ...overrides,
  };
}

describe("PhaseTimeline", () => {
  it("test_AS_010_primary_success_two_active_phases_render_simultaneously", () => {
    const phases: PortalPhase[] = [
      makePhase({
        id: "p1",
        name: "Struktura sajta",
        position: 1,
        state: "active",
        plannedStart: "2026-06-01",
        plannedEnd: "2026-06-20",
        progressPercent: 40,
      }),
      makePhase({
        id: "p2",
        name: "Vizuelni pravac",
        position: 2,
        state: "active",
        plannedStart: "2026-06-05",
        plannedEnd: "2026-06-25",
        progressPercent: 20,
      }),
      makePhase({
        id: "p3",
        name: "Dogovor i priprema",
        position: 0,
        state: "done",
        plannedStart: "2026-05-01",
        plannedEnd: "2026-05-31",
        progressPercent: 100,
      }),
    ];

    render(<PhaseTimeline phases={phases} today={TODAY} />);

    const rows = screen.getAllByTestId("phase-timeline-row");
    expect(rows).toHaveLength(3);

    const activeRows = rows.filter((row) => row.getAttribute("data-state") === "active");
    // Both active phases render as active AT THE SAME TIME -- this is
    // the assertion's own literal text: "shows more than one phase in
    // the active state simultaneously when more than one phase is
    // active."
    expect(activeRows).toHaveLength(2);
    expect(activeRows.map((row) => row.getAttribute("data-phase-id")).sort()).toEqual([
      "p1",
      "p2",
    ]);
  });

  it("test_AS_010_failure_a_project_with_no_phases_renders_no_timeline_and_no_error", () => {
    expect(() => render(<PhaseTimeline phases={[]} today={TODAY} />)).not.toThrow();
    expect(screen.queryByTestId("phase-timeline")).not.toBeInTheDocument();
  });

  it("renders the legend naming all four phase states", () => {
    render(
      <PhaseTimeline
        phases={[makePhase({ id: "p1", name: "Analiza", state: "active" })]}
        today={TODAY}
      />,
    );
    for (const label of ["Not started", "Active", "Blocked", "Done"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("shows a tooltip with the phase name, progress and its note on hover, one shared tooltip element", () => {
    const phases: PortalPhase[] = [
      makePhase({
        id: "p1",
        name: "Priprema materijala",
        state: "active",
        plannedStart: "2026-06-01",
        plannedEnd: "2026-06-10",
        progressPercent: 60,
        clientDescription: "Slike odobrene, sadržaj isporučen.",
      }),
      makePhase({
        id: "p2",
        name: "Izrada sajta",
        position: 2,
        state: "not_started",
        plannedStart: "2026-06-11",
        plannedEnd: "2026-06-30",
      }),
    ];
    render(<PhaseTimeline phases={phases} today={TODAY} />);

    expect(screen.queryByTestId("phase-timeline-tooltip")).not.toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByRole("button", { name: /Priprema materijala/ }));

    const tooltip = screen.getByTestId("phase-timeline-tooltip");
    expect(tooltip).toHaveTextContent("Priprema materijala");
    expect(tooltip).toHaveTextContent("60% complete");
    expect(tooltip).toHaveTextContent("Slike odobrene, sadržaj isporučen.");

    // Exactly one tooltip element exists for the whole chart, not one
    // per bar.
    expect(screen.getAllByTestId("phase-timeline-tooltip")).toHaveLength(1);

    fireEvent.mouseLeave(screen.getByRole("button", { name: /Priprema materijala/ }));
    expect(screen.queryByTestId("phase-timeline-tooltip")).not.toBeInTheDocument();
  });

  it("gives the timeline an accessible role=img summary of where the project is", () => {
    render(
      <PhaseTimeline
        phases={[
          makePhase({ id: "p1", name: "Analiza", state: "done", progressPercent: 100 }),
          makePhase({ id: "p2", name: "Struktura", state: "active", progressPercent: 30 }),
        ]}
        today={TODAY}
      />,
    );
    const chart = screen.getByTestId("phase-timeline");
    expect(chart).toHaveAttribute("role", "img");
    expect(chart.getAttribute("aria-label")).toContain("2 phases");
    expect(chart.getAttribute("aria-label")).toContain("Struktura");
  });
});

describe("computePhaseTimelineLayout — dateless fallback", () => {
  it("gives a phase missing planned dates an equal-width slot rather than collapsing to zero width", () => {
    const phases: PortalPhase[] = [
      makePhase({
        id: "dated",
        name: "Dated phase",
        position: 1,
        plannedStart: "2026-06-01",
        plannedEnd: "2026-06-15",
      }),
      makePhase({ id: "dateless-1", name: "Dateless one", position: 2 }),
      makePhase({ id: "dateless-2", name: "Dateless two", position: 3 }),
    ];

    const layout = computePhaseTimelineLayout(phases, TODAY);

    const datelessRows = layout.rows.filter((row) => row.fallback);
    expect(datelessRows).toHaveLength(2);
    for (const row of datelessRows) {
      expect(row.widthPx).toBeGreaterThan(0);
    }
    // The two dateless phases occupy distinct, non-overlapping slots.
    expect(datelessRows[0]!.xPx).not.toEqual(datelessRows[1]!.xPx);
  });

  it("falls back every phase to an equal-width slot when NO phase has planned dates", () => {
    const phases: PortalPhase[] = [
      makePhase({ id: "a", name: "A", position: 1 }),
      makePhase({ id: "b", name: "B", position: 2 }),
    ];

    const layout = computePhaseTimelineLayout(phases, TODAY);

    expect(layout.rows.every((row) => row.fallback)).toBe(true);
    expect(layout.rows.every((row) => row.widthPx > 0)).toBe(true);
    expect(layout.todayXPx).toBeNull();
    expect(layout.weekMarks).toEqual([]);
  });

  it("places the today rule inside the drawn range even when today is before every planned date", () => {
    const phases: PortalPhase[] = [
      makePhase({
        id: "future",
        name: "Future phase",
        plannedStart: "2026-08-01",
        plannedEnd: "2026-08-15",
      }),
    ];

    const layout = computePhaseTimelineLayout(phases, TODAY);

    expect(layout.todayXPx).not.toBeNull();
    expect(layout.todayXPx!).toBeGreaterThanOrEqual(0);
    expect(layout.todayXPx!).toBeLessThanOrEqual(layout.chartWidthPx);
  });
});
