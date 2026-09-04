// @vitest-environment jsdom
//
// F108 (missions/20260903-portal, docs/client-portal-visual-plan.md 3.2):
// the Pages view's journey pipeline. Covers this feature's own
// definition of done: every step renders with its own count, in the
// pipeline's own left-to-right order, the client's own step ("Waiting on
// you") is visually distinguished (never colour alone — it carries its
// own icon and text, same as every other step), and an all-zero pipeline
// renders an honest empty state rather than four meaningless steps.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { PagePipeline } from "@/components/portal/page-pipeline";

afterEach(() => {
  cleanup();
});

describe("PagePipeline", () => {
  it("test_AS_017_renders_every_step_in_order_with_its_own_count", () => {
    render(<PagePipeline counts={{ waiting: 2, progress: 5, blocked: 1, done: 3 }} />);

    const steps = screen.getAllByRole("listitem");
    expect(steps).toHaveLength(4);

    // Pipeline order: progress, waiting, blocked, done — a page is
    // normally being worked on, sometimes waits on the client, sometimes
    // stalls, and eventually ships.
    expect(steps[0]).toHaveTextContent("In progress");
    expect(steps[0]).toHaveTextContent("5");
    expect(steps[1]).toHaveTextContent("Waiting on you");
    expect(steps[1]).toHaveTextContent("2");
    expect(steps[2]).toHaveTextContent("Blocked");
    expect(steps[2]).toHaveTextContent("1");
    expect(steps[3]).toHaveTextContent("Ready to launch");
    expect(steps[3]).toHaveTextContent("3");
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

  it("test_AS_014_an_all_zero_pipeline_renders_an_honest_empty_state", () => {
    render(<PagePipeline counts={{ waiting: 0, progress: 0, blocked: 0, done: 0 }} />);

    expect(screen.getByTestId("page-pipeline-empty")).toHaveTextContent("No pages yet.");
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});
