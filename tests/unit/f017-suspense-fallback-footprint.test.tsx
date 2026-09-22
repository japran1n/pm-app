import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { NavBadgeSkeleton } from "@/components/nav/figures/skeletons";

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

  // F014 (SB-053, SB-054, SB-055): NotificationBellSkeleton's own test was
  // removed -- the bell (and its Suspense fallback) is gone from the
  // layout. The skeleton component itself is left in place, unused (per
  // this feature's own "leave the figure component file unless unused"
  // convention), so it is not asserted on here either.

  // WorkspaceSwitcherSkeleton footprint is asserted by real-Chromium
  // measurement in f036-switcher-skeleton-footprint.test.ts (F036).

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
    // Three figures legitimately keep fallback={null}:
    // - TourFigure: renders `null` until active and, once active, only
    //   `position: fixed` overlay elements that never participate in
    //   document flow, so there is no footprint to reserve.
    // - ClientPresentationBannerFigure: renders nothing at all for most
    //   users (non-client sessions), so reserving a footprint would show a
    //   permanent empty gap instead.
    // - NotificationsRealtimeFigure (F014): headless -- always renders
    //   null, never any in-flow markup, so there is nothing to reserve
    //   (see that figure's own header comment).
    expect(nullFallbacks).toHaveLength(3);

    // F014: the notification bell (and its own NotificationBellSkeleton
    // fallback) is gone -- its unread count is now one more
    // NavBadgeSkeleton-fallbacked figure (InboxBadgeFigure).
    expect(source).not.toMatch(/NotificationBellSkeleton/);
    expect(source).toMatch(/fallback=\{<WorkspaceSwitcherSkeleton \/>\}/);
    const badgeSkeletonFallbacks = source.match(
      /fallback=\{<NavBadgeSkeleton \/>\}/g,
    ) ?? [];
    expect(badgeSkeletonFallbacks).toHaveLength(4);
  });
});
