// @vitest-environment jsdom
//
// F006 (missions/20260903-portal): the overview's tiles. Covers this
// feature's own "side-effect verification" definition of done directly:
// no fabricated figure anywhere on the page.
//
// F085 (missions/20260903-portal audit, defect 1): the Hours tile is now
// wired to real minutes rather than a permanent placeholder.
//
// F107 round 2 (missions/20260903-portal, coordinator review): the
// "Waiting on you" tile is removed -- `WaitingOnYouBlock` (rendered
// above this strip on the Overview page, its own component/test file)
// already names the same rows with age and an inline action, and the
// tile restated only their bare count. Three tiles remain.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { OverviewTiles } from "@/components/portal/overview-tiles";

afterEach(() => {
  cleanup();
});

const BASE_PROPS = {
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

  it("renders a real pages-ready fraction and days-to-launch", () => {
    render(
      <OverviewTiles
        {...BASE_PROPS}
        pagesReadyCount={4}
        pagesTotalCount={9}
        daysToLaunch={15}
        launchConfidence="at_risk"
      />,
    );

    expect(screen.getByTestId("tile-pages-ready")).toHaveTextContent("4 / 9");
    expect(screen.getByTestId("tile-days-to-launch")).toHaveTextContent("15");
    expect(screen.getByTestId("tile-days-to-launch")).toHaveTextContent("At risk");
  });

  it("shows an honest placeholder, not a fabricated fraction, when there are no pages yet", () => {
    render(
      <OverviewTiles
        {...BASE_PROPS}
        pagesReadyCount={0}
        pagesTotalCount={0}
        daysToLaunch={null}
        launchConfidence={null}
        pagesStatusDistribution={{ done: 0, progress: 0, waiting: 0, blocked: 0 }}
      />,
    );

    expect(screen.getByTestId("tile-pages-ready")).toHaveTextContent("—");
    expect(screen.getByTestId("tile-days-to-launch")).toHaveTextContent("—");
    expect(screen.getByTestId("tile-days-to-launch")).toHaveTextContent(
      "Launch date not set yet",
    );
  });

  // F115 round 2 (coordinator review): a launched project's tile must
  // not still read "Days to launch · Passed · On track" -- future-tense
  // copy about a live site.
  it("test_AS_days_to_launch_tile_reads_honestly_after_launch", () => {
    render(<OverviewTiles {...BASE_PROPS} daysToLaunch={-10} launchConfidence="on_track" />);

    const tile = screen.getByTestId("tile-days-to-launch");
    expect(tile).toHaveTextContent("Days since launch");
    expect(tile).toHaveTextContent("10");
    expect(tile).toHaveTextContent("Launched");
    expect(tile).not.toHaveTextContent("Passed");
    expect(tile).not.toHaveTextContent("On track");
    expect(tile).not.toHaveTextContent("Days to launch");
  });

  // F107 round 2: no fourth tile restates the "What we need from you"
  // block's own count -- the strip is exactly three tiles now.
  it("test_no_waiting_on_you_tile_renders_in_the_tile_strip", () => {
    render(<OverviewTiles {...BASE_PROPS} />);

    expect(screen.queryByTestId("tile-waiting-on-you")).toBeNull();
    const strip = screen.getByTestId("overview-tiles");
    // Direct children only -- nested chart testids (`tile-sparkline`,
    // `tile-pages-distribution`) also match a `^tile-` prefix and are
    // not tiles themselves.
    expect(strip.children).toHaveLength(3);
  });

  // F107 round 4 (coordinator review): a two-column tier between mobile
  // and desktop orphaned the third tile alone on its own row. The strip
  // must go straight from one column to three -- never a two-column
  // class anywhere in its className -- so three tiles can never split
  // 2-and-1 at any breakpoint.
  it("test_tile_strip_has_no_two_column_breakpoint_that_would_orphan_the_third_tile", () => {
    render(<OverviewTiles {...BASE_PROPS} />);

    const strip = screen.getByTestId("overview-tiles");
    expect(strip.className).not.toMatch(/grid-cols-2\b/);
    expect(strip.className).toMatch(/grid-cols-1\b/);
    expect(strip.className).toMatch(/grid-cols-3\b/);
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

  // Paket D (billing_model gating follow-up): a fixed-price project has
  // no hourly billing to show a client -- the Hours tile, the same leak
  // BudgetBar was flagged for on this same Overview page, is omitted
  // entirely rather than rendered with hidden/zeroed numbers.
  describe("fixed-price billing (showHoursTile=false)", () => {
    it("does not render the Hours used tile", () => {
      render(<OverviewTiles {...BASE_PROPS} showHoursTile={false} />);

      expect(screen.queryByTestId("tile-hours-used")).toBeNull();
    });

    it("still renders the other two tiles", () => {
      render(<OverviewTiles {...BASE_PROPS} showHoursTile={false} />);

      expect(screen.getByTestId("tile-pages-ready")).toBeInTheDocument();
      expect(screen.getByTestId("tile-days-to-launch")).toBeInTheDocument();
      const strip = screen.getByTestId("overview-tiles");
      expect(strip.children).toHaveLength(2);
    });

    it("uses a two-column grid, never a three-column class, with only two tiles", () => {
      render(<OverviewTiles {...BASE_PROPS} showHoursTile={false} />);

      const strip = screen.getByTestId("overview-tiles");
      expect(strip.className).toMatch(/grid-cols-2\b/);
      expect(strip.className).not.toMatch(/grid-cols-3\b/);
    });

    it("defaults to showing the Hours tile when showHoursTile is omitted (hourly projects unaffected)", () => {
      render(<OverviewTiles {...BASE_PROPS} />);

      expect(screen.getByTestId("tile-hours-used")).toBeInTheDocument();
    });
  });
});
