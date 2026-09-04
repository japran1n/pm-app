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
});
