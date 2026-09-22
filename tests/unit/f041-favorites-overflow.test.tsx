// @vitest-environment jsdom
//
// F041 (M3 scrutiny FU-3, SB-041): "favouriting a 6th+ project must not
// remove it from the sidebar entirely". Before this fix, `allOtherProjects`
// filtered out every favourite id while `favoriteProjects` (the pinned
// group) only rendered the first 5 -- any favourite beyond that cap was
// filtered from BOTH groups and vanished from the sidebar entirely.
//
// SUPERSEDED (partially) by F044 (M3 scrutiny attempt 2, FU-17): the
// section's TOTAL row count is now capped at `SIDEBAR_PROJECTS_LIMIT` (5)
// in every branch, not just the pinned favourites group. With 8 favourites
// that means only 5 rows total render in the section (all pinned) -- the
// remaining 3 are no longer guaranteed a non-pinned row; they're still
// reachable via the "All projects" link (SB-044), same as any other
// overflow project. See project-nav-list.tsx's own `remainingSlots`
// comment for the full rationale and why this reading of SB-041's text
// ("lists up to 5 favorited projects") doesn't require a superseding
// assertion.

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
  it("test_SB_041_eight_favourites_cap_pinned_group_at_five", () => {
    // Names chosen so alphabetical order is predictable: P01..P08 -> the
    // pinned group (capped at 5) takes the first 5 alphabetically (P01-P05).
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

    // Exactly 5 of them sit inside the pinned "Favourite projects" group
    // (P01-P05, alphabetically first).
    const pinnedGroup = within(nav).getByLabelText(
      "Favourite projects",
    ) as HTMLElement;
    const pinnedNames = projects.filter((p) =>
      within(pinnedGroup).queryByText(p.name),
    );
    expect(pinnedNames).toHaveLength(5);

    // F044 (M3 scrutiny attempt 2, FU-17): the section's TOTAL row count is
    // now capped at 5 in every branch, not just the pinned group -- with 8
    // favourites and a remaining budget of 0 (5 favourites already fill the
    // cap), P06-P08 do NOT get a guaranteed non-pinned row anymore. This is
    // the deliberate supersession of this test's original "all 8 present
    // somewhere" expectation (see this file's header comment) and is
    // asserted directly by tests/unit/f044-cap-section-in-every-branch.test.tsx.
    const allLinks = within(nav).getAllByRole("link");
    expect(allLinks).toHaveLength(5);
  });
});
