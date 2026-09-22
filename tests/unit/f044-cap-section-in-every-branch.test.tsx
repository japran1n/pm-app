// @vitest-environment jsdom
//
// F044 (M3 scrutiny attempt 2, FU-17): "Cap the Projects section at five
// rows in every branch." Before this fix, whenever >=1 favourite existed
// the non-pinned group rendered UNBOUNDED (`allOtherProjects`), so the
// "<=5 digest plus an All projects link" design only ever applied to
// brand-new accounts with 0 favourites. These tests assert the TOTAL link
// count inside `nav[aria-label="Projects"]` (excluding the "All projects"
// link, which lives in a sibling `div`, not inside the `nav`) stays capped
// at `SIDEBAR_PROJECTS_LIMIT` (5) regardless of how many favourites or
// total projects exist.

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

function projectsNav(container: HTMLElement): HTMLElement {
  const nav = container.querySelector(
    'nav[aria-label="Projects"]',
  ) as HTMLElement | null;
  expect(nav).toBeTruthy();
  return nav as HTMLElement;
}

describe("ProjectNavList caps total section rows (F044, SB-041/SB-042)", () => {
  it("test_SB_041_one_favourite_plus_thirty_projects_caps_total_at_five", () => {
    // 1 favourite + 29 ordinary projects = 30 total. Before the fix, the
    // presence of >=1 favourite made the non-pinned group render every one
    // of the 29 remaining projects (FU-17's exact bug). The fix must cap
    // the WHOLE section (favourite + non-pinned rows combined) at 5.
    const projects = [
      { id: "fav-1", name: "Favourite One", key: "F1", isFavorite: true },
      ...Array.from({ length: 29 }, (_, i) => ({
        id: `proj-${i}`,
        name: `Project ${i}`,
        key: `P${i}`,
        isFavorite: false,
      })),
    ];

    const { container } = render(
      createElement(ProjectNavList, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        projects,
      }),
    );

    const nav = projectsNav(container);
    const links = within(nav).getAllByRole("link");
    expect(links).toHaveLength(5);

    // The favourite itself must be one of the 5 (pinned group is filled
    // first).
    expect(within(nav).getByText("Favourite One")).toBeInTheDocument();
  });

  it("test_SB_041_eight_favourites_caps_total_section_at_five", () => {
    // With 8 favourites, the pinned group alone already fills the entire
    // section budget (5) -- 0 rows remain for anything else, favourite or
    // not.
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

    const nav = projectsNav(container);
    const links = within(nav).getAllByRole("link");
    expect(links).toHaveLength(5);
  });

});
