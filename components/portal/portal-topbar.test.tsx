// F003 (missions/20260903-portal, AS-004, AS-005): the topbar's view
// title and its two launch chips.
//
// F006e (missions/20260903-portal, AS-004): the title used to be looked
// up in `buildPortalNavItems`'s eight-item list, so any route outside
// that list (files, requests, task detail) fell through to `items[0]`
// and always rendered "Overview" -- M7 in the M1 scrutiny report. These
// tests assert the fix directly: `resolvePortalStaticTitle`'s own
// per-route table plus its humanized fallback for a route neither list
// has ever heard of, and (the DoD's own "side-effect verification") that
// the eight primary views keep the labels they always had.
//
// `usePortalTitleOverride()` reads a Context with no Provider here (no
// `PortalTitleProvider` wraps these renders) -- `useContext` returns the
// context's default (`null`) in that case, so every test below exercises
// the route-derived static title, not the task-detail runtime override.
// That override (task detail showing the task's OWN title) is covered
// separately in `tests/unit/portal-title-context.test.tsx`, since proving
// it requires effects to actually run (a real mount, not
// `renderToStaticMarkup`).
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

let mockPathname = "/portal/acme/p/proj-1";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

import { PortalTopbar, resolvePortalStaticTitle } from "@/components/portal/portal-topbar";

const baseProps = {
  workspaceSlug: "acme",
  projectId: "proj-1",
  projectName: "Website redesign",
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

describe("resolvePortalStaticTitle (F006e)", () => {
  const basePath = "/portal/acme/p/proj-1";

  it("test_AS_004_titles_the_overview_route_at_the_exact_project_root", () => {
    expect(resolvePortalStaticTitle(basePath, basePath)).toBe("Overview");
  });

  // Side-effect verification (this feature's own DoD): the eight primary
  // views keep the exact labels `buildPortalNavItems` gives them, now
  // resolved independently rather than by looking that list up.
  it.each([
    ["approvals", "Approvals"],
    ["your-list", "Your list"],
    ["pages", "Pages"],
    ["hours", "Hours"],
    ["results", "Results"],
    ["scope", "Scope & decisions"],
    ["site", "Your site"],
  ])(
    "test_AS_004_keeps_the_primary_view_label_for_%s",
    (segment, expectedLabel) => {
      expect(resolvePortalStaticTitle(`${basePath}/${segment}`, basePath)).toBe(
        expectedLabel,
      );
    },
  );

  // Primary success test (this feature's own DoD): every route under the
  // shell renders a title that is not "Overview" unless it actually is
  // the overview -- files, requests and task detail were the three
  // regressed routes (M7).
  it("test_AS_004_titles_the_relocated_files_route_reachable_from_the_sidebar", () => {
    expect(resolvePortalStaticTitle(`${basePath}/files`, basePath)).toBe("Files");
  });

  it("test_AS_004_titles_the_relocated_requests_route_reachable_from_the_sidebar", () => {
    expect(resolvePortalStaticTitle(`${basePath}/requests`, basePath)).toBe("Requests");
  });

  it("test_AS_004_gives_the_task_detail_route_a_non_overview_placeholder_before_the_real_title_arrives", () => {
    // The real title (the task's own) only exists once
    // `PortalTaskTitleAnnouncer` runs -- see the jsdom test file. This is
    // the static fallback a server-rendered-only paint would show; it
    // must never be "Overview".
    expect(resolvePortalStaticTitle(`${basePath}/t/task-9`, basePath)).toBe("Task");
  });

  // Failure test (this feature's own DoD): a route neither
  // `buildPortalNavItems` nor `STATIC_ROUTE_TITLES` has ever heard of
  // still gets a real title, "by construction", instead of silently
  // falling back to "Overview".
  it("test_AS_004_humanizes_an_unlisted_route_instead_of_defaulting_to_overview", () => {
    expect(resolvePortalStaticTitle(`${basePath}/deliverables`, basePath)).toBe(
      "Deliverables",
    );
    expect(resolvePortalStaticTitle(`${basePath}/site-map`, basePath)).toBe(
      "Site Map",
    );
  });
});
