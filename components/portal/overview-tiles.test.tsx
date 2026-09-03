// @vitest-environment jsdom
//
// F006 (missions/20260903-portal): the overview's four tiles. Covers
// this feature's own "side-effect verification" definition of done
// directly: no fabricated figure anywhere on the page; the hours tile
// visibly says the data is not available yet, regardless of what other
// props this component receives.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { OverviewTiles } from "@/components/portal/overview-tiles";

afterEach(() => {
  cleanup();
});

describe("OverviewTiles", () => {
  it("test_hours_tile_never_renders_a_fabricated_number_regardless_of_other_props", () => {
    render(
      <OverviewTiles
        waitingOnYouCount={3}
        pagesReadyCount={5}
        pagesTotalCount={12}
        daysToLaunch={40}
        launchConfidence="on_track"
      />,
    );

    const hoursTile = screen.getByTestId("tile-hours-used");
    expect(hoursTile).toHaveTextContent("—");
    expect(hoursTile).toHaveTextContent("Available with the next release");
    // Never a digit anywhere in the hours tile.
    expect(hoursTile.textContent).not.toMatch(/\d/);
  });

  it("renders the waiting-on-you count and a real pages-ready fraction", () => {
    render(
      <OverviewTiles
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

  it("shows an honest placeholder, not a fabricated fraction, when there are no pages yet", () => {
    render(
      <OverviewTiles
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
    render(
      <OverviewTiles
        waitingOnYouCount={null}
        pagesReadyCount={4}
        pagesTotalCount={9}
        daysToLaunch={15}
        launchConfidence="at_risk"
      />,
    );

    const tile = screen.getByTestId("tile-waiting-on-you");
    expect(tile).toHaveTextContent("—");
    expect(tile).toHaveTextContent("We couldn't load this");
    expect(tile.textContent).not.toContain("0");
  });
});
