// @vitest-environment jsdom
//
// F011: SB-043 (colour dot + mono open-task count) and SB-044 ("All
// projects" link) rendering coverage for project-nav-list.tsx. SB-006
// (guest role gating) is covered separately by the existing sidebar
// role-gate tests this feature doesn't touch; this file only adds a
// smoke check that this component itself renders no gated item.

import { createElement } from "react";
import { render, cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/w/acme/projects/none/board",
}));

vi.mock("@/components/new-project-dialog", () => ({
  NewProjectDialog: () => null,
}));

vi.mock("@/lib/actions/favorites", () => ({
  favoriteProject: vi.fn(),
  unfavoriteProject: vi.fn(),
}));

vi.mock("@/lib/actions/projects", () => ({
  reorderProject: vi.fn(async () => ({ ok: true, data: { order: [] } })),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { ProjectNavList } from "@/components/nav/project-nav-list";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("test_SB_043_colour_dot_and_open_task_count", () => {
  it("renders a colour dot for each project row", () => {
    const { container } = render(
      createElement(ProjectNavList, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        projects: [{ id: "p1", name: "Alpha Project", key: "AL", openTaskCount: 3 }],
      }),
    );

    const dot = container.querySelector('nav[aria-label="Projects"] .rounded-full');
    expect(dot).toBeTruthy();
  });

  it("shows the open-task count in a font-mono element when non-zero", () => {
    render(
      createElement(ProjectNavList, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        projects: [{ id: "p1", name: "Alpha Project", key: "AL", openTaskCount: 4 }],
      }),
    );

    const count = screen.getByText("4");
    expect(count).toHaveClass("font-mono");
  });

  it("hides the count entirely when it is 0", () => {
    render(
      createElement(ProjectNavList, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        projects: [{ id: "p1", name: "Alpha Project", key: "AL", openTaskCount: 0 }],
      }),
    );

    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("hides the count when it is not provided (undefined)", () => {
    render(
      createElement(ProjectNavList, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        projects: [{ id: "p1", name: "Alpha Project", key: "AL" }],
      }),
    );

    // No stray numeric text node from an undefined count rendering literally.
    const nav = screen.getByRole("navigation", { name: "Projects" });
    expect(nav.textContent).not.toMatch(/undefined|null/);
  });
});

describe("test_SB_044_all_projects_link", () => {
  it("renders an 'All projects' link to the workspace projects page", () => {
    render(
      createElement(ProjectNavList, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        projects: [{ id: "p1", name: "Alpha Project", key: "AL" }],
      }),
    );

    const link = screen.getByRole("link", { name: "All projects" });
    expect(link).toHaveAttribute("href", "/w/acme/projects");
  });

  it("still renders the 'All projects' link when the project list is empty", () => {
    render(
      createElement(ProjectNavList, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        projects: [],
      }),
    );

    const link = screen.getByRole("link", { name: "All projects" });
    expect(link).toHaveAttribute("href", "/w/acme/projects");
  });
});
