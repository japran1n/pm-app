// @vitest-environment jsdom
//
// F108 (missions/20260903-portal, docs/client-portal-visual-plan.md 3.2):
// the Pages view's journey pipeline. Covers this feature's own
// definition of done, and round 2's coordinator-review fixes:
//   - the genuine flow (progress -> waiting -> done) renders in order
//     with its own count per step, connected by arrows;
//   - "Blocked" is never connected by an arrow (it is a state, not a
//     position in the sequence) — it renders as its own marker, set
//     apart by a divider;
//   - the client's own step ("Waiting on you") is visually distinguished
//     (never colour alone — it carries its own icon and text);
//   - the strip never wraps (no orphaned trailing arrow) — it scrolls
//     inside its own container instead;
//   - an all-zero pipeline renders an honest empty state.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { PagePipeline } from "@/components/portal/page-pipeline";

afterEach(() => {
  cleanup();
});

describe("PagePipeline", () => {
  it("test_AS_017_renders_the_genuine_flow_in_order_with_its_own_count_per_step", () => {
    render(<PagePipeline counts={{ waiting: 2, progress: 5, blocked: 1, done: 3 }} />);

    // The flow — only steps that genuinely follow one another.
    const flowSteps = screen.getAllByRole("listitem");
    expect(flowSteps).toHaveLength(3);
    expect(flowSteps[0]).toHaveTextContent("In progress");
    expect(flowSteps[0]).toHaveTextContent("5");
    expect(flowSteps[1]).toHaveTextContent("Waiting on you");
    expect(flowSteps[1]).toHaveTextContent("2");
    expect(flowSteps[2]).toHaveTextContent("Ready to launch");
    expect(flowSteps[2]).toHaveTextContent("3");
  });

  it("test_AS_017_blocked_is_a_marker_not_a_step_in_the_arrow_chain", () => {
    render(<PagePipeline counts={{ waiting: 0, progress: 0, blocked: 4, done: 0 }} />);

    // Blocked is never one of the `<li>` flow steps...
    const flowSteps = screen.getAllByRole("listitem");
    expect(flowSteps.some((step) => step.textContent?.includes("Blocked"))).toBe(false);

    // ...it renders as its own, separately-labelled marker instead.
    const blockedAside = screen.getByTestId("page-pipeline-blocked-aside");
    expect(blockedAside).toHaveTextContent("Blocked");
    expect(blockedAside).toHaveTextContent("4");
    expect(screen.getByTestId("page-pipeline-step-blocked")).toBeInTheDocument();
  });

  it("test_AS_017_highlights_the_clients_own_bucket_using_the_waiting_token_not_colour_alone", () => {
    render(<PagePipeline counts={{ waiting: 4, progress: 0, blocked: 0, done: 0 }} />);

    const waitingStep = screen.getByTestId("page-pipeline-step-waiting");
    expect(waitingStep).toHaveAttribute("data-highlighted", "true");
    expect(waitingStep.className).toContain("border-status-waiting");
    expect(waitingStep.className).toContain("bg-status-waiting-bg");
    // Never colour alone: the step still carries its own icon and text.
    expect(waitingStep.querySelector("svg")).not.toBeNull();
    expect(waitingStep).toHaveTextContent("Waiting on you");

    const progressStep = screen.getByTestId("page-pipeline-step-progress");
    expect(progressStep).toHaveAttribute("data-highlighted", "false");
  });

  it("never wraps the flow onto a second row (no orphaned trailing arrow) — scrolls its own container instead", () => {
    const { container } = render(
      <PagePipeline counts={{ waiting: 2, progress: 5, blocked: 1, done: 3 }} />,
    );

    // The flow list is `flex-nowrap`, and its scrolling ancestor is
    // `overflow-x-auto` — a narrow viewport scrolls this strip
    // horizontally instead of wrapping a trailing arrow into empty
    // space (the tile-grid orphan this same review already flagged
    // once, on `overview-tiles.tsx`).
    const flow = container.querySelector('[aria-label="How your pages travel, by count"]');
    expect(flow).not.toBeNull();
    expect(flow!.className).toContain("flex-nowrap");
    expect(flow!.className).not.toContain("flex-wrap");

    const scroller = container.querySelector(".overflow-x-auto");
    expect(scroller).not.toBeNull();
  });

  // F108 round 3 (coordinator review): placing the blocked marker
  // inside the flow's own scroll container meant a client could land on
  // a scroll position that cut the blocked count off-screen with no
  // affordance signalling there was more to scroll to — the one number
  // a client most needs to act on, hidden. Blocked now lives outside
  // that scroller entirely, in its own always-visible row.
  it("test_F108_blocked_marker_is_never_inside_the_flows_scroll_container", () => {
    const { container } = render(
      <PagePipeline counts={{ waiting: 1, progress: 1, blocked: 3, done: 1 }} />,
    );

    const scroller = container.querySelector(".overflow-x-auto");
    expect(scroller).not.toBeNull();
    // The scroller contains only the arrow-connected flow list...
    expect(scroller!.querySelector('[aria-label="How your pages travel, by count"]')).not.toBeNull();
    // ...never the blocked marker, at any scroll position.
    expect(scroller!.querySelector('[data-testid="page-pipeline-blocked-aside"]')).toBeNull();

    // The blocked marker is present elsewhere in the document, outside
    // the scroller, unconditionally visible.
    const blockedAside = screen.getByTestId("page-pipeline-blocked-aside");
    expect(scroller!.contains(blockedAside)).toBe(false);
    expect(blockedAside).toHaveTextContent("3");
  });

  it("test_AS_014_an_all_zero_pipeline_renders_an_honest_empty_state", () => {
    render(<PagePipeline counts={{ waiting: 0, progress: 0, blocked: 0, done: 0 }} />);

    expect(screen.getByTestId("page-pipeline-empty")).toHaveTextContent("No pages yet.");
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.queryByTestId("page-pipeline-blocked-aside")).not.toBeInTheDocument();
  });
});
