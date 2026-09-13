import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import {
  NavBadgeSkeleton,
  NotificationBellSkeleton,
  WorkspaceSwitcherSkeleton,
} from "@/components/nav/figures/skeletons";

// F017 (AS-017, AS-020): the F016 figures' `<Suspense fallback={null}>`
// wrappers are replaced with skeletons that reserve each figure's
// resolved-with-a-value footprint, so nothing shifts once the async figure
// settles. This suite asserts (1) each skeleton renders a non-empty,
// sized placeholder element, and (2) the layout's own file still never
// wraps the tour figure (which has no in-flow footprint) in a
// space-reserving skeleton.

describe("AS-017/AS-020: Suspense fallbacks hold each figure's exact footprint", () => {
  it("NavBadgeSkeleton renders a sized, non-empty placeholder (the badge-figures' occupied state)", () => {
    const html = renderToStaticMarkup(createElement(NavBadgeSkeleton));
    expect(html).toMatch(/h-4/);
    expect(html).toMatch(/w-5/);
    expect(html).toMatch(/animate-pulse/);
    expect(html).toMatch(/bg-muted/);
  });

  it("NotificationBellSkeleton reserves the icon-button's own box (h-[38px] w-[38px], max-md:size-11), independent of badge state", () => {
    const html = renderToStaticMarkup(createElement(NotificationBellSkeleton));
    expect(html).toMatch(/h-\[38px\]/);
    expect(html).toMatch(/w-\[38px\]/);
    expect(html).toMatch(/max-md:size-11/);
  });

  it("WorkspaceSwitcherSkeleton reserves the sm-Button trigger's own box (h-[34px], w-full max-w-56, rounded-lg)", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceSwitcherSkeleton));
    expect(html).toMatch(/h-\[34px\]/);
    expect(html).toMatch(/max-w-56/);
    expect(html).toMatch(/rounded-lg/);
  });

  it("the workspace layout no longer uses fallback={null} for badge/bell/switcher figures, only for the flow-less tour figure", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const layoutPath = path.join(
      process.cwd(),
      "app/(workspace)/w/[workspaceSlug]/layout.tsx",
    );
    const source = fs.readFileSync(layoutPath, "utf8");

    const codeLines = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"));
    const nullFallbacks = codeLines.filter((line) =>
      line.includes("<Suspense fallback={null}>"),
    );
    // Only TourFigure keeps fallback={null} -- it renders `null` until
    // active and, once active, only `position: fixed` overlay elements
    // that never participate in document flow, so there is no footprint
    // to reserve.
    expect(nullFallbacks).toHaveLength(1);

    expect(source).toMatch(/fallback=\{<NotificationBellSkeleton \/>\}/);
    expect(source).toMatch(/fallback=\{<WorkspaceSwitcherSkeleton \/>\}/);
    const badgeSkeletonFallbacks = source.match(
      /fallback=\{<NavBadgeSkeleton \/>\}/g,
    ) ?? [];
    expect(badgeSkeletonFallbacks).toHaveLength(3);
  });
});
