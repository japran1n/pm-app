// @vitest-environment jsdom
//
// F009 (PL-031): "Suspense skeleton mimics the new card; grid is 1/2/3/4
// columns at base/sm/lg/2xl (or xl)." Tests derive from the assertion text:
// the loading skeleton must reflect the card's three zones (top zone, inner
// panel, footer row) rather than a flat block, and the grid wrapper must
// carry the four responsive column breakpoints.

import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import ProjectsLoading from "@/app/(workspace)/w/[workspaceSlug]/projects/loading";

describe("F009", () => {
  afterEach(cleanup);

  it("test_PL_031_skeleton_inner_panel_matches_card_inner_panel_surface", () => {
    // F016 changed the loaded ProjectCard's inner panel (data-testid
    // "card-inner-panel") to bg-secondary. The skeleton's inner panel must
    // use the same surface class so there is no hydration/repaint jump
    // when the real card mounts over the skeleton.
    const cardSource = readFileSync(
      join(process.cwd(), "components/projects/project-card.tsx"),
      "utf8",
    );
    const skeletonSource = readFileSync(
      join(
        process.cwd(),
        "app/(workspace)/w/[workspaceSlug]/projects/loading.tsx",
      ),
      "utf8",
    );

    const cardInnerPanelLine = cardSource
      .split("\n")
      .find((line) => line.includes('data-testid="card-inner-panel"'));
    expect(cardInnerPanelLine).toBeDefined();

    // The className is on the following line in project-card.tsx.
    const cardInnerPanelIndex = cardSource.indexOf('data-testid="card-inner-panel"');
    const cardSnippet = cardSource.slice(cardInnerPanelIndex, cardInnerPanelIndex + 200);
    expect(cardSnippet).toContain("bg-secondary");

    const { container } = render(<ProjectsLoading />);
    const skeletonInnerPanel = container.querySelector(".rounded-lg.bg-secondary");
    expect(skeletonInnerPanel).not.toBeNull();

    expect(skeletonSource).toContain("rounded-lg bg-secondary");
    expect(cardSnippet).toContain("rounded-lg bg-secondary");
  });

  it("test_PL_031_grid_has_four_responsive_breakpoints", () => {
    const { container } = render(<ProjectsLoading />);
    const grid = container.querySelector(".grid");
    expect(grid).not.toBeNull();
    const className = grid!.className;
    expect(className).toContain("grid-cols-1");
    expect(className).toContain("sm:grid-cols-2");
    expect(className).toContain("lg:grid-cols-3");
    expect(className.includes("2xl:grid-cols-4") || className.includes("xl:grid-cols-4")).toBe(
      true,
    );
  });

  it("test_PL_031_skeleton_reflects_three_zone_card_structure", () => {
    const { container } = render(<ProjectsLoading />);
    // Zone 1: top zone (icon + title block) — a rounded-md avatar-shaped skeleton.
    expect(container.querySelector(".size-9")).not.toBeNull();
    // Zone 2: inner panel (rounded-lg bg-secondary), distinct from the outer card.
    expect(container.querySelector(".rounded-lg.bg-secondary")).not.toBeNull();
    // Zone 3: footer row — at least one pill-shaped skeleton (rounded-full),
    // distinct from the progress bar which is also rounded-full, so assert
    // there are at least two rounded-full elements (progress bar + footer pill).
    const roundedFull = container.querySelectorAll(".rounded-full");
    expect(roundedFull.length).toBeGreaterThanOrEqual(2);
  });

  it("test_PL_031_page_grids_use_four_responsive_breakpoints", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "app/(workspace)/w/[workspaceSlug]/projects/page.tsx",
      ),
      "utf8",
    );
    const gridClassLines = source
      .split("\n")
      .filter((line) => line.includes("grid-cols-1") && line.includes("sm:grid-cols-2"));
    expect(gridClassLines.length).toBeGreaterThan(0);
    for (const line of gridClassLines) {
      expect(line.includes("2xl:grid-cols-4") || line.includes("xl:grid-cols-4")).toBe(true);
    }
  });
});
