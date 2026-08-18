import { describe, expect, it } from "vitest";

// AS-022: "navigating back after sign-out does not show cached workspace
// data."
//
// The bfcache-restoration path this assertion is actually about happens
// entirely client-side in the browser: hitting back after signOut() can
// repaint a previously-rendered /w/* page straight from the browser's
// back-forward cache with *zero* network request. That means proxy.ts's
// requiresAuth guard (F010, AS-001) — which only runs on requests that hit
// the server — never gets a chance to fire in that path. A unit/integration
// test that fabricates a request to proxy() (the previous version of this
// file) cannot exercise this: it can only prove the guard works when a
// request is actually made, which was never in question and is not what
// bfcache restoration does.
//
// KNOWN LIMITATION: genuinely reproducing browser bfcache restoration
// (sign in, load a /w/* page, sign out, press the OS/browser back button,
// and assert the DOM does NOT show stale workspace data with no network
// request) requires a real browser context and is exercised at the E2E
// level (Playwright, AS-150), not here. This file's job is narrower: it
// verifies the specific server-side mechanism that defeats bfcache
// restoration is actually in place.
//
// The mechanism is `export const dynamic = "force-dynamic"` on the
// workspace layout module (app/(workspace)/w/[workspaceSlug]/layout.tsx).
// This is Next.js's supported route-segment config for opting a route out
// of static rendering and the associated caching, which in turn prevents
// the browser from treating the page as safe to restore from bfcache —
// every visit, including a back-navigation, becomes a real request that
// re-runs this layout's own `!user` -> redirect("/sign-in") check (and
// proxy.ts's guard ahead of it) rather than repainting stale DOM.
describe("workspace layout dynamic rendering config (AS-022)", () => {
  it("AS-022: the workspace layout exports dynamic = \"force-dynamic\", forcing a real server round-trip (and therefore the auth guard) on every visit instead of allowing a bfcache-restored authenticated page after sign-out", async () => {
    const layoutModule = await import(
      "@/app/(workspace)/w/[workspaceSlug]/layout"
    );

    expect(layoutModule.dynamic).toBe("force-dynamic");
  });
});
