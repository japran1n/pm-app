// @vitest-environment jsdom
//
// Sidebar drag-and-drop project reorder: the sidebar renders projects in
// `sidebar_position` order (as fetched by lib/queries/projects.ts's
// getWorkspaceProjects, ordered `sidebar_position asc nullsFirst: false,
// created_at desc`), not creation order -- this test asserts the RENDER
// side of that contract: given a `projects` prop already in the server's
// chosen order, ProjectNavList's non-favourite group renders in that
// exact order rather than re-sorting it.

import { createElement } from "react";
import { render, cleanup } from "@testing-library/react";
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

describe("ProjectNavList renders in sidebar_position order", () => {
  it("renders non-favourite projects in the exact order they're passed in, not alphabetically or by name", () => {
    // Deliberately out of alphabetical AND out of "creation" order --
    // the only signal for order here is array position, exactly like the
    // server's `sidebar_position`-ordered query result.
    const { container } = render(
      createElement(ProjectNavList, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        projects: [
          { id: "p3", name: "Zebra Project", key: "ZB", isFavorite: false },
          { id: "p1", name: "Alpha Project", key: "AL", isFavorite: false },
          { id: "p2", name: "Middle Project", key: "MD", isFavorite: false },
        ],
      }),
    );

    const nav = container.querySelector('nav[aria-label="Projects"]');
    expect(nav).toBeTruthy();

    const zebraIndex = nav!.innerHTML.indexOf("Zebra Project");
    const alphaIndex = nav!.innerHTML.indexOf("Alpha Project");
    const middleIndex = nav!.innerHTML.indexOf("Middle Project");

    expect(zebraIndex).toBeGreaterThan(-1);
    expect(alphaIndex).toBeGreaterThan(-1);
    expect(middleIndex).toBeGreaterThan(-1);

    // Zebra (passed first, i.e. lowest sidebar_position) renders before
    // Alpha, which renders before Middle -- the prop order, not
    // alphabetical order.
    expect(zebraIndex).toBeLessThan(alphaIndex);
    expect(alphaIndex).toBeLessThan(middleIndex);
  });

  it("re-syncs to the new prop order when the underlying project id set changes (e.g. after a server refetch)", () => {
    const initialProjects = [
      { id: "p1", name: "First Project", key: "FP", isFavorite: false },
      { id: "p2", name: "Second Project", key: "SP", isFavorite: false },
    ];

    const { container, rerender } = render(
      createElement(ProjectNavList, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        projects: initialProjects,
      }),
    );

    let nav = container.querySelector('nav[aria-label="Projects"]');
    let firstIndex = nav!.innerHTML.indexOf("First Project");
    let secondIndex = nav!.innerHTML.indexOf("Second Project");
    expect(firstIndex).toBeLessThan(secondIndex);

    // Simulate a server refetch that reflects a NEW sidebar_position order
    // (e.g. a reorder made from a different tab/device) — same set of ids,
    // reversed order.
    rerender(
      createElement(ProjectNavList, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        projects: [initialProjects[1], initialProjects[0]],
      }),
    );

    nav = container.querySelector('nav[aria-label="Projects"]');
    firstIndex = nav!.innerHTML.indexOf("First Project");
    secondIndex = nav!.innerHTML.indexOf("Second Project");
    expect(secondIndex).toBeLessThan(firstIndex);
  });
});
