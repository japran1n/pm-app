// Mission 20260914-portal-simplify, F008 (AS-014, AS-015, AS-016): the
// portal sidebar's simplified four-item nav -- Home, For you, Messages,
// and an expandable "Project" group. Rendered with `renderToStaticMarkup`
// (no jsdom) and a mocked `next/navigation`, the same shape
// `tests/unit/app-sidebar-trash-nav.test.tsx` already established for
// the team app's own sidebar.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

let mockPathname = "/portal/acme/p/proj-1";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

import {
  PortalSidebar,
  buildPortalNavItems,
  buildPortalProjectNavItems,
  type PortalForYouBadge,
} from "@/components/portal/portal-sidebar";

const okBadge: PortalForYouBadge = { ok: true, total: 0, overdue: 0 };

const baseProps = {
  workspaceSlug: "acme",
  workspaceId: "ws-1",
  workspaceName: "Acme",
  workspaceLogoUrl: null,
  projectId: "proj-1",
  projectName: "Website redesign",
  hasMultipleProjects: false,
  forYouBadge: okBadge,
  billingModel: "hourly" as const,
  currentUser: { id: "u1", name: "Jamie Client", email: "jamie@example.com", avatarUrl: null },
};

function anchorTags(html: string): string[] {
  return html.match(/<a\b[^>]*>/g) ?? [];
}

describe("buildPortalNavItems (F008, AS-014)", () => {
  it("test_AS_014_lists_exactly_home_for_you_messages_in_order", () => {
    const items = buildPortalNavItems("/portal/acme/p/proj-1", okBadge);
    expect(items.map((item) => item.label)).toEqual(["Home", "For you", "Messages"]);
    expect(items.map((item) => item.href)).toEqual([
      "/portal/acme/p/proj-1",
      "/portal/acme/p/proj-1/for-you",
      "/portal/acme/p/proj-1/conversation",
    ]);
  });

  it("test_AS_014_home_is_exact_match_only", () => {
    const items = buildPortalNavItems("/portal/acme/p/proj-1", okBadge);
    const home = items.find((item) => item.key === "home");
    expect(home?.exact).toBe(true);
  });

  it("test_AS_007_for_you_badge_reflects_the_shared_waiting_on_you_total", () => {
    const items = buildPortalNavItems("/portal/acme/p/proj-1", {
      ok: true,
      total: 4,
      overdue: 0,
    });
    const forYou = items.find((item) => item.key === "for-you");
    expect(forYou?.badge).toBe(4);
    expect(forYou?.badgeTone).toBe("neutral");
  });

  it("test_AS_007_for_you_badge_is_danger_toned_when_something_is_overdue", () => {
    const items = buildPortalNavItems("/portal/acme/p/proj-1", {
      ok: true,
      total: 4,
      overdue: 1,
    });
    const forYou = items.find((item) => item.key === "for-you");
    expect(forYou?.badgeTone).toBe("danger");
  });

  it("test_AS_007_for_you_badge_renders_no_number_when_the_read_failed", () => {
    const items = buildPortalNavItems("/portal/acme/p/proj-1", { ok: false });
    const forYou = items.find((item) => item.key === "for-you");
    expect(forYou?.badge).toBeUndefined();
  });
});

describe("buildPortalProjectNavItems (F008, AS-014, AS-015)", () => {
  it("test_AS_014_lists_the_project_group_children_in_order_including_hours_when_hourly", () => {
    const items = buildPortalProjectNavItems("/portal/acme/p/proj-1", "hourly");
    expect(items.map((item) => item.label)).toEqual([
      "Pages",
      "Site map",
      "Your site",
      "Scope & decisions",
      "Results",
      "Hours",
      "Questionnaire",
      "How we work",
    ]);
  });

  it("test_AS_014_omits_hours_for_a_fixed_price_project", () => {
    const items = buildPortalProjectNavItems("/portal/acme/p/proj-1", "fixed_price");
    expect(items.map((item) => item.label)).not.toContain("Hours");
    expect(items).toHaveLength(7);
  });

  it("test_AS_014_defaults_to_fixed_price_hours_omitted_when_no_billing_model_is_passed", () => {
    const items = buildPortalProjectNavItems("/portal/acme/p/proj-1");
    expect(items.map((item) => item.label)).not.toContain("Hours");
  });

  it("test_AS_015_results_and_questionnaire_are_reachable_from_the_project_group", () => {
    const items = buildPortalProjectNavItems("/portal/acme/p/proj-1", "fixed_price");
    expect(items.find((item) => item.key === "results")?.href).toBe(
      "/portal/acme/p/proj-1/results",
    );
    expect(items.find((item) => item.key === "brief")?.href).toBe(
      "/portal/acme/p/proj-1/brief",
    );
  });

  it("architecture is labelled Site map in the portal", () => {
    const items = buildPortalProjectNavItems("/portal/acme/p/proj-1", "fixed_price");
    const siteMap = items.find((item) => item.key === "architecture");
    expect(siteMap?.label).toBe("Site map");
    expect(siteMap?.href).toBe("/portal/acme/p/proj-1/architecture");
  });
});

describe("PortalSidebar (F008)", () => {
  it("test_AS_014_renders_exactly_home_for_you_messages_project_at_the_top_level", () => {
    mockPathname = "/portal/acme/p/proj-1";
    const html = renderToStaticMarkup(createElement(PortalSidebar, baseProps));

    for (const label of ["Home", "For you", "Messages", "Project"]) {
      expect(html).toContain(label);
    }
    // The old top-level items are gone entirely.
    expect(html).not.toContain(">Approvals<");
    expect(html).not.toContain(">Your list<");
    expect(html).not.toContain(">Requests<");
    expect(html).not.toContain(">Conversation<");
    expect(html).not.toContain(">Overview<");
  });

  it("test_AS_014_hours_appears_only_for_hourly_projects", () => {
    mockPathname = "/portal/acme/p/proj-1/hours";
    const hourlyHtml = renderToStaticMarkup(
      createElement(PortalSidebar, { ...baseProps, billingModel: "hourly" }),
    );
    expect(anchorTags(hourlyHtml).some((tag) => tag.includes('href="/portal/acme/p/proj-1/hours"'))).toBe(
      true,
    );

    mockPathname = "/portal/acme/p/proj-1/pages";
    const fixedHtml = renderToStaticMarkup(
      createElement(PortalSidebar, { ...baseProps, billingModel: "fixed_price" }),
    );
    expect(anchorTags(fixedHtml).some((tag) => tag.includes('href="/portal/acme/p/proj-1/hours"'))).toBe(
      false,
    );
  });

  it("test_AS_016_the_project_group_is_expanded_and_the_child_marked_current_on_a_child_route", () => {
    mockPathname = "/portal/acme/p/proj-1/results";
    const html = renderToStaticMarkup(createElement(PortalSidebar, baseProps));
    const anchors = anchorTags(html);

    // desktop + mobile renditions
    const buttons = html.match(/<button\b[^>]*>/g) ?? [];
    const projectToggles = buttons.filter((tag) => tag.includes('aria-expanded="true"'));
    expect(projectToggles.length).toBeGreaterThanOrEqual(2);

    const resultsCurrent = anchors.filter(
      (tag) =>
        tag.includes('href="/portal/acme/p/proj-1/results"') &&
        tag.includes('aria-current="page"'),
    );
    expect(resultsCurrent).toHaveLength(2);
  });

  it("test_AS_016_the_project_group_expands_on_a_nested_child_route", () => {
    mockPathname = "/portal/acme/p/proj-1/pages/some-page-id";
    const html = renderToStaticMarkup(createElement(PortalSidebar, baseProps));
    const buttons = html.match(/<button\b[^>]*>/g) ?? [];
    const projectToggles = buttons.filter((tag) => tag.includes('aria-expanded="true"'));
    expect(projectToggles.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain(">Pages<");
  });

  it("test_AS_016_the_project_group_is_collapsed_by_default_off_a_child_route", () => {
    mockPathname = "/portal/acme/p/proj-1";
    const html = renderToStaticMarkup(createElement(PortalSidebar, baseProps));
    const buttons = html.match(/<button\b[^>]*>/g) ?? [];
    const projectToggles = buttons.filter(
      (tag) => tag.includes("aria-expanded"),
    );
    expect(projectToggles.length).toBeGreaterThanOrEqual(2);
    expect(projectToggles.every((tag) => tag.includes('aria-expanded="false"'))).toBe(true);
    // Collapsed: children are not in the markup at all.
    expect(html).not.toContain(">Site map<");
  });

  it("test_AS_014_home_is_active_only_at_the_exact_project_root", () => {
    mockPathname = "/portal/acme/p/proj-1/for-you";
    const html = renderToStaticMarkup(createElement(PortalSidebar, baseProps));
    const anchors = anchorTags(html);

    const homeCurrent = anchors.filter(
      (tag) =>
        tag.includes('href="/portal/acme/p/proj-1"') && tag.includes('aria-current="page"'),
    );
    expect(homeCurrent).toHaveLength(0);
  });

  it("test_AS_085_mobile_nav_rows_do_not_carry_w_full_but_desktop_rows_do", () => {
    mockPathname = "/portal/acme/p/proj-1";
    const html = renderToStaticMarkup(createElement(PortalSidebar, baseProps));

    const mobileMarkerIndex = html.indexOf("md:hidden");
    expect(mobileMarkerIndex).toBeGreaterThan(-1);
    const desktopHtml = html.slice(0, mobileMarkerIndex);
    const mobileHtml = html.slice(mobileMarkerIndex);

    const desktopHomeAnchor = anchorTags(desktopHtml).find((tag) =>
      tag.includes('href="/portal/acme/p/proj-1"'),
    );
    const mobileHomeAnchor = anchorTags(mobileHtml).find((tag) =>
      tag.includes('href="/portal/acme/p/proj-1"'),
    );

    expect(desktopHomeAnchor).toContain("w-full");
    expect(mobileHomeAnchor).not.toContain("w-full");
  });

  it("renders a nonzero For you badge count using the shared Badge component", () => {
    mockPathname = "/portal/acme/p/proj-1";
    const html = renderToStaticMarkup(
      createElement(PortalSidebar, {
        ...baseProps,
        forYouBadge: { ok: true, total: 5, overdue: 0 },
      }),
    );

    expect(html).toContain(">5<");
  });

  it("renders no badge at all when the count is zero (not a visible '0')", () => {
    mockPathname = "/portal/acme/p/proj-1";
    const html = renderToStaticMarkup(createElement(PortalSidebar, baseProps));

    expect(html).not.toContain(">0<");
  });

  it("test_AS_007_renders_no_for_you_badge_when_the_count_failed_to_load", () => {
    mockPathname = "/portal/acme/p/proj-1";
    const html = renderToStaticMarkup(
      createElement(PortalSidebar, { ...baseProps, forYouBadge: { ok: false } }),
    );

    expect(html).not.toContain(">0<");
  });
});
