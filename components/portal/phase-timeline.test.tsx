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
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

  it("test_F104_no_legend_state_stays_on_the_row_itself", () => {
    // F104 1.6: the legend is gone -- every row already prints its own
    // state as a coloured word, so a legend below the chart repeated the
    // same four labels for nothing. State identity now lives ONLY on the
    // per-row label (still satisfying no-colour-alone), never in a
    // separate list of dots.
    render(
      <PhaseTimeline
        phases={[
          makePhase({ id: "p1", name: "Analiza", state: "active" }),
          makePhase({ id: "p2", name: "Build", state: "not_started" }),
        ]}
        today={TODAY}
      />,
    );
    // "Active" and "Not started" each appear exactly once PER LAYOUT --
    // on their own row's label -- not a second time in a legend below
    // the chart. Scoped to the desktop layout because F104 round 4 adds
    // a second, mobile-only rendering of the same rows (`lg:hidden`) that
    // exists in the DOM unconditionally (a CSS breakpoint, not a JS
    // branch) -- this assertion is about the legend, not about there
    // being exactly one DOM node across both responsive layouts.
    const desktop = within(screen.getByTestId("phase-timeline-desktop"));
    expect(desktop.getAllByText("Active")).toHaveLength(1);
    expect(desktop.getAllByText("Not started")).toHaveLength(1);
    expect(desktop.queryByText("Blocked")).not.toBeInTheDocument();
    expect(desktop.queryByText("Done")).not.toBeInTheDocument();
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
    expect(screen.getByTestId("phase-timeline-row-label").textContent).toMatch(
      /Done · .*4 of 4 done/,
    );
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

    const desktop = within(screen.getByTestId("phase-timeline-desktop"));
    expect(desktop.getByText(/28 Aug/)).toBeInTheDocument();
    expect(desktop.getByText(/11 Sep/)).toBeInTheDocument();
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
    // order already carries the sequence. Both the desktop and mobile
    // (F104 round 4) renderings of the phase name are checked -- neither
    // should ever show the raw position value.
    expect(screen.getAllByText("Kick-off & setup").length).toBeGreaterThan(0);
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
    //
    // F104 round 3: this note used to be appended to the facts line and
    // truncated ("not yet …") -- coordinator-observed, the exact same
    // defect the in-flight line was fixed for in round 2. It now lives
    // on its own dedicated line (`phase-timeline-blocked-note`), never
    // appended to the facts line.
    const rowLabel = screen.getByTestId("phase-timeline-row-label");
    expect(rowLabel).toHaveTextContent("Blocked");
    expect(rowLabel.textContent).not.toMatch(/not yet started/i);

    const blockedNote = screen.getByTestId("phase-timeline-blocked-note");
    expect(blockedNote).toHaveTextContent(/not yet started/i);

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
    expect(screen.queryByTestId("phase-timeline-blocked-note")).not.toBeInTheDocument();
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
    // inside an active phase. F104 round 2: this lives ONLY on its own
    // dedicated line, not also appended to the facts line (that
    // duplication -- coordinator-observed "Now: Ho…Now: Ho…" -- is the
    // exact defect this round fixes).
    const inFlightLine = screen.getByTestId("phase-timeline-inflight");
    expect(inFlightLine).toHaveTextContent("Homepage hero design");

    const rowLabel = screen.getByTestId("phase-timeline-row-label");
    expect(rowLabel.textContent).not.toContain("Homepage hero design");

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

  it("test_F104_in_flight_task_gets_its_own_line_and_is_not_truncated_into_the_facts_line", () => {
    render(
      <PhaseTimeline
        phases={[
          makePhase({
            id: "p1",
            name: "Visual direction & design",
            state: "active",
            plannedStart: "2026-08-28",
            plannedEnd: "2026-09-11",
            totalClientVisibleTasks: 5,
            doneClientVisibleTasks: 3,
            inFlightTaskTitle: "Homepage hero design and content review pass",
          }),
        ]}
        today={TODAY}
      />,
    );
    // F104 1.2/1.3: the in-flight title lives on its own dedicated line,
    // separate from the state/dates/count line, so it is never appended
    // and truncated together with three other facts.
    const inFlightLine = screen.getByTestId("phase-timeline-inflight");
    expect(inFlightLine).toHaveTextContent("Homepage hero design and content review pass");

    const factsLine = screen.getByTestId("phase-timeline-row-label");
    expect(factsLine).toHaveTextContent("3 of 5 done");
  });

  it("test_F104_bar_draws_a_progress_fill_that_differs_between_phases_with_different_fractions", () => {
    render(
      <PhaseTimeline
        phases={[
          makePhase({
            id: "p1",
            name: "Visual direction & design",
            state: "active",
            plannedStart: "2026-06-01",
            plannedEnd: "2026-06-20",
            totalClientVisibleTasks: 5,
            doneClientVisibleTasks: 3,
          }),
          makePhase({
            id: "p2",
            name: "Build",
            state: "active",
            plannedStart: "2026-06-01",
            plannedEnd: "2026-06-20",
            totalClientVisibleTasks: 4,
            doneClientVisibleTasks: 1,
          }),
        ]}
        today={TODAY}
      />,
    );

    const doneBars = screen.getAllByTestId("phase-timeline-bar-done");
    const remainderBars = screen.getAllByTestId("phase-timeline-bar-remainder");
    expect(doneBars).toHaveLength(2);
    expect(remainderBars).toHaveLength(2);

    // "3 of 5" (60%) and "1 of 4" (25%) must NOT render as identical
    // solid blocks -- this is the exact defect F104 fixes.
    const width0 = Number(doneBars[0]!.getAttribute("width"));
    const width1 = Number(doneBars[1]!.getAttribute("width"));
    expect(width0).not.toBeCloseTo(width1, 0);
    // The higher fraction gets the wider done-fill.
    expect(width0).toBeGreaterThan(width1);

    // The remainder segment renders at low opacity, distinct from the
    // done segment, so the two are visually distinguishable without
    // relying on colour alone.
    for (const bar of remainderBars) {
      expect(Number(bar.getAttribute("opacity"))).toBeLessThan(1);
    }
  });

  it("test_F104_a_phase_with_no_client_visible_tasks_renders_one_solid_bar_not_a_zero_width_split", () => {
    render(
      <PhaseTimeline
        phases={[
          makePhase({
            id: "p1",
            name: "Kick-off & setup",
            state: "done",
            plannedStart: "2026-06-01",
            plannedEnd: "2026-06-05",
            totalClientVisibleTasks: 0,
            doneClientVisibleTasks: 0,
          }),
        ]}
        today={TODAY}
      />,
    );
    expect(screen.getAllByTestId("phase-timeline-bar-done")).toHaveLength(1);
    expect(screen.queryByTestId("phase-timeline-bar-remainder")).not.toBeInTheDocument();
  });

  it("test_F104_an_active_phase_behind_its_elapsed_time_share_gets_an_expected_progress_tick_explained_on_hover", () => {
    render(
      <PhaseTimeline
        phases={[
          makePhase({
            id: "p1",
            name: "Visual direction & design",
            state: "active",
            // A 20-day phase, today (2026-06-15) 14 days in (~70%
            // elapsed) but only 1 of 5 (20%) done -- clearly behind.
            plannedStart: "2026-06-01",
            plannedEnd: "2026-06-21",
            totalClientVisibleTasks: 5,
            doneClientVisibleTasks: 1,
          }),
        ]}
        today={TODAY}
      />,
    );

    const row = screen.getByRole("button", { name: /Visual direction & design/ });
    expect(row).toHaveAttribute("data-behind", "true");
    expect(within(row).getByTestId("phase-timeline-expected-tick")).toBeInTheDocument();
    expect(row.getAttribute("aria-label")).toMatch(/behind/i);

    fireEvent.mouseEnter(row);
    expect(screen.getByTestId("phase-timeline-tooltip")).toHaveTextContent(/behind/i);
  });

  it("test_F104_an_active_phase_on_pace_is_not_flagged_as_behind", () => {
    render(
      <PhaseTimeline
        phases={[
          makePhase({
            id: "p1",
            name: "Build",
            state: "active",
            // 14 days elapsed of 20 (~70%), 4 of 5 (80%) done -- ahead
            // of pace, not behind.
            plannedStart: "2026-06-01",
            plannedEnd: "2026-06-21",
            totalClientVisibleTasks: 5,
            doneClientVisibleTasks: 4,
          }),
        ]}
        today={TODAY}
      />,
    );

    const row = screen.getByRole("button", { name: /Build/ });
    expect(row).toHaveAttribute("data-behind", "false");
    expect(row.getAttribute("aria-label")).not.toMatch(/behind/i);
  });

  it("test_F104_round3_a_blocked_never_started_notes_own_line_grows_the_row_the_same_way_as_inflight", () => {
    // Coordinator round 3: the exact same appended-and-truncated defect
    // fixed for the in-flight line in round 2 also existed for the
    // blocked "not yet started" note ("Blocked · 18 Sept – 26 Sept ·
    // 0 of 1 done · not yet …"). Both now go through the single
    // `formatQualifierLine` mechanism, so fixing the class fixes both
    // instances and any future one.
    const phases: PortalPhase[] = [
      makePhase({
        id: "p1",
        name: "QA & accessibility",
        state: "blocked",
        plannedStart: "2026-09-18",
        plannedEnd: "2026-09-26",
        actualStart: null,
        totalClientVisibleTasks: 1,
        doneClientVisibleTasks: 0,
      }),
      makePhase({ id: "p2", name: "Launch", state: "not_started" }),
    ];

    const layout = computePhaseTimelineLayout(phases, TODAY);
    const [row1, row2] = layout.rows;

    // Same taller-row mechanism as the in-flight case -- not a special
    // case bolted on next to it.
    expect(row1!.heightPx).toBeGreaterThan(row2!.heightPx);
    expect(row2!.yPx).toBe(row1!.yPx + row1!.heightPx);

    render(<PhaseTimeline phases={phases} today={TODAY} />);
    const note = screen.getByTestId("phase-timeline-blocked-note");
    expect(note).toHaveTextContent(/not yet started/i);

    const factsLines = screen.getAllByTestId("phase-timeline-row-label");
    for (const factsLine of factsLines) {
      expect(factsLine.textContent).not.toMatch(/not yet started/i);
    }
  });

  it("test_F104_round2_a_rows_own_height_grows_to_fit_its_inflight_line_without_overlapping_the_next_row", () => {
    // Coordinator review round 2: a fixed ROW_HEIGHT_PX shared by every
    // row could not fit three lines (name + facts + in-flight) in the
    // same height as a two-line row, so the in-flight line overflowed
    // into the row below ("Now: Homepage hi-fi design" rendered on top
    // of "Build"). Rows must now take their own, different heights, and
    // the SVG bar's own vertical position must be derived from that same
    // per-row height so the two never disagree.
    const phases: PortalPhase[] = [
      makePhase({
        id: "p1",
        name: "Visual direction & design",
        state: "active",
        plannedStart: "2026-06-01",
        plannedEnd: "2026-06-20",
        inFlightTaskTitle: "Homepage hero design",
      }),
      makePhase({ id: "p2", name: "Build", state: "not_started" }),
    ];

    const layout = computePhaseTimelineLayout(phases, TODAY);
    const [row1, row2] = layout.rows;

    // The in-flight row is taller than the plain row.
    expect(row1!.heightPx).toBeGreaterThan(row2!.heightPx);
    // The second row starts exactly where the first row's own (taller)
    // height ends -- no overlap, no gap.
    expect(row2!.yPx).toBe(row1!.yPx + row1!.heightPx);

    render(<PhaseTimeline phases={phases} today={TODAY} />);
    // Both rows' bars exist and are vertically distinct in the SVG.
    const bars = screen.getAllByTestId("phase-timeline-bar-done");
    const y0 = Number(bars[0]!.getAttribute("y"));
    const y1 = Number(bars[1]!.getAttribute("y"));
    expect(y1).toBeGreaterThan(y0);
  });

  it("test_F104_range_ends_shortly_past_the_last_phase_not_at_an_arbitrary_far_boundary", () => {
    // A short, single 10-day phase used to be padded out to a
    // MIN_CHART_DAYS-wide axis regardless of how little content there
    // was to show, leaving roughly a third of the plot empty.
    const layout = computePhaseTimelineLayout(
      [
        {
          id: "p1",
          name: "Short phase",
          clientDescription: null,
          state: "active",
          plannedStart: "2026-06-01",
          plannedEnd: "2026-06-11",
          actualStart: null,
          actualEnd: null,
          position: 1,
          totalClientVisibleTasks: 0,
          doneClientVisibleTasks: 0,
          progressPercent: 0,
          inFlightTaskTitle: null,
        },
      ],
      "2026-06-05",
    );

    const lastRow = layout.rows[0]!;
    const barEndPx = lastRow.xPx + lastRow.widthPx;
    // The chart should not run dramatically further than the last bar's
    // own end -- a small fixed pad, not hundreds of extra pixels of
    // dead space.
    expect(layout.chartWidthPx - barEndPx).toBeLessThan(80);
  });
});

describe("PhaseTimeline — mobile layout (F104 round 4)", () => {
  it("test_F104_round4_mobile_layout_renders_one_full_width_stacked_card_per_phase_instead_of_the_shared_axis_layout", () => {
    // Coordinator round 4: at 375px the desktop side-by-side layout left
    // the plot a 49px keyhole (label column ~326 of 375px). The mobile
    // layout drops the shared axis and stacks one full-width card per
    // phase instead of shrinking the desktop shape.
    const phases: PortalPhase[] = [
      makePhase({
        id: "p1",
        name: "Visual direction & design",
        state: "active",
        plannedStart: "2026-06-01",
        plannedEnd: "2026-06-21",
        totalClientVisibleTasks: 5,
        doneClientVisibleTasks: 4,
      }),
      makePhase({ id: "p2", name: "Build", state: "not_started" }),
    ];
    render(<PhaseTimeline phases={phases} today={TODAY} />);

    const mobile = within(screen.getByTestId("phase-timeline-mobile"));
    const rows = mobile.getAllByTestId("phase-timeline-mobile-row");
    expect(rows).toHaveLength(2);

    // Each card's own bar is full width of ITS OWN card -- no shared
    // pixel axis to agree with the other card.
    for (const row of rows) {
      const bar = within(row).getByTestId("phase-timeline-mobile-bar");
      expect(bar).toBeInTheDocument();
    }
  });

  it("test_F104_round4_mobile_bar_draws_a_progress_fill_that_differs_between_phases_with_different_fractions", () => {
    render(
      <PhaseTimeline
        phases={[
          makePhase({
            id: "p1",
            name: "Visual direction & design",
            state: "active",
            plannedStart: "2026-06-01",
            plannedEnd: "2026-06-20",
            totalClientVisibleTasks: 5,
            doneClientVisibleTasks: 3,
          }),
          makePhase({
            id: "p2",
            name: "Build",
            state: "active",
            plannedStart: "2026-06-01",
            plannedEnd: "2026-06-20",
            totalClientVisibleTasks: 4,
            doneClientVisibleTasks: 1,
          }),
        ]}
        today={TODAY}
      />,
    );

    const mobile = within(screen.getByTestId("phase-timeline-mobile"));
    const doneBars = mobile.getAllByTestId("phase-timeline-mobile-bar-done");
    // "3 of 5" (60%) vs "1 of 4" (25%) -- must render at different
    // widths, same defect class as the desktop bar fill.
    expect(doneBars[0]).toHaveStyle({ width: "calc(60% - 1px)" });
    expect(doneBars[1]).toHaveStyle({ width: "calc(25% - 1px)" });
  });

  it("test_F104_round4_mobile_today_marker_only_appears_on_a_card_whose_own_range_contains_today", () => {
    render(
      <PhaseTimeline
        phases={[
          makePhase({
            id: "p1",
            name: "Contains today",
            state: "active",
            plannedStart: "2026-06-01",
            plannedEnd: "2026-06-21",
          }),
          makePhase({
            id: "p2",
            name: "Already finished",
            state: "done",
            plannedStart: "2026-05-01",
            plannedEnd: "2026-05-10",
          }),
        ]}
        today={TODAY}
      />,
    );

    const mobile = within(screen.getByTestId("phase-timeline-mobile"));
    const rows = mobile.getAllByTestId("phase-timeline-mobile-row");
    expect(within(rows[0]!).getByTestId("phase-timeline-mobile-today")).toBeInTheDocument();
    expect(
      within(rows[1]!).queryByTestId("phase-timeline-mobile-today"),
    ).not.toBeInTheDocument();
  });

  it("test_F104_round4_mobile_behind_pace_cue_is_always_visible_text_not_hover_only", () => {
    // A phone has no hover -- the "behind" signal (a tooltip-only note on
    // desktop) must be plain, always-visible text on mobile instead.
    render(
      <PhaseTimeline
        phases={[
          makePhase({
            id: "p1",
            name: "Visual direction & design",
            state: "active",
            plannedStart: "2026-06-01",
            plannedEnd: "2026-06-21",
            totalClientVisibleTasks: 5,
            doneClientVisibleTasks: 1,
          }),
        ]}
        today={TODAY}
      />,
    );

    const mobile = within(screen.getByTestId("phase-timeline-mobile"));
    const row = mobile.getByTestId("phase-timeline-mobile-row");
    expect(row).toHaveAttribute("data-behind", "true");
    expect(within(row).getByTestId("phase-timeline-mobile-expected-tick")).toBeInTheDocument();
    expect(within(row).getByTestId("phase-timeline-mobile-behind-note")).toHaveTextContent(
      /behind/i,
    );
  });

  it("test_F104_round4_mobile_qualifier_lines_use_the_same_own_line_mechanism_as_desktop", () => {
    render(
      <PhaseTimeline
        phases={[
          makePhase({
            id: "p1",
            name: "Visual direction & design",
            state: "active",
            inFlightTaskTitle: "Homepage hero design",
          }),
          makePhase({
            id: "p2",
            name: "QA & accessibility",
            state: "blocked",
            actualStart: null,
          }),
        ]}
        today={TODAY}
      />,
    );

    const mobile = within(screen.getByTestId("phase-timeline-mobile"));
    expect(mobile.getByTestId("phase-timeline-mobile-inflight")).toHaveTextContent(
      "Homepage hero design",
    );
    expect(mobile.getByTestId("phase-timeline-mobile-blocked-note")).toHaveTextContent(
      /not yet started/i,
    );
    // Never appended to the mobile facts line either.
    for (const facts of mobile.getAllByTestId("phase-timeline-mobile-facts")) {
      expect(facts.textContent).not.toMatch(/homepage hero design/i);
      expect(facts.textContent).not.toMatch(/not yet started/i);
    }
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
