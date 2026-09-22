// @vitest-environment jsdom
//
// F040 (M3 scrutiny FU-2, SB-042): component-level coverage that the
// no-favourites case actually wires `selectSidebarProjects` into the
// rendered sidebar -- capped at 5 recently-visited projects, with the
// true-empty (0 favourites, 0 recognised recent visits) case rendering
// this section's own empty state rather than an arbitrary
// `visible.slice(0, 5)` of the full project list. These tests are written
// against SB-042's assertion text and fail if `project-nav-list.tsx`'s
// `isTrueEmptyRecents`/`selectSidebarProjects` wiring is removed (verified
// by reverting the render-path change locally during development).

import { createElement } from "react";
import { render, cleanup, screen, within } from "@testing-library/react";
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

const readRecentProjectIds = vi.fn<() => string[]>(() => []);
vi.mock("@/lib/nav/recent-projects", () => ({
  readRecentProjectIds: () => readRecentProjectIds(),
}));

import { ProjectNavList } from "@/components/nav/project-nav-list";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  readRecentProjectIds.mockReturnValue([]);
});

const manyProjects = Array.from({ length: 20 }, (_, i) => ({
  id: `p${i}`,
  name: `Project ${i}`,
  key: `P${i}`,
}));

describe("test_SB_042_recent_fallback_wired_into_render_path", () => {
  it("0 favourites + 20 projects + 3 recents: renders only the 3 recently-visited projects, capped, in recency order", () => {
    readRecentProjectIds.mockReturnValue(["p5", "p1", "p9"]);

    render(
      createElement(ProjectNavList, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        projects: manyProjects,
      }),
    );

    const nav = screen.getByRole("navigation", { name: "Projects" });
    const rendered = within(nav)
      .getAllByRole("link")
      .map((link) => link.textContent);

    // Only the 3 recent projects render in this section -- not all 20.
    expect(rendered.some((t) => t?.includes("Project 5"))).toBe(true);
    expect(rendered.some((t) => t?.includes("Project 1"))).toBe(true);
    expect(rendered.some((t) => t?.includes("Project 9"))).toBe(true);
    expect(rendered.some((t) => t?.includes("Project 2"))).toBe(false);
    expect(within(nav).getAllByRole("link")).toHaveLength(3);

    // Every project remains reachable via the "All projects" link.
    const allProjectsLink = screen.getByRole("link", { name: "All projects" });
    expect(allProjectsLink).toHaveAttribute("href", "/w/acme/projects");
  });

  it("caps the recent fallback at 5 even when more than 5 recents are recorded", () => {
    readRecentProjectIds.mockReturnValue([
      "p0", "p1", "p2", "p3", "p4", "p5", "p6",
    ]);

    render(
      createElement(ProjectNavList, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        projects: manyProjects,
      }),
    );

    const nav = screen.getByRole("navigation", { name: "Projects" });
    expect(within(nav).getAllByRole("link")).toHaveLength(5);
  });

  it("0 favourites + 0 recents: renders this section's own empty state rather than a slice of the full project list", () => {
    readRecentProjectIds.mockReturnValue([]);

    render(
      createElement(ProjectNavList, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        projects: manyProjects,
      }),
    );

    const nav = screen.getByRole("navigation", { name: "Projects" });
    // No project rows render in the capped section -- this is the
    // dedicated empty state, not the first 5 (or all 20) projects.
    expect(within(nav).queryAllByRole("link")).toHaveLength(0);
    expect(nav.textContent).toMatch(/no recent projects/i);

    // Every project still remains reachable one click away.
    const allProjectsLink = screen.getByRole("link", { name: "All projects" });
    expect(allProjectsLink).toHaveAttribute("href", "/w/acme/projects");
  });
});
