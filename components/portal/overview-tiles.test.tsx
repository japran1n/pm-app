// @vitest-environment jsdom
//
// F006 (missions/20260903-portal): the overview's four tiles. Covers
// this feature's own "side-effect verification" definition of done
// directly: no fabricated figure anywhere on the page.
//
// F085 (missions/20260903-portal audit, defects 1 and 2): the Hours tile
// is now wired to real minutes rather than a permanent placeholder, and
// the Waiting-on-you tile is a link.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { OverviewTiles } from "@/components/portal/overview-tiles";

afterEach(() => {
  cleanup();
});

const BASE_PROPS = {
  waitingOnYouCount: 3,
  approvalsHref: "/portal/acme/p/project-1/approvals",
  pagesReadyCount: 5,
  pagesTotalCount: 12,
  pagesStatusDistribution: { done: 5, progress: 4, waiting: 2, blocked: 1 },
  usedMinutes: 120,
  usedMinutesSeries: [30, 60, 90, 120],
  soldMinutes: 600,
  hoursHref: "/portal/acme/p/project-1/hours",
  daysToLaunch: 40,
  launchConfidence: "on_track" as const,
};

describe("OverviewTiles", () => {
  it("test_AS_031_hours_tile_renders_the_real_used_and_budgeted_figures", () => {
    render(<OverviewTiles {...BASE_PROPS} usedMinutes={120} soldMinutes={600} />);

    const hoursTile = screen.getByTestId("tile-hours-used");
    expect(hoursTile).toHaveTextContent("2h");
    expect(hoursTile).toHaveTextContent("Of 10h budgeted");
    // Never the F006-era hard-coded placeholder copy again.
    expect(hoursTile).not.toHaveTextContent("Available with the next release");
  });

  it("hours tile shows an honest placeholder, never a fabricated number, with no data at all", () => {
    render(<OverviewTiles {...BASE_PROPS} usedMinutes={null} soldMinutes={null} />);

    const hoursTile = screen.getByTestId("tile-hours-used");
    expect(hoursTile).toHaveTextContent("—");
    expect(hoursTile).toHaveTextContent("No billable hours yet");
  });

  it("hours tile links to the Hours view", () => {
    render(<OverviewTiles {...BASE_PROPS} />);

    const hoursTile = screen.getByTestId("tile-hours-used");
    expect(hoursTile.tagName).toBe("A");
    expect(hoursTile).toHaveAttribute("href", "/portal/acme/p/project-1/hours");
  });

  it("renders the waiting-on-you count and a real pages-ready fraction", () => {
    render(
      <OverviewTiles
        {...BASE_PROPS}
        waitingOnYouCount={2}
        pagesReadyCount={4}
        pagesTotalCount={9}
        daysToLaunch={15}
        launchConfidence="at_risk"
      />,
    );

    expect(screen.getByTestId("tile-waiting-on-you")).toHaveTextContent("2");
    expect(screen.getByTestId("tile-pages-ready")).toHaveTextContent("4 / 9");
    expect(screen.getByTestId("tile-days-to-launch")).toHaveTextContent("15");
    expect(screen.getByTestId("tile-days-to-launch")).toHaveTextContent("At risk");
  });

  // F085 (defect 2): the whole reason this tile links anywhere -- a
  // client who reads "3" no longer has to go hunting for where to act.
  it("test_AS_002_waiting_on_you_tile_is_a_link_to_approvals", () => {
    render(<OverviewTiles {...BASE_PROPS} waitingOnYouCount={3} />);

    const tile = screen.getByTestId("tile-waiting-on-you");
    expect(tile.tagName).toBe("A");
    expect(tile).toHaveAttribute("href", "/portal/acme/p/project-1/approvals");
  });

  it("shows an honest placeholder, not a fabricated fraction, when there are no pages yet", () => {
    render(
      <OverviewTiles
        {...BASE_PROPS}
        waitingOnYouCount={0}
        pagesReadyCount={0}
        pagesTotalCount={0}
        daysToLaunch={null}
        launchConfidence={null}
      />,
    );

    expect(screen.getByTestId("tile-pages-ready")).toHaveTextContent("—");
    expect(screen.getByTestId("tile-days-to-launch")).toHaveTextContent("—");
    expect(screen.getByTestId("tile-days-to-launch")).toHaveTextContent(
      "Launch date not set yet",
    );
  });

  // F006f (missions/20260903-portal, AS-002): a failed read is `null`,
  // never coalesced to 0 -- 0 is a real, different answer ("nothing is
  // waiting on you") that this tile must not claim when it doesn't
  // actually know.
  it("test_AS_002_renders_an_honest_placeholder_never_a_fabricated_zero_when_waiting_on_you_failed_to_load", () => {
    render(<OverviewTiles {...BASE_PROPS} waitingOnYouCount={null} />);

    const tile = screen.getByTestId("tile-waiting-on-you");
    expect(tile).toHaveTextContent("—");
    expect(tile).toHaveTextContent("We couldn't load this");
    expect(tile.textContent).not.toContain("0");
  });

  // F107 (missions/20260903-portal, docs/client-portal-visual-plan.md
  // 2.3): the hours tile's sparkline is the burn-down series, not a new
  // number -- three or more points renders it.
  it("test_hours_tile_renders_a_sparkline_when_history_has_three_or_more_points", () => {
    render(<OverviewTiles {...BASE_PROPS} usedMinutesSeries={[30, 60, 90, 120]} />);

    const hoursTile = screen.getByTestId("tile-hours-used");
    expect(hoursTile.querySelector('[data-testid="tile-sparkline"]')).not.toBeNull();
  });

  it("test_hours_tile_renders_no_sparkline_with_fewer_than_three_points", () => {
    render(<OverviewTiles {...BASE_PROPS} usedMinutesSeries={[30, 60]} />);

    const hoursTile = screen.getByTestId("tile-hours-used");
    expect(hoursTile.querySelector('[data-testid="tile-sparkline"]')).toBeNull();
  });

  it("test_pages_tile_renders_the_status_distribution_bar_with_its_own_counts_as_text", () => {
    render(<OverviewTiles {...BASE_PROPS} pagesStatusDistribution={{ done: 5, progress: 4, waiting: 2, blocked: 1 }} />);

    const pagesTile = screen.getByTestId("tile-pages-ready");
    expect(pagesTile).toHaveTextContent("5 done");
    expect(pagesTile).toHaveTextContent("2 waiting on you");
    expect(pagesTile).toHaveTextContent("1 blocked");
  });

  it("test_pages_tile_renders_no_distribution_bar_when_there_are_no_pages", () => {
    render(
      <OverviewTiles
        {...BASE_PROPS}
        pagesReadyCount={0}
        pagesTotalCount={0}
        pagesStatusDistribution={{ done: 0, progress: 0, waiting: 0, blocked: 0 }}
      />,
    );

    const pagesTile = screen.getByTestId("tile-pages-ready");
    expect(pagesTile.querySelector('[data-testid="tile-pages-distribution"]')).toBeNull();
  });
});
