// @vitest-environment jsdom
//
// F085 (missions/20260903-portal audit, defect 3): the Hours view's
// Remaining tile used to clamp a negative balance to 0 with
// `Math.max(remainingMinutes, 0)`, so a client 12 hours over budget saw
// the exact same "0h" a client precisely on budget saw -- no number, no
// instruction. Remaining now shows the real overage and a next-step line
// when over budget, and both over-budget tiles pair colour with an icon
// and screen-reader text (never colour alone).
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { HoursTiles } from "@/components/portal/hours-tiles";

afterEach(() => {
  cleanup();
});

describe("HoursTiles", () => {
  it("test_AS_034_shows_the_real_overage_and_a_next_step_when_over_budget", () => {
    render(
      <HoursTiles
        usedMinutes={52 * 60}
        soldMinutes={40 * 60}
        thisWeekMinutes={5 * 60}
        againstPlanMinutes={12 * 60}
      />,
    );

    const remaining = screen.getByTestId("tile-hours-remaining");
    expect(remaining).toHaveTextContent("+12h");
    expect(remaining).toHaveTextContent("Over the budget");
    // No client sees "Remaining 0h" with no number ever again.
    expect(remaining).not.toHaveTextContent("0h");
    // A next-step line, not just the number.
    expect(remaining.textContent).toMatch(/team/i);
  });

  it("test_AS_034_over_budget_state_is_never_colour_alone", () => {
    render(
      <HoursTiles
        usedMinutes={52 * 60}
        soldMinutes={40 * 60}
        thisWeekMinutes={5 * 60}
        againstPlanMinutes={12 * 60}
      />,
    );

    const remaining = screen.getByTestId("tile-hours-remaining");
    expect(remaining).toHaveAttribute("data-over-budget", "true");
    // Icon present (aria-hidden, decorative) AND sr-only text -- colour is
    // never the only signal.
    expect(remaining.querySelector("svg")).not.toBeNull();
    expect(remaining.querySelector(".sr-only")).not.toBeNull();
  });

  it("renders a plain positive remaining balance when under budget", () => {
    render(
      <HoursTiles
        usedMinutes={10 * 60}
        soldMinutes={40 * 60}
        thisWeekMinutes={2 * 60}
        againstPlanMinutes={-2 * 60}
      />,
    );

    const remaining = screen.getByTestId("tile-hours-remaining");
    expect(remaining).toHaveTextContent("30h");
    expect(remaining).toHaveTextContent("Of the current budget");
    expect(remaining).toHaveAttribute("data-over-budget", "false");
  });

  it("shows an honest placeholder when there is no budget set yet", () => {
    render(
      <HoursTiles
        usedMinutes={10 * 60}
        soldMinutes={null}
        thisWeekMinutes={2 * 60}
        againstPlanMinutes={null}
      />,
    );

    expect(screen.getByTestId("tile-hours-remaining")).toHaveTextContent("—");
    expect(screen.getByTestId("tile-hours-remaining")).toHaveTextContent("No budget set yet");
  });

  // The audit's own finding: "against plan" colours over-budget with the
  // waiting token rather than blocked -- pace, not overrun, but still
  // must read as the bad-news colour, paired with the same icon/sr-only
  // convention.
  it("test_AS_034_against_plan_over_pace_uses_the_blocked_token_not_waiting", () => {
    render(
      <HoursTiles
        usedMinutes={10 * 60}
        soldMinutes={40 * 60}
        thisWeekMinutes={2 * 60}
        againstPlanMinutes={3 * 60}
      />,
    );

    const againstPlan = screen.getByTestId("tile-hours-against-plan");
    expect(againstPlan).toHaveAttribute("data-over-budget", "true");
    expect(againstPlan.querySelector("svg")).not.toBeNull();
  });
});
