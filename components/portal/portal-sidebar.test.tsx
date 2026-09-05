// F003 (missions/20260903-portal, AS-001, AS-004): the portal sidebar's
// own eight-item nav list, its ordering/labels, and the active-item
// marker `usePathname` drives. Rendered with `renderToStaticMarkup`
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
  buildPortalSecondaryNavItems,
} from "@/components/portal/portal-sidebar";

const baseProps = {
  workspaceSlug: "acme",
  workspaceId: "ws-1",
  workspaceName: "Acme",
  workspaceLogoUrl: null,
  projectId: "proj-1",
  projectName: "Website redesign",
  hasMultipleProjects: false,
  badges: { approvalsAwaiting: { ok: true as const, data: 0 }, deliverablesPastDue: 0 },
  currentUser: { id: "u1", name: "Jamie Client", email: "jamie@example.com", avatarUrl: null },
};

const EXPECTED_LABELS = [
  "Overview",
  "Approvals",
  "Your list",
  "Pages",
  "Hours",
  "Results",
  "Scope & decisions",
  "Your site",
];

// renderToStaticMarkup HTML-escapes text content ("&" -> "&amp;") and
// Next's <Link> does not guarantee any particular attribute emission
// order on the underlying <a> -- so tests below match on this list
// (escaped for text-content checks) and extract whole <a ...> tags
// rather than assuming "href=... aria-current=..." appear adjacently in
// a fixed order.
const EXPECTED_LABELS_HTML = EXPECTED_LABELS.map((label) =>
  label.replace(/&/g, "&amp;"),
);

function anchorTags(html: string): string[] {
  return html.match(/<a\b[^>]*>/g) ?? [];
}

describe("PortalSidebar (F003)", () => {
  it("test_AS_001_lists_all_eight_views_in_order", () => {
    const items = buildPortalNavItems("/portal/acme/p/proj-1", {
      approvalsAwaiting: { ok: true, data: 0 },
      deliverablesPastDue: 0,
    });

    expect(items.map((item) => item.label)).toEqual(EXPECTED_LABELS);
  });

  it("test_AS_001_renders_a_persistent_sidebar_with_every_view_reachable_by_a_distinct_url", () => {
    mockPathname = "/portal/acme/p/proj-1";
    const html = renderToStaticMarkup(createElement(PortalSidebar, baseProps));

    const expectedHrefs = [
      "/portal/acme/p/proj-1",
      "/portal/acme/p/proj-1/approvals",
      "/portal/acme/p/proj-1/your-list",
      "/portal/acme/p/proj-1/pages",
      "/portal/acme/p/proj-1/hours",
      "/portal/acme/p/proj-1/results",
      "/portal/acme/p/proj-1/scope",
      "/portal/acme/p/proj-1/site",
    ];

    for (const label of EXPECTED_LABELS_HTML) {
      expect(html).toContain(label);
    }
    const anchors = anchorTags(html);
    for (const href of expectedHrefs) {
      // AS-004: every view lives at its own real URL (a Link, not a
      // client-side tab switch) -- distinct hrefs are what makes the
      // browser's own back button (and bookmarking, and reload) work
      // for each view.
      expect(anchors.some((tag) => tag.includes(`href="${href}"`))).toBe(true);
    }
  });

  it("test_AS_004_marks_only_the_current_view_aria_current", () => {
    mockPathname = "/portal/acme/p/proj-1/approvals";
    const html = renderToStaticMarkup(createElement(PortalSidebar, baseProps));
    const anchors = anchorTags(html);

    // Two renditions of the nav exist (desktop aside + mobile horizontal
    // strip), so "Approvals" appears twice with aria-current="page" and
    // every other item appears twice without it.
    const approvalsCurrent = anchors.filter(
      (tag) =>
        tag.includes('href="/portal/acme/p/proj-1/approvals"') &&
        tag.includes('aria-current="page"'),
    );
    expect(approvalsCurrent).toHaveLength(2);

    const overviewCurrent = anchors.filter(
      (tag) =>
        tag.includes('href="/portal/acme/p/proj-1"') &&
        tag.includes('aria-current="page"'),
    );
    expect(overviewCurrent).toHaveLength(0);
  });

  it("test_AS_004_overview_is_active_only_at_the_exact_project_root", () => {
    // Overview's href (`basePath`) is a PREFIX of every other item's href
    // (`${basePath}/approvals`, etc). Without an exact match, Overview
    // would incorrectly render as active on every other view too.
    mockPathname = "/portal/acme/p/proj-1/hours";
    const html = renderToStaticMarkup(createElement(PortalSidebar, baseProps));
    const anchors = anchorTags(html);

    const overviewCurrent = anchors.filter(
      (tag) =>
        tag.includes('href="/portal/acme/p/proj-1"') &&
        tag.includes('aria-current="page"'),
    );
    expect(overviewCurrent).toHaveLength(0);
  });

  // Not an F003 assertion (AS-002/AS-003 -- the badges' own live counts --
  // belong to F006/F007/F012); this only proves the shell renders a
  // count it is GIVEN, since F003's own contract is "badge counts come
  // from one server query, passed down as props" (this feature's spec,
  // section 3).
  // F085 (missions/20260903-portal audit, layout defect): `w-full` on
  // every row inside the mobile `overflow-x-auto` horizontal strip meant
  // each item claimed 100% of the flex row's width, so only the first
  // item was ever visible at a narrow viewport. Desktop rows still carry
  // `w-full` (correct there -- a vertical list should fill the sidebar);
  // mobile rows must not.
  it("test_AS_085_mobile_nav_rows_do_not_carry_w_full_but_desktop_rows_do", () => {
    mockPathname = "/portal/acme/p/proj-1";
    const html = renderToStaticMarkup(createElement(PortalSidebar, baseProps));

    // Split the markup at the mobile-strip marker (`md:hidden`) -- every
    // anchor before it is the desktop `<aside>`'s, every anchor after is
    // the mobile strip's.
    const mobileMarkerIndex = html.indexOf("md:hidden");
    expect(mobileMarkerIndex).toBeGreaterThan(-1);
    const desktopHtml = html.slice(0, mobileMarkerIndex);
    const mobileHtml = html.slice(mobileMarkerIndex);

    const desktopOverviewAnchor = anchorTags(desktopHtml).find((tag) =>
      tag.includes('href="/portal/acme/p/proj-1"'),
    );
    const mobileOverviewAnchor = anchorTags(mobileHtml).find((tag) =>
      tag.includes('href="/portal/acme/p/proj-1"'),
    );

    expect(desktopOverviewAnchor).toContain("w-full");
    expect(mobileOverviewAnchor).not.toContain("w-full");
  });

  it("renders a nonzero badge count using the shared Badge component", () => {
    mockPathname = "/portal/acme/p/proj-1";
    const html = renderToStaticMarkup(
      createElement(PortalSidebar, {
        ...baseProps,
        badges: { approvalsAwaiting: { ok: true, data: 2 }, deliverablesPastDue: 3 },
      }),
    );

    expect(html).toContain(">2<");
    expect(html).toContain(">3<");
  });

  it("renders no badge at all when a count is zero (not a visible '0')", () => {
    mockPathname = "/portal/acme/p/proj-1";
    const html = renderToStaticMarkup(createElement(PortalSidebar, baseProps));

    expect(html).not.toContain(">0<");
  });

  // F006f (missions/20260903-portal, AS-002): a failed `approvalsAwaiting`
  // read must render the same way as "no badge for this item" -- never a
  // `0` a client cannot tell apart from a real "nothing pending".
  it("test_AS_002_renders_no_approvals_badge_at_all_when_the_count_failed_to_load", () => {
    mockPathname = "/portal/acme/p/proj-1";
    const html = renderToStaticMarkup(
      createElement(PortalSidebar, {
        ...baseProps,
        badges: {
          approvalsAwaiting: { ok: false, error: "boom" },
          deliverablesPastDue: 0,
        },
      }),
    );

    expect(html).not.toContain(">0<");

    const items = buildPortalNavItems("/portal/acme/p/proj-1", {
      approvalsAwaiting: { ok: false, error: "boom" },
      deliverablesPastDue: 0,
    });
    const approvalsItem = items.find((item) => item.key === "approvals");
    expect(approvalsItem?.badge).toBeUndefined();
  });
});

// F006e (missions/20260903-portal): TEMPORARY -- Files and Requests had
// no entry point anywhere in the portal (M6 in the M1 scrutiny report).
// F023 gave Files a permanent home inside "Your site" (per F003b's own
// spec) and removed its row here; Requests still awaits F016's "Scope &
// decisions" view, so its temporary row stays. These tests now assert
// the reduced, one-item stopgap and that `buildPortalNavItems`'s own
// eight-item contract is still untouched (so
// `test_AS_001_lists_all_eight_views_in_order` above keeps asserting
// exactly what AS-001's text says, unchanged).
describe("PortalSidebar temporary Requests entry (F006e, reduced by F023)", () => {
  it("test_AS_001_the_primary_eight_item_list_does_not_grow_to_include_the_temporary_entry", () => {
    const items = buildPortalNavItems("/portal/acme/p/proj-1", {
      approvalsAwaiting: { ok: true, data: 0 },
      deliverablesPastDue: 0,
    });

    expect(items).toHaveLength(8);
    expect(items.map((item) => item.label)).not.toContain("Files");
    expect(items.map((item) => item.label)).not.toContain("Requests");
  });

  it("the sidebar no longer renders a Files row (F023 relocated it into Your site)", () => {
    mockPathname = "/portal/acme/p/proj-1";
    const html = renderToStaticMarkup(createElement(PortalSidebar, baseProps));
    const anchors = anchorTags(html);

    expect(
      anchors.some((tag) => tag.includes('href="/portal/acme/p/proj-1/files"')),
    ).toBe(false);
  });

  it("test_AS_004_requests_is_reachable_by_a_distinct_url_from_the_sidebar", () => {
    mockPathname = "/portal/acme/p/proj-1";
    const html = renderToStaticMarkup(createElement(PortalSidebar, baseProps));
    const anchors = anchorTags(html);

    expect(
      anchors.some((tag) => tag.includes('href="/portal/acme/p/proj-1/requests"')),
    ).toBe(true);
    expect(html).toContain("Requests");
  });

  it("test_AS_004_the_temporary_entry_marks_itself_current_on_its_own_route", () => {
    mockPathname = "/portal/acme/p/proj-1/requests";
    const html = renderToStaticMarkup(createElement(PortalSidebar, baseProps));
    const anchors = anchorTags(html);

    const requestsCurrent = anchors.filter(
      (tag) =>
        tag.includes('href="/portal/acme/p/proj-1/requests"') &&
        tag.includes('aria-current="page"'),
    );
    expect(requestsCurrent).toHaveLength(2); // desktop + mobile renditions
  });

  it("builds the temporary Requests item plus the permanent Conversation item, at the given base path", () => {
    const items = buildPortalSecondaryNavItems("/portal/acme/p/proj-1");

    expect(items.map((item) => item.label)).toEqual(["Requests", "Conversation"]);
    expect(items.map((item) => item.href)).toEqual([
      "/portal/acme/p/proj-1/requests",
      "/portal/acme/p/proj-1/conversation",
    ]);
  });
});
