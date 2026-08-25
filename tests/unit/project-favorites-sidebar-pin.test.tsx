// @vitest-environment jsdom
//
// F263 (AS-510): "a favourited project is pinned above the rest of the
// sidebar project list." Extends the F262 ProjectNavList component
// (tests/unit/app-sidebar-project-nav-list.test.tsx already covers the
// base list, aria-current, empty state, scroll container -- not repeated
// here).

import { createElement } from "react";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/w/acme/projects/p1/board",
}));

vi.mock("@/components/new-project-dialog", () => ({
  NewProjectDialog: () => null,
}));

const favoriteProjectMock = vi.fn();
const unfavoriteProjectMock = vi.fn();
vi.mock("@/lib/actions/favorites", () => ({
  favoriteProject: (...args: unknown[]) => favoriteProjectMock(...args),
  unfavoriteProject: (...args: unknown[]) => unfavoriteProjectMock(...args),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { ProjectNavList } from "@/components/nav/project-nav-list";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProjectNavList pinned favourites (F263, AS-510)", () => {
  it("AS-510: a favourited project renders above the rest of the list", () => {
    const { container } = render(
      createElement(ProjectNavList, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        projects: [
          { id: "p1", name: "Alpha Project", key: "AL", isFavorite: false },
          { id: "p2", name: "Zebra Project", key: "ZB", isFavorite: true },
        ],
      }),
    );

    const nav = container.querySelector('nav[aria-label="Projects"]');
    expect(nav).toBeTruthy();

    // Zebra (favourited) must appear BEFORE Alpha (not favourited) in DOM
    // order, even though "Alpha" alphabetically precedes "Zebra" and
    // Alpha was passed first in props -- the favourite group is pinned
    // above the rest of the list regardless of the underlying order.
    const alphaIndex = nav!.innerHTML.indexOf("Alpha Project");
    const zebraIndex = nav!.innerHTML.indexOf("Zebra Project");
    expect(zebraIndex).toBeGreaterThan(-1);
    expect(alphaIndex).toBeGreaterThan(-1);
    expect(zebraIndex).toBeLessThan(alphaIndex);
  });

  it("AS-510: multiple favourites within the pinned group are ordered alphabetically", () => {
    const { container } = render(
      createElement(ProjectNavList, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        projects: [
          { id: "p1", name: "Zeta", key: "ZT", isFavorite: true },
          { id: "p2", name: "Beta", key: "BT", isFavorite: true },
          { id: "p3", name: "Alpha", key: "AL", isFavorite: true },
        ],
      }),
    );

    const nav = container.querySelector('nav[aria-label="Projects"]')!;
    const alphaIndex = nav.innerHTML.indexOf("Alpha");
    const betaIndex = nav.innerHTML.indexOf("Beta");
    const zetaIndex = nav.innerHTML.indexOf("Zeta");
    expect(alphaIndex).toBeLessThan(betaIndex);
    expect(betaIndex).toBeLessThan(zetaIndex);
  });

  it("AS-510: with no favourites, the pinned favourites group is absent", () => {
    render(
      createElement(ProjectNavList, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        projects: [
          { id: "p1", name: "Alpha Project", key: "AL", isFavorite: false },
        ],
      }),
    );

    expect(screen.queryByLabelText("Favourite projects")).not.toBeInTheDocument();
  });

  it("AS-510: the star toggle calls the favorite action with the project id and is optimistic with rollback on failure", async () => {
    favoriteProjectMock.mockResolvedValueOnce({
      ok: false,
      error: "Could not favourite this project.",
    });

    render(
      createElement(ProjectNavList, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        projects: [
          { id: "p1", name: "Alpha Project", key: "AL", isFavorite: false },
        ],
      }),
    );

    const nav = screen.getByRole("navigation", { name: "Projects" });
    const star = within(nav).getByRole("button", {
      name: /Add Alpha Project to favourites/i,
    });

    fireEvent.click(star);

    expect(favoriteProjectMock).toHaveBeenCalledWith("p1");

    // Rollback: after the failed call resolves, the button reverts to its
    // "not favourited" label rather than staying optimistically favourited.
    await screen.findByRole("button", { name: /Add Alpha Project to favourites/i });
  });
});
