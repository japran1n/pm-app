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

  // F06 (missions/20260919-staging-preview, SP-041): the "Preview" nav
  // row is omitted by default -- a caller that forgets to pass
  // `hasStagingPreview` hides the item rather than showing it wrongly.
  it("test_SP_041_omits_preview_by_default", () => {
    const items = buildPortalProjectNavItems("/portal/acme/p/proj-1", "fixed_price");
    expect(items.map((item) => item.key)).not.toContain("staging");
    expect(items).toHaveLength(7);
  });

  it("test_SP_041_includes_preview_labelled_between_site_map_and_your_site_when_flag_is_true", () => {
    const items = buildPortalProjectNavItems("/portal/acme/p/proj-1", "fixed_price", true);
    const keys = items.map((item) => item.key);
    expect(keys.indexOf("architecture")).toBeLessThan(keys.indexOf("staging"));
    expect(keys.indexOf("staging")).toBeLessThan(keys.indexOf("site"));

    const preview = items.find((item) => item.key === "staging");
    expect(preview?.label).toBe("Preview");
    expect(preview?.href).toBe("/portal/acme/p/proj-1/staging");
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

  // F016 (AS-016): M2 scrutiny found the group only expanded for routes
  // `buildPortalProjectNavItems` happens to list -- `/files` and the
  // task-detail route `/t/[taskId]` are real routes under this shell with
  // no nav-item entry of their own, so they never expanded the group.
  // Fixed by detecting via route PREFIX instead of a per-item lookup.
  it("test_AS_016_the_project_group_expands_on_the_files_route_with_no_child_marked_current", () => {
    mockPathname = "/portal/acme/p/proj-1/files";
    const html = renderToStaticMarkup(createElement(PortalSidebar, baseProps));
    const buttons = html.match(/<button\b[^>]*>/g) ?? [];
    const projectToggles = buttons.filter((tag) => tag.includes('aria-expanded="true"'));
    expect(projectToggles.length).toBeGreaterThanOrEqual(2);

    const anchors = anchorTags(html);
    const anyChildCurrent = anchors.some(
      (tag) =>
        tag.includes('href="/portal/acme/p/proj-1/') && tag.includes('aria-current="page"'),
    );
    expect(anyChildCurrent).toBe(false);
  });

  it("test_AS_016_the_project_group_expands_on_a_task_detail_route_with_no_child_marked_current", () => {
    mockPathname = "/portal/acme/p/proj-1/t/abc";
    const html = renderToStaticMarkup(createElement(PortalSidebar, baseProps));
    const buttons = html.match(/<button\b[^>]*>/g) ?? [];
    const projectToggles = buttons.filter((tag) => tag.includes('aria-expanded="true"'));
    expect(projectToggles.length).toBeGreaterThanOrEqual(2);

    const anchors = anchorTags(html);
    const anyChildCurrent = anchors.some(
      (tag) =>
        tag.includes('href="/portal/acme/p/proj-1/') && tag.includes('aria-current="page"'),
    );
    expect(anyChildCurrent).toBe(false);
  });

  it("test_AS_016_the_project_group_does_not_expand_on_for_you_or_conversation", () => {
    for (const path of ["/portal/acme/p/proj-1/for-you", "/portal/acme/p/proj-1/conversation"]) {
      mockPathname = path;
      const html = renderToStaticMarkup(createElement(PortalSidebar, baseProps));
      const buttons = html.match(/<button\b[^>]*>/g) ?? [];
      const projectToggles = buttons.filter((tag) => tag.includes("aria-expanded"));
      expect(projectToggles.every((tag) => tag.includes('aria-expanded="false"'))).toBe(true);
    }
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

  it("test_AS_014_mobile_top_level_rows_size_to_content_with_full_labels_and_no_chevron", () => {
    mockPathname = "/portal/acme/p/proj-1";
    const html = renderToStaticMarkup(createElement(PortalSidebar, baseProps));

    const mobileMarkerIndex = html.indexOf("md:hidden");
    expect(mobileMarkerIndex).toBeGreaterThan(-1);
    const mobileHtml = html.slice(mobileMarkerIndex);

    // F020b (AS-014, UX-validator followup): mobile rows size to their
    // own content -- no `flex-1`/`basis-0` (which stretched short labels
    // and squeezed/truncated longer ones) and no `truncate` on the
    // label, so all four labels render in full at 360px.
    for (const label of ["Home", "For you", "Messages"]) {
      expect(mobileHtml).toContain(`>${label}<`);
    }
    const mobileHomeAnchor = anchorTags(mobileHtml).find((tag) =>
      tag.includes('href="/portal/acme/p/proj-1"'),
    );
    expect(mobileHomeAnchor).not.toContain("flex-1");
    expect(mobileHomeAnchor).not.toContain("basis-0");
    expect(mobileHomeAnchor).toContain("h-10");
    expect(mobileHomeAnchor).toContain("text-sm");
    expect(mobileHomeAnchor).toContain("shrink-0");

    const mobileForYouAnchor = anchorTags(mobileHtml).find((tag) =>
      tag.includes('href="/portal/acme/p/proj-1/for-you"'),
    );
    expect(mobileForYouAnchor).not.toContain("truncate");

    // The "Project" toggle button carries the same content-sized mobile
    // classes, and drops the chevron glyph entirely on mobile (state is
    // still exposed via `aria-expanded`).
    const mobileButtons = mobileHtml.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
    const projectButton = mobileButtons.find((tag) => tag.includes(">Project<"));
    expect(projectButton).toBeDefined();
    expect(projectButton).toContain("h-10");
    expect(projectButton).not.toContain("flex-1");
    expect(projectButton).not.toContain("basis-0");
    expect(projectButton).not.toContain("rotate-180");
    expect(projectButton?.match(/<svg/g)?.length).toBe(1);
  });

  it("test_AS_014_mobile_project_children_render_in_a_separate_panel_below_the_row", () => {
    mockPathname = "/portal/acme/p/proj-1/results";
    const html = renderToStaticMarkup(createElement(PortalSidebar, baseProps));

    const mobileMarkerIndex = html.indexOf("md:hidden");
    expect(mobileMarkerIndex).toBeGreaterThan(-1);
    const mobileHtml = html.slice(mobileMarkerIndex);

    // The Project button and its expanded children must NOT share a
    // parent with the other three top-level rows (that inline layout is
    // what squeezed "Project" down to an icon once children appeared).
    const topLevelRowIndex = mobileHtml.indexOf("overflow-x-auto");
    const navCloseIndex = mobileHtml.indexOf("</nav>", topLevelRowIndex);
    const topLevelRowHtml = mobileHtml.slice(topLevelRowIndex, navCloseIndex);
    expect(topLevelRowHtml).not.toContain(">Site map<");

    // The children panel appears as its own container after the
    // top-level row closes.
    const afterTopLevelRow = mobileHtml.slice(navCloseIndex);
    expect(afterTopLevelRow).toContain(">Site map<");
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

  // F06 (missions/20260919-staging-preview, SP-041)
  it("test_SP_041_preview_row_is_absent_by_default", () => {
    mockPathname = "/portal/acme/p/proj-1";
    const html = renderToStaticMarkup(createElement(PortalSidebar, baseProps));
    expect(anchorTags(html).some((tag) => tag.includes('href="/portal/acme/p/proj-1/staging"'))).toBe(
      false,
    );
  });

  it("test_SP_041_preview_row_renders_when_hasStagingPreview_is_true", () => {
    // A project-group child route so the group is expanded and its rows
    // (including "Preview") actually render -- same reason the "Hours"
    // test above (`test_AS_014_hours_appears_only_for_hourly_projects`)
    // points `mockPathname` at `/hours`/`/pages` rather than the
    // top-level route.
    mockPathname = "/portal/acme/p/proj-1/pages";
    const html = renderToStaticMarkup(
      createElement(PortalSidebar, { ...baseProps, hasStagingPreview: true }),
    );
    expect(anchorTags(html).some((tag) => tag.includes('href="/portal/acme/p/proj-1/staging"'))).toBe(
      true,
    );
    expect(html).toContain(">Preview<");
  });

  // F07 (missions/20260919-staging-preview, SP-052): the rendered sidebar
  // markup -- not just the `buildPortalProjectNavItems` array -- must put
  // "Preview" after "Site map" and before "Your site".
  it("test_SP_052_preview_row_renders_between_site_map_and_your_site", () => {
    mockPathname = "/portal/acme/p/proj-1/pages";
    const html = renderToStaticMarkup(
      createElement(PortalSidebar, { ...baseProps, hasStagingPreview: true }),
    );
    const anchors = anchorTags(html);
    const hrefIndex = (href: string) =>
      anchors.findIndex((tag) => tag.includes(`href="${href}"`));

    const architectureIndex = hrefIndex("/portal/acme/p/proj-1/architecture");
    const stagingIndex = hrefIndex("/portal/acme/p/proj-1/staging");
    const siteIndex = hrefIndex("/portal/acme/p/proj-1/site");

    expect(architectureIndex).toBeGreaterThan(-1);
    expect(stagingIndex).toBeGreaterThan(-1);
    expect(siteIndex).toBeGreaterThan(-1);
    expect(architectureIndex).toBeLessThan(stagingIndex);
    expect(stagingIndex).toBeLessThan(siteIndex);
  });
});
