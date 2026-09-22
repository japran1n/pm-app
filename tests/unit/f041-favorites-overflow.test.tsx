// @vitest-environment jsdom
//
// F041 (M3 scrutiny FU-3, SB-041): "favouriting a 6th+ project must not
// remove it from the sidebar entirely". Before this fix, `allOtherProjects`
// filtered out every favourite id while `favoriteProjects` (the pinned
// group) only rendered the first 5 -- any favourite beyond that cap was
// filtered from BOTH groups and vanished from the sidebar entirely.

import { createElement } from "react";
import { render, cleanup, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/w/acme/projects/p1/board",
}));

vi.mock("@/components/new-project-dialog", () => ({
  NewProjectDialog: () => null,
}));

vi.mock("@/lib/actions/favorites", () => ({
  favoriteProject: vi.fn(),
  unfavoriteProject: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { ProjectNavList } from "@/components/nav/project-nav-list";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProjectNavList favourites overflow (F041, SB-041)", () => {
  it("SB-041: with 8 favourites, all 8 project names are present and exactly 5 sit in the pinned group", () => {
    // Names chosen so alphabetical order is predictable: P01..P08 -> the
    // pinned group (capped at 5) takes the first 5 alphabetically (P01-P05),
    // and P06-P08 must still render, just outside the pinned group.
    const projects = Array.from({ length: 8 }, (_, i) => {
      const n = String(i + 1).padStart(2, "0");
      return {
        id: `p${n}`,
        name: `P${n}`,
        key: `K${n}`,
        isFavorite: true,
      };
    });

    const { container } = render(
      createElement(ProjectNavList, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        projects,
      }),
    );

    const nav = container.querySelector(
      'nav[aria-label="Projects"]',
    ) as HTMLElement;
    expect(nav).toBeTruthy();

    // All 8 names must be present SOMEWHERE in the sidebar.
    for (const project of projects) {
      expect(within(nav).getByText(project.name)).toBeInTheDocument();
    }

    // Exactly 5 of them sit inside the pinned "Favourite projects" group.
    const pinnedGroup = within(nav).getByLabelText(
      "Favourite projects",
    ) as HTMLElement;
    const pinnedNames = projects.filter((p) =>
      within(pinnedGroup).queryByText(p.name),
    );
    expect(pinnedNames).toHaveLength(5);

    // The remaining 3 must still be reachable elsewhere in the nav (not
    // discarded), i.e. rendered outside the pinned group.
    const overflowNames = projects.filter(
      (p) => !within(pinnedGroup).queryByText(p.name),
    );
    expect(overflowNames).toHaveLength(3);
    for (const project of overflowNames) {
      expect(within(nav).getByText(project.name)).toBeInTheDocument();
    }
  });
});
