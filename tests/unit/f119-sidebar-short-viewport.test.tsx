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
  it("AS-069: every seeded project is present in the DOM even with a full primary nav", () => {
    const doc = renderHtml(manyProjects);
    const text = doc.body.textContent ?? "";

    // Primary nav items are all present (never cut off).
    expect(text).toContain("Dashboard");
    expect(text).toContain("My Tasks");
    expect(text).toContain("Projects");
    expect(text).toContain("Chat");
    expect(text).toContain("Trash");

    // Every one of the 20 seeded projects is reachable in the DOM -- not
    // silently dropped/cut off past the first couple of rows.
    for (const project of manyProjects) {
      expect(text).toContain(project.name);
    }
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
