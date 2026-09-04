// @vitest-environment jsdom
//
// F108 (missions/20260903-portal, docs/client-portal-visual-plan.md 3.3):
// Overview's one-glance budget bar. Covers this feature's own definition
// of done: the no-budget case renders text only, the under-budget case
// draws a used segment short of the ceiling, and — the case F085 exists
// to make renderable at all — the over-budget case draws the overage
// PAST the ceiling in the blocked token rather than clamping it back
// inside the track.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { BudgetBar } from "@/components/portal/budget-bar";

afterEach(() => {
  cleanup();
});

describe("BudgetBar", () => {
  it("renders an honest text-only state when no budget has been set", () => {
    render(<BudgetBar usedMinutes={120} soldMinutes={null} />);

    expect(screen.getByTestId("budget-bar-no-budget")).toHaveTextContent(
      "No budget has been set for this project yet.",
    );
    expect(screen.queryByTestId("budget-bar-track")).not.toBeInTheDocument();
  });

  it("draws the used segment short of the ceiling when under budget", () => {
    render(<BudgetBar usedMinutes={600} soldMinutes={1200} />);

    expect(screen.getByTestId("budget-bar-track")).toBeInTheDocument();
    expect(screen.getByTestId("budget-bar-ceiling")).toBeInTheDocument();
    expect(screen.queryByTestId("budget-bar-overage")).not.toBeInTheDocument();
    expect(screen.getByTestId("budget-bar-summary")).toHaveTextContent(
      "10h used of a 20h budget.",
    );
  });

  // The over-budget path (F085 fixed the clamp that used to hide these
  // real numbers) — Meridian Ops Dashboard in the demo data is
  // deliberately over budget to exercise exactly this.
  it("test_over_budget_draws_overage_past_the_ceiling_in_the_blocked_token_not_clamped", () => {
    render(<BudgetBar usedMinutes={1500} soldMinutes={1200} />);

    const ceiling = screen.getByTestId("budget-bar-ceiling");
    const overage = screen.getByTestId("budget-bar-overage");
    expect(overage).toBeInTheDocument();
    expect(overage.className).toContain("bg-status-blocked");

    const ceilingLeft = Number.parseFloat(ceiling.style.left);
    const overageLeft = Number.parseFloat(overage.style.left);
    const overageWidth = Number.parseFloat(overage.style.width);

    // Overage starts exactly at the ceiling and extends past it —
    // never clamped back to 0 width or drawn before the ceiling.
    expect(overageLeft).toBeCloseTo(ceilingLeft, 5);
    expect(overageWidth).toBeGreaterThan(0);
    expect(overageLeft + overageWidth).toBeGreaterThan(ceilingLeft);

    expect(screen.getByTestId("budget-bar-summary")).toHaveTextContent(
      "25h used against a 20h budget — 5h over.",
    );
  });

  it("treats no hours logged yet (usedMinutes null) as zero used, not a crash", () => {
    render(<BudgetBar usedMinutes={null} soldMinutes={600} />);

    expect(screen.getByTestId("budget-bar-track")).toBeInTheDocument();
    expect(screen.queryByTestId("budget-bar-overage")).not.toBeInTheDocument();
    expect(screen.getByTestId("budget-bar-summary")).toHaveTextContent(
      "0h used of a 10h budget.",
    );
  });
});
