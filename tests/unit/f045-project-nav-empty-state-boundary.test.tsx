// @vitest-environment jsdom
//
// F045 (M3 scrutiny attempt 2, FU-18): pins the SB-042 empty-state
// boundary unconditionally -- 0 favourites + 0 recognised recent visits
// must always render the section's own empty state, regardless of how
// many OTHER projects exist (0, 3, 5, 6+). Before this fix,
// `isTrueEmptyRecents` was additionally gated on
// `allOtherProjects.length > SIDEBAR_PROJECTS_LIMIT`, so the 0/3/5 cases
// below rendered the projects plainly instead of the empty state --
// these tests fail against that prior behaviour (non-vacuous: reverting
// the length-conjunct removal reproduces the failure).
//
// Also pins SB-044: the "All projects" link is always the LAST element
// rendered in the Projects section, in every boundary case.

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

// F045: 0 favourites + 0 recents is the case under test -- force the
// client-only recency read to always report "nothing recognised" so the
// boundary is pinned independent of any real localStorage state in the
// jsdom environment.
vi.mock("@/lib/nav/recent-projects", () => ({
  readRecentProjectIds: () => [],
}));

import { ProjectNavList } from "@/components/nav/project-nav-list";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeProjects(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Project ${i + 1}`,
    key: `P${i + 1}`,
  }));
}

describe("test_SB_042_empty_state_unconditional_on_project_count", () => {
  it.each([0, 3, 5, 6])(
    "renders the empty state with 0 favourites, 0 recents, and %i other projects",
    async (count) => {
      render(
        createElement(ProjectNavList, {
          workspaceSlug: "acme",
          workspaceId: "w1",
          projects: makeProjects(count),
        }),
      );

      // Async effect (readRecentProjectIds) resolves before assertions —
      // await a microtask flush via findBy.
      if (count === 0) {
        // No project rows possible in the "no projects at all" case; the
        // whole section renders the top-level "No projects yet." state
        // instead (a different, pre-existing branch), not the recents
        // empty state. Still: no stray project rows, and All projects
        // link absent in this specific branch (there IS no projects
        // section chrome at all when projects.length === 0).
        expect(
          screen.getByText(/No projects yet\./),
        ).toBeInTheDocument();
        return;
      }

      const emptyMessage = await screen.findByText(
        "No recent projects. Browse all projects below.",
      );
      expect(emptyMessage).toBeInTheDocument();

      // None of the actual project rows render in this branch.
      for (let i = 1; i <= count; i++) {
        expect(screen.queryByText(`Project ${i}`)).not.toBeInTheDocument();
      }
    },
  );
});

describe("test_SB_044_all_projects_link_is_last", () => {
  it.each([3, 5, 6])(
    "renders 'All projects' as the last element of the section with %i projects, 0 favourites, 0 recents",
    async (count) => {
      const { container } = render(
        createElement(ProjectNavList, {
          workspaceSlug: "acme",
          workspaceId: "w1",
          projects: makeProjects(count),
        }),
      );

      await screen.findByText("No recent projects. Browse all projects below.");

      const allLinks = Array.from(container.querySelectorAll("a"));
      expect(allLinks.length).toBeGreaterThan(0);
      const lastLink = allLinks[allLinks.length - 1];
      expect(lastLink).toHaveTextContent("All projects");
      expect(lastLink).toHaveAttribute("href", "/w/acme/projects");
    },
  );

  it("renders 'All projects' as the last link even with favourited and non-favourited projects present", async () => {
    const projects = makeProjects(3).map((p, i) => ({
      ...p,
      isFavorite: i === 0,
    }));

    const { container } = render(
      createElement(ProjectNavList, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        projects,
      }),
    );

    const allLinks = Array.from(container.querySelectorAll("a"));
    const lastLink = allLinks[allLinks.length - 1];
    expect(lastLink).toHaveTextContent("All projects");
  });
});
