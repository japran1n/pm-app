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
    inFlightTaskTitle: null,
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
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
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
        totalClientVisibleTasks: 5,
        doneClientVisibleTasks: 3,
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
    expect(tooltip).toHaveTextContent("3 of 5 done");
    expect(tooltip).toHaveTextContent("Slike odobrene, sadržaj isporučen.");

    // Exactly one tooltip element exists for the whole chart, not one
    // per bar.
    expect(screen.getAllByTestId("phase-timeline-tooltip")).toHaveLength(1);

    fireEvent.mouseLeave(screen.getByRole("button", { name: /Priprema materijala/ }));
    expect(screen.queryByTestId("phase-timeline-tooltip")).not.toBeInTheDocument();
  });

  it("test_AS_011_a_done_phase_with_completed_tasks_shows_a_count_not_a_percentage", () => {
    render(
      <PhaseTimeline
        phases={[
          makePhase({
            id: "p1",
            name: "Dogovor i priprema",
            state: "done",
            plannedStart: "2026-05-01",
            plannedEnd: "2026-05-31",
            totalClientVisibleTasks: 4,
            doneClientVisibleTasks: 4,
            progressPercent: 100,
          }),
        ]}
        today={TODAY}
      />,
    );

    // Never a bare percentage: a client reading "Done · 100%" and "Done
    // · 4 of 4 done" both mean the phase finished, but only the count
    // exposes the denominator.
    expect(screen.getByText(/Done · .*4 of 4 done/)).toBeInTheDocument();
    expect(screen.queryByText(/100%/)).not.toBeInTheDocument();

    const row = screen.getByRole("button", { name: /Dogovor i priprema/ });
    expect(row).toHaveAttribute("aria-label", expect.stringContaining("4 of 4 done"));
    expect(row.getAttribute("aria-label")).not.toContain("%");
  });

  it("test_AS_011_a_done_phase_with_zero_client_visible_tasks_shows_the_state_alone_never_0_percent", () => {
    render(
      <PhaseTimeline
        phases={[
          makePhase({
            id: "p1",
            name: "Kick-off & setup",
            state: "done",
            totalClientVisibleTasks: 0,
            doneClientVisibleTasks: 0,
            progressPercent: 0,
          }),
        ]}
        today={TODAY}
      />,
    );

    // The empty case: nothing client-visible to count. The row must say
    // "Done" alone -- never "Done · 0%", which reads as "finished, zero
    // percent complete" and is self-contradictory.
    const rowLabel = screen.getByTestId("phase-timeline-row-label");
    expect(rowLabel).toHaveTextContent("Done");
    expect(rowLabel.textContent).not.toContain("%");
    expect(rowLabel.textContent).not.toContain("of 0 done");

    const row = screen.getByRole("button", { name: /Kick-off & setup/ });
    expect(row).toHaveAttribute("aria-label", expect.stringContaining("Done"));
    expect(row.getAttribute("aria-label")).not.toContain("%");
    expect(row.getAttribute("aria-label")).not.toContain("of 0 done");

    fireEvent.mouseEnter(row);
    const tooltip = screen.getByTestId("phase-timeline-tooltip");
    expect(tooltip).toHaveTextContent("Done");
    expect(tooltip).not.toHaveTextContent("%");
  });

  it("shows each row's planned date range on the row itself, not only on hover", () => {
    render(
      <PhaseTimeline
        phases={[
          makePhase({
            id: "p1",
            name: "Visual direction & design",
            state: "active",
            plannedStart: "2026-08-28",
            plannedEnd: "2026-09-11",
            totalClientVisibleTasks: 7,
            doneClientVisibleTasks: 4,
            progressPercent: 57,
          }),
        ]}
        today={TODAY}
      />,
    );

    expect(screen.getByText(/28 Aug/)).toBeInTheDocument();
    expect(screen.getByText(/11 Sep/)).toBeInTheDocument();
  });

  it("gives the timeline an accessible role=group summary of where the project is", () => {
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
    // role="group" rather than role="img": the timeline is a set of
    // individually focusable/hoverable rows (each with its own
    // role="button"), not a single opaque graphic -- role="img" would
    // hide those interactive rows from assistive tech.
    expect(chart).toHaveAttribute("role", "group");
    expect(chart.getAttribute("aria-label")).toContain("2 phases");
    expect(chart.getAttribute("aria-label")).toContain("Struktura");
  });

  it("does not prefix a phase's row label with its internal position number", () => {
    render(
      <PhaseTimeline
        phases={[
          makePhase({ id: "p1", name: "Kick-off & setup", position: 1000, state: "done" }),
        ]}
        today={TODAY}
      />,
    );
    // docs/portal-timeline-review-and-demo-readiness.md 2.5: "1000." is
    // our internal ordering value, not a client-facing label -- row
    // order already carries the sequence.
    expect(screen.getByText("Kick-off & setup")).toBeInTheDocument();
    expect(screen.queryByText(/1000\./)).not.toBeInTheDocument();
  });

  it("test_AS_010_a_blocked_phase_that_has_not_actually_started_says_so_instead_of_reading_as_an_unexplained_alarm", () => {
    render(
      <PhaseTimeline
        phases={[
          makePhase({
            id: "p1",
            name: "QA & accessibility",
            state: "blocked",
            plannedStart: "2026-09-14",
            plannedEnd: "2026-09-22",
            actualStart: null,
          }),
        ]}
        today={TODAY}
      />,
    );
    // No blocker-reason field exists on PortalPhase/project_phases, so
    // this component does not invent one. What it DOES say, from data it
    // already has (`actualStart`), is that the phase never actually
    // began -- so "Blocked" does not read as a live, unexplained
    // emergency for a phase scheduled entirely in the future.
    const rowLabel = screen.getByTestId("phase-timeline-row-label");
    expect(rowLabel).toHaveTextContent("Blocked");
    expect(rowLabel).toHaveTextContent(/not yet started/i);

    const row = screen.getByRole("button", { name: /QA & accessibility/ });
    expect(row.getAttribute("aria-label")).toMatch(/not yet started/i);
  });

  it("a blocked phase that HAS actually started does not claim it never started", () => {
    render(
      <PhaseTimeline
        phases={[
          makePhase({
            id: "p1",
            name: "Build",
            state: "blocked",
            plannedStart: "2026-06-01",
            plannedEnd: "2026-06-20",
            actualStart: "2026-06-02",
          }),
        ]}
        today={TODAY}
      />,
    );
    const rowLabel = screen.getByTestId("phase-timeline-row-label");
    expect(rowLabel).toHaveTextContent("Blocked");
    expect(rowLabel.textContent).not.toMatch(/not yet started/i);
  });

  it("test_AS_010_an_active_phase_shows_the_one_client_visible_task_currently_in_flight", () => {
    render(
      <PhaseTimeline
        phases={[
          makePhase({
            id: "p1",
            name: "Visual direction & design",
            state: "active",
            plannedStart: "2026-08-28",
            plannedEnd: "2026-09-11",
            inFlightTaskTitle: "Homepage hero design",
          }),
        ]}
        today={TODAY}
      />,
    );
    // docs/portal-timeline-review-and-demo-readiness.md 2.7: the single
    // most valuable line on the page -- what is currently in flight
    // inside an active phase.
    const rowLabel = screen.getByTestId("phase-timeline-row-label");
    expect(rowLabel).toHaveTextContent("Homepage hero design");

    const row = screen.getByRole("button", { name: /Visual direction & design/ });
    expect(row.getAttribute("aria-label")).toContain("Homepage hero design");

    fireEvent.mouseEnter(row);
    expect(screen.getByTestId("phase-timeline-tooltip")).toHaveTextContent(
      "Homepage hero design",
    );
  });

  it("an active phase with nothing in progress omits the in-flight line rather than inventing one", () => {
    render(
      <PhaseTimeline
        phases={[
          makePhase({
            id: "p1",
            name: "Build",
            state: "active",
            inFlightTaskTitle: null,
          }),
        ]}
        today={TODAY}
      />,
    );
    const rowLabel = screen.getByTestId("phase-timeline-row-label");
    expect(rowLabel).toHaveTextContent("Active");
    expect(rowLabel.textContent).not.toMatch(/now:/i);
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

  it("keeps 'today' out of the week-tick sequence -- it's a separate marker, not an axis tick", () => {
    // docs/portal-timeline-review-and-demo-readiness.md 2.2: injecting
    // "Today" into the tick labels breaks the otherwise-even fortnightly
    // rhythm. `todayXPx` is the dashed-rule position; `weekMarks` must
    // never contain a label derived from `today` -- only real week
    // boundaries from `rangeStart`, evenly spaced.
    const phases: PortalPhase[] = [
      makePhase({
        id: "p1",
        name: "Phase",
        plannedStart: "2026-08-14",
        plannedEnd: "2026-09-25",
      }),
    ];

    const layout = computePhaseTimelineLayout(phases, TODAY);

    const labels = layout.weekMarks.map((mark) => mark.label).filter(Boolean);
    expect(labels.every((label) => label !== "Today")).toBe(true);

    const spacings = layout.weekMarks.map((mark) => mark.xPx);
    for (let i = 1; i < spacings.length; i++) {
      expect(spacings[i]! - spacings[i - 1]!).toBe(spacings[1]! - spacings[0]!);
    }
  });
});
