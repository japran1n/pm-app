// @vitest-environment jsdom
//
// Mission 20260914-portal-simplify, F018 (UX validation defect,
// AS-007/AS-018): `PortalOverviewLive` used to render a live "Waiting on
// you" card alongside "Delivered this week" (F008, missions/20260903-portal).
// That card's own empty state ("Nothing waiting on you right now.") sat
// directly beneath Home's `WaitingOnYouCallout` ("N things are waiting on
// you") -- the same fact, restated, and able to disagree with the callout's
// own count. The card (and the realtime wiring that only ever fed it) is
// removed; these tests replace the old AS-018/AS-019/AS-020/AS-024
// (missions/20260903-portal) component tests, deriving from what the
// component still does: render the project's "Delivered this week" list
// from server-seeded props, nothing live, no "Waiting on you" text
// anywhere in its output.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { PortalOverviewLive } from "@/components/portal/portal-overview-live";
import type { PortalOverview } from "@/lib/queries/portal";

afterEach(() => {
  cleanup();
});

const baseOverview: PortalOverview = {
  waitingOnYou: [],
  deliveredThisWeek: [
    {
      id: "t1",
      title: "Ship homepage copy",
      projectId: "p1",
      projectName: "Website relaunch",
      dueDate: null,
      updatedAt: "2026-08-30T00:00:00Z",
    },
  ],
};

describe("PortalOverviewLive", () => {
  it("test_AS_018_never_renders_the_old_waiting_on_you_card_home_already_covers_it_with_the_callout", () => {
    render(
      <PortalOverviewLive workspaceSlug="acme" initialOverview={baseOverview} />,
    );

    // Neither the old card's heading nor its empty-state copy should ever
    // appear -- Home's `WaitingOnYouCallout` is the one place that fact is
    // stated now.
    expect(screen.queryByText("Waiting on you")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Nothing waiting on you right now."),
    ).not.toBeInTheDocument();
  });

  it("test_AS_007_renders_delivered_this_week_rows_from_server_seeded_props", () => {
    render(
      <PortalOverviewLive workspaceSlug="acme" initialOverview={baseOverview} />,
    );

    expect(screen.getByText("Delivered this week")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Ship homepage copy/i });
    expect(link).toHaveAttribute("href", "/portal/acme/p/p1/t/t1");
  });

  it("test_AS_007_renders_the_honest_empty_state_when_nothing_delivered", () => {
    render(
      <PortalOverviewLive
        workspaceSlug="acme"
        initialOverview={{ waitingOnYou: [], deliveredThisWeek: [] }}
      />,
    );

    expect(
      screen.getByText("Nothing delivered in the last 7 days."),
    ).toBeInTheDocument();
  });
});
