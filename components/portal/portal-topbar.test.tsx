// F003 (missions/20260903-portal, AS-004, AS-005): the topbar's view
// title (derived from the active nav item, same `usePathname` shape as
// `portal-sidebar.test.tsx`) and its two launch chips.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

let mockPathname = "/portal/acme/p/proj-1";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

import { PortalTopbar } from "@/components/portal/portal-topbar";

const baseProps = {
  workspaceSlug: "acme",
  projectId: "proj-1",
  projectName: "Website redesign",
  badges: { approvalsAwaiting: 0, deliverablesPastDue: 0 },
  targetLaunchDate: null as string | null,
  launchConfidence: null as "on_track" | "at_risk" | "slipped" | null,
};

describe("PortalTopbar (F003)", () => {
  it("test_AS_005_displays_the_projects_target_launch_date", () => {
    const html = renderToStaticMarkup(
      createElement(PortalTopbar, { ...baseProps, targetLaunchDate: "2026-11-03" }),
    );

    expect(html).toContain("3 Nov 2026");
  });

  it("test_AS_005_displays_the_projects_current_launch_confidence", () => {
    const html = renderToStaticMarkup(
      createElement(PortalTopbar, { ...baseProps, launchConfidence: "at_risk" }),
    );

    expect(html).toContain("At risk");
  });

  it("test_AS_005_shows_an_honest_placeholder_when_launch_data_is_not_set_yet", () => {
    const html = renderToStaticMarkup(createElement(PortalTopbar, baseProps));

    // Neither field is faked when the team hasn't set it -- an em dash,
    // not a made-up date or a default "On track".
    expect(html).toContain("—");
    expect(html).not.toContain("On track");
    expect(html).not.toContain("At risk");
    expect(html).not.toContain("Slipped");
  });

  it("test_AS_004_view_title_tracks_the_active_route", () => {
    mockPathname = "/portal/acme/p/proj-1/results";
    const html = renderToStaticMarkup(createElement(PortalTopbar, baseProps));

    expect(html).toContain("Results");

    mockPathname = "/portal/acme/p/proj-1";
    const overviewHtml = renderToStaticMarkup(createElement(PortalTopbar, baseProps));
    expect(overviewHtml).toContain("Overview");
  });
});
