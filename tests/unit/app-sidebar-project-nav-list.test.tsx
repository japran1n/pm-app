// @vitest-environment jsdom
//
// F262 (AS-509, AS-511, AS-512, AS-513): the sidebar's own "Projects"
// section.
//
// AS-509: the sidebar lists the workspace's projects, not just a link to
//   the projects page.
// AS-511: the current project (matched from the URL via usePathname) is
//   highlighted.
// AS-512: the project list has its own bounded, internally-scrolling
//   container so it never displaces the primary nav items.
// AS-513: a workspace with zero projects shows a create-project action
//   inline in the section (reusing the existing NewProjectDialog, not a
//   new dialog).

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/w/acme/projects/p2/board",
}));

// NewProjectDialog pulls in Server Actions (createProject,
// createProjectFromTemplate) that aren't meaningful in a unit test render
// -- stub it to a simple marker so AS-513 can assert it is the thing
// rendered in the empty state, without exercising its own internals
// (that dialog's own tests, if any, cover those).
vi.mock("@/components/new-project-dialog", () => ({
  NewProjectDialog: ({ workspaceId }: { workspaceId: string }) =>
    createElement(
      "button",
      { type: "button", "data-testid": "new-project-dialog-stub" },
      `New Project (${workspaceId})`,
    ),
}));

import { ProjectNavList } from "@/components/nav/project-nav-list";
import { AppSidebar } from "@/components/nav/app-sidebar";

afterEach(() => {
  cleanup();
});

const baseSidebarProps = {
  workspaceSlug: "acme",
  workspaces: [{ id: "w1", name: "Acme", slug: "acme" }],
  currentWorkspaceId: "w1",
  currentUser: {
    id: "u1",
    name: "Test User",
    email: "test@example.com",
    avatarUrl: null,
  },
};

describe("ProjectNavList (F262)", () => {
  it("AS-509: lists every project passed in, with its key", () => {
    render(
      createElement(ProjectNavList, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        projects: [
          { id: "p1", name: "Marketing Site", key: "MS" },
          { id: "p2", name: "Mobile App", key: "MA" },
        ],
      }),
    );

    // UI polish: the row no longer displays the project's key
    // abbreviation (or an icon/colour dot) -- just the name.
    expect(screen.getByText("Marketing Site")).toBeInTheDocument();
    expect(screen.getByText("Mobile App")).toBeInTheDocument();
    expect(screen.queryByText("MS")).not.toBeInTheDocument();
    expect(screen.queryByText("MA")).not.toBeInTheDocument();
  });

  it("AS-511: the project matching the current pathname is highlighted (aria-current)", () => {
    render(
      createElement(ProjectNavList, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        projects: [
          { id: "p1", name: "Marketing Site", key: "MS" },
          { id: "p2", name: "Mobile App", key: "MA" },
        ],
      }),
    );

    // usePathname is mocked to "/w/acme/projects/p2/board" above.
    const activeLink = screen.getByRole("link", { name: /Mobile App/ });
    expect(activeLink).toHaveAttribute("aria-current", "page");

    const inactiveLink = screen.getByRole("link", { name: /Marketing Site/ });
    expect(inactiveLink).not.toHaveAttribute("aria-current");
  });

  it("AS-512: the project list renders inside its own bounded, scrollable container, separate from any pinned nav", () => {
    const { container } = render(
      createElement(ProjectNavList, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        projects: [
          { id: "p1", name: "Marketing Site", key: "MS" },
          { id: "p2", name: "Mobile App", key: "MA" },
        ],
      }),
    );

    // Per commit 94c95a9: the redundant inner `max-h-64` cap on the `<nav>`
    // itself was removed (it forced a scrollbar for as few as 4-5 projects
    // even with free space below). AS-512's actual mechanism is the outer
    // CollapsibleContent wrapper's own `min-h-0 overflow-y-auto`, which is
    // what bounds this section within the sidebar's remaining flex space --
    // assert against that real scroll container instead of the inner `<nav>`.
    const list = container.querySelector('nav[aria-label="Projects"]');
    expect(list).toBeTruthy();

    const scrollContainer = list?.closest('[class*="overflow-y-auto"]');
    expect(scrollContainer).toBeTruthy();
    expect(scrollContainer?.className).toContain("overflow-y-auto");
    expect(scrollContainer?.className).toContain("min-h-0");
  });

  it("AS-513: zero projects shows a create-project action inline, not just empty space", () => {
    render(
      createElement(ProjectNavList, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        projects: [],
      }),
    );

    expect(screen.getByText(/no projects yet/i)).toBeInTheDocument();
    expect(screen.getByTestId("new-project-dialog-stub")).toBeInTheDocument();
  });
});

// Static markup (same pattern as tests/unit/app-sidebar-archive-nav.test.tsx
// etc.): AppSidebar mounts NotificationBell, whose realtime effect needs a
// real Supabase client -- irrelevant to this feature and not something this
// worker's scope covers re-mocking. A full DOM render is not needed here;
// the assertions below only need the rendered HTML.
describe("AppSidebar renders the Projects section (F262)", () => {
  it("AS-509: passes the workspace's projects through into the sidebar", () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, {
        ...baseSidebarProps,
        projects: [{ id: "p1", name: "Marketing Site", key: "MS" }],
      }),
    );

    expect(html).toContain("Marketing Site");
  });

  it("AS-513: an empty project list still renders the create action, and primary nav stays present", () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, { ...baseSidebarProps, projects: [] }),
    );

    expect(html).toContain("new-project-dialog-stub");
    // Primary nav items are unaffected by an empty Projects section.
    expect(html).toContain("Dashboard");
    expect(html).toContain("My Tasks");
  });
});
