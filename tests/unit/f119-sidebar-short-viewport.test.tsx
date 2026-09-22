// @vitest-environment jsdom
//
// F119 (AS-069): on a short/narrow viewport with the full ~12-item primary
// nav, the Projects section must be independently scrollable and every
// project must remain reachable -- not visually compressed/cut off with no
// scroll affordance. See this component's own AS-512 comment history
// (components/nav/app-sidebar.tsx, components/nav/project-nav-list.tsx) for
// the documented prior bug this must not reintroduce.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/w/acme/projects/p1/board",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

import { AppSidebar } from "@/components/nav/app-sidebar";

const baseProps = {
  workspaceSlug: "acme",
  workspaces: [{ id: "w1", name: "Acme", slug: "acme" }],
  currentWorkspaceId: "w1",
  currentUser: {
    id: "u1",
    name: "Test User",
    email: "test@example.com",
    avatarUrl: null,
  },
  isGuest: false,
  canManageWorkspace: true,
  requestsCount: 0,
  approvalsCount: 0,
};

// A workspace with many projects (more than would visibly fit in a short
// viewport's leftover space) -- every one must still be present in the DOM
// and reachable via the section's own scroll container.
const manyProjects = Array.from({ length: 20 }, (_, i) => ({
  id: `p${i}`,
  name: `Project ${i}`,
  key: `P${i}`,
}));

// Static markup (same pattern as tests/unit/app-sidebar-archive-nav.test.tsx
// etc.): AppSidebar mounts NotificationBell, whose realtime/data-fetching
// effects need a real Supabase/request context -- irrelevant to this
// feature and not something this worker's scope covers re-mocking. A full
// DOM render with effects is not needed here; the assertions below only
// need the rendered HTML, parsed via jsdom's DOMParser.
function renderHtml(projects: { id: string; name: string; key: string }[]) {
  const html = renderToStaticMarkup(
    createElement(AppSidebar, { ...baseProps, projects }),
  );
  return new DOMParser().parseFromString(html, "text/html");
}

describe("AppSidebar on a short viewport (F119, AS-069)", () => {
  // F040 (M3 scrutiny FU-2): AS-069's own text is "every project must
  // remain reachable -- not visually compressed/cut off with no scroll
  // affordance", not "every project's name is literally in the initial
  // DOM". Since F040 wired SB-042's "cap the no-favourites case at 5
  // recently-visited projects" into this render path, a zero-favourites,
  // zero-recent-history workspace with 20 projects no longer prints all 20
  // names directly in this section -- it renders this section's own empty
  // state instead (see project-nav-list.tsx's `isTrueEmptyRecents`) and
  // every project stays reachable one click away via the SB-044 "All
  // projects" link, which is what this test now asserts instead. This
  // keeps faith with AS-069's actual assertion (reachable, not cut off
  // with no way out) without reintroducing the "print all 20 names" shape
  // that SB-042 explicitly caps.
  it("AS-069: every seeded project remains reachable via the 'All projects' link even when the capped section doesn't list all of them", () => {
    const doc = renderHtml(manyProjects);
    const text = doc.body.textContent ?? "";

    // Primary nav items are all present (never cut off).
    expect(text).toContain("Dashboard");
    expect(text).toContain("My Tasks");
    expect(text).toContain("Projects");
    expect(text).toContain("Chat");
    // F003 (SB-016): "Trash" moved into AccountMenu (formerly the
    // sidebar's own "Other" group) and no longer renders in static
    // markup until that menu is opened. F013 (SB-057): "Watching" no
    // longer has its own sidebar item either (absorbed into the Inbox
    // tabs) -- "Chat" (asserted above) is this test's still-in-sidebar
    // item.

    // Every project remains reachable via the always-present "All
    // projects" link (SB-044), not necessarily printed directly in this
    // section's own (now-capped, per SB-042) list.
    const allProjectsLinks = Array.from(
      doc.querySelectorAll(`a[href="/w/acme/projects"]`),
    );
    const allProjectsLink = allProjectsLinks.find((link) =>
      link.textContent?.includes("All projects"),
    );
    expect(allProjectsLink).toBeTruthy();
  });

  it("AS-069: the Projects section has its own bounded, independently-scrolling container, distinct from the primary nav", () => {
    const doc = renderHtml(manyProjects);

    const projectsNav = doc.querySelector('nav[aria-label="Projects"]');
    expect(projectsNav).toBeTruthy();

    const scrollContainer = projectsNav?.closest('[class*="overflow-y-auto"]');
    expect(scrollContainer).toBeTruthy();
    expect(scrollContainer?.className).toContain("min-h-0");
    expect(scrollContainer?.className).toContain("flex-1");

    // The primary nav (data-tour="sidebar-nav") is a distinct element from
    // the Projects scroll container -- not nested inside it, and not
    // sharing the same scroll box (no double-scrollbar).
    const primaryNav = doc.querySelector('nav[data-tour="sidebar-nav"]');
    expect(primaryNav).toBeTruthy();
    expect(scrollContainer?.contains(primaryNav)).toBe(false);
    expect(primaryNav?.contains(scrollContainer as Node)).toBe(false);
  });

  it("AS-069 (regression guard): the primary nav itself carries no stray overflow-y-auto class directly on it (the previously-fixed BUGFIX case)", () => {
    const doc = renderHtml(manyProjects);

    const primaryNav = doc.querySelector('nav[data-tour="sidebar-nav"]');
    expect(primaryNav).toBeTruthy();
    expect(primaryNav?.className).not.toContain("overflow-y-auto");
  });
});
