// F022 (SB-023): measure the COMPUTED height of a real sidebar nav link in a
// real (headless Chromium) browser instead of grepping the class string.
//
// No dev server / auth needed: we render the real <AppSidebar> to static HTML,
// compile the app's real stylesheet (app/globals.css through the project's
// PostCSS + Tailwind pipeline), load both into Playwright's chromium and read
// getBoundingClientRect().height at desktop (1280px) and mobile (375px) widths.
//
// Limit (documented, not hidden): at 375px the desktop <aside> is `hidden`
// below md and the real mobile surface is a Sheet that is not in the static
// markup, so the mobile measurement forces the aside visible with an injected
// `display:flex` rule. The link element and its Tailwind classes are the very
// same ones the Sheet renders (shared NavContent); only its container differs.
// @vitest-environment node
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser } from "@playwright/test";

vi.mock("next/navigation", () => ({
  usePathname: () => "/w/acme",
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} }),
}));
vi.mock("@/components/notifications/notification-bell", () => ({
  NotificationBell: () => createElement("div"),
}));

import { AppSidebar } from "@/components/nav/app-sidebar";

let html = "";
let css = "";

beforeAll(async () => {
  html = renderToStaticMarkup(
    createElement(AppSidebar, {
      workspaceSlug: "acme",
      workspaces: [{ id: "w1", name: "Acme", slug: "acme" }],
      currentWorkspaceId: "w1",
      currentUser: { id: "u1", name: "T", email: "t@example.com", avatarUrl: null },
      isGuest: false,
      // F045 (SB-042 boundary fix): `isFavorite: true` keeps this project
      // out of the now-unconditional 0-favourites/0-recents empty state.
      projects: [{ id: "p1", name: "Apollo Launch", key: null, isFavorite: true }],
    }),
  );
  const file = join(process.cwd(), "app/globals.css");
  const out = await postcss([tailwind()]).process(readFileSync(file, "utf8"), { from: file });
  css = out.css;
}, 120_000);

async function measure(
  width: number,
  forceAside: boolean,
  selector = "aside nav a[href^='/w/acme']",
  textFilter = /dashboard|team|my tasks/i,
): Promise<number[]> {
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const extra = forceAside ? "aside{display:flex !important}" : "";
    await page.setContent(
      `<!doctype html><html><head><style>${css}${extra}</style></head><body>${html}</body></html>`,
    );
    return await page.evaluate(([sel, src]) => {
      const re = new RegExp(src, "i");
      const links = Array.from(
        document.querySelectorAll<HTMLAnchorElement>(sel),
      ).filter((a) => re.test(a.textContent ?? ""));
      return links.map((a) => a.getBoundingClientRect().height);
    }, [selector, textFilter.source] as [string, string]);
  } finally {
    await browser?.close();
  }
}

describe("F022 SB-023 computed nav item height", () => {
  it("test_SB_023_desktop_nav_links_compute_to_32px_at_1280px", async () => {
    const heights = await measure(1280, false);
    expect(heights.length).toBeGreaterThan(0);
    for (const h of heights) expect(h).toBe(32);
  }, 60_000);

  it("test_SB_023_mobile_nav_links_compute_to_at_least_44px_at_375px", async () => {
    const heights = await measure(375, true);
    expect(heights.length).toBeGreaterThan(0);
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
  }, 60_000);

  const PROJECT_ROWS = "aside a[href^='/w/acme/projects/']";

  it("test_SB_023_desktop_project_rows_compute_to_32px_at_1280px", async () => {
    const heights = await measure(1280, false, PROJECT_ROWS, /apollo/i);
    expect(heights.length).toBeGreaterThan(0);
    for (const h of heights) expect(h).toBe(32);
  }, 60_000);

  it("test_SB_023_mobile_project_rows_compute_to_at_least_44px_at_375px", async () => {
    const heights = await measure(375, true, PROJECT_ROWS, /apollo/i);
    expect(heights.length).toBeGreaterThan(0);
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
  }, 60_000);
});
