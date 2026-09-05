// @vitest-environment jsdom
//
// F107 (missions/20260903-portal, docs/client-portal-visual-plan.md 2.1):
// the headline's three states (on track / at risk / slipped) plus the
// honest "not set" empty case -- this feature's own DoD instruction.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { LaunchHeadline } from "@/components/portal/launch-headline";

afterEach(() => {
  cleanup();
});

describe("LaunchHeadline", () => {
  it("test_headline_on_track_state", () => {
    render(
      <LaunchHeadline
        targetLaunchDate="2026-10-04"
        launchConfidence="on_track"
        launchNote="Everything on schedule."
      />,
    );

    const headline = screen.getByTestId("launch-headline");
    expect(headline).toHaveTextContent("On track");
    expect(headline).toHaveTextContent("4 October 2026");
    expect(headline).toHaveTextContent("Everything on schedule.");
    expect(headline).toHaveAttribute("data-confidence", "on_track");
  });

  it("test_headline_at_risk_state", () => {
    render(<LaunchHeadline targetLaunchDate="2026-10-04" launchConfidence="at_risk" launchNote={null} />);

    const headline = screen.getByTestId("launch-headline");
    expect(headline).toHaveTextContent("At risk");
    expect(headline).toHaveAttribute("data-confidence", "at_risk");
  });

  it("test_headline_late_slipped_state", () => {
    render(<LaunchHeadline targetLaunchDate="2026-10-04" launchConfidence="slipped" launchNote={null} />);

    const headline = screen.getByTestId("launch-headline");
    expect(headline).toHaveTextContent("Slipped");
    expect(headline).toHaveAttribute("data-confidence", "slipped");
  });

  it("test_headline_honest_empty_state_when_launch_data_is_not_set", () => {
    render(<LaunchHeadline targetLaunchDate={null} launchConfidence={null} launchNote={null} />);

    const headline = screen.getByTestId("launch-headline");
    expect(headline).toHaveTextContent("Launch date not set yet");
    expect(headline).not.toHaveTextContent("On track");
    expect(headline).not.toHaveTextContent("At risk");
    expect(headline).not.toHaveTextContent("Slipped");
  });

  // F115 (missions/20260903-portal, docs/client-portal-phase-2-plan.md
  // C): "what happens next" reads as part of this same headline block --
  // one line, no card of its own -- and is omitted entirely (not an
  // empty paragraph) when the caller doesn't supply it, so this
  // component's own three tests above keep passing unchanged.
  it("test_AS_next_from_you_line_renders_under_the_headline_when_supplied", () => {
    render(
      <LaunchHeadline
        targetLaunchDate="2026-10-04"
        launchConfidence="on_track"
        launchNote={null}
        nextFromYou="Next from you: sign off the About page — expected around 12 Sept."
      />,
    );

    expect(screen.getByTestId("launch-headline-next")).toHaveTextContent(
      "Next from you: sign off the About page — expected around 12 Sept.",
    );
  });

  it("test_AS_next_from_you_line_omitted_when_not_supplied", () => {
    render(<LaunchHeadline targetLaunchDate="2026-10-04" launchConfidence="on_track" launchNote={null} />);

    expect(screen.queryByTestId("launch-headline-next")).not.toBeInTheDocument();
  });

  // F115 round 2 (coordinator review): a launched project must not
  // speak in the future tense about its own launch date.
  it("test_AS_headline_says_launching_when_the_target_date_is_still_ahead", () => {
    render(
      <LaunchHeadline
        targetLaunchDate="2026-10-04"
        launchConfidence="on_track"
        launchNote={null}
        today="2026-09-05"
      />,
    );

    const headline = screen.getByTestId("launch-headline");
    expect(headline).toHaveTextContent("Launching 4 October 2026");
    expect(headline).not.toHaveTextContent("Launched 4 October 2026");
  });

  it("test_AS_headline_says_launched_when_the_target_date_is_in_the_past", () => {
    render(
      <LaunchHeadline
        targetLaunchDate="2026-08-26"
        launchConfidence="on_track"
        launchNote={null}
        today="2026-09-05"
      />,
    );

    const headline = screen.getByTestId("launch-headline");
    expect(headline).toHaveTextContent("Launched 26 August 2026");
    expect(headline).not.toHaveTextContent("Launching 26 August 2026");
  });

  it("test_AS_headline_defaults_to_launching_when_today_is_not_supplied", () => {
    // Backward-compatible default -- callers that don't pass `today`
    // (including this component's own pre-F115-round-2 tests above) keep
    // getting the original "Launching" phrasing rather than a crash or a
    // silently wrong "Launched".
    render(<LaunchHeadline targetLaunchDate="2026-08-26" launchConfidence="on_track" launchNote={null} />);

    expect(screen.getByTestId("launch-headline")).toHaveTextContent("Launching 26 August 2026");
  });

  it("test_AS_next_from_you_line_renders_in_the_honest_empty_launch_state_too", () => {
    render(
      <LaunchHeadline
        targetLaunchDate={null}
        launchConfidence={null}
        launchNote={null}
        nextFromYou="Nothing needed from you right now."
      />,
    );

    expect(screen.getByTestId("launch-headline-next")).toHaveTextContent(
      "Nothing needed from you right now.",
    );
  });
});
