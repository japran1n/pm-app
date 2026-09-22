// F025 (SB-009, SB-023): verify the mobile presentation in a REAL headless
// Chromium at 375px. Unlike F022's static-markup approach, this bundles the
// real <AppSidebar> client component with esbuild, mounts it with React in the
// page (so the base-ui Sheet really opens), and compiles the app's real
// globals.css, so the `md:` breakpoint gating is evaluated by the browser.
//
// Stubbed (not under test): next/navigation, next/link, the notification bell,
// server actions (lib/actions/*), the membership provider, project DnD/dialog
// leaves. Everything in components/nav/app-sidebar.tsx, account-menu.tsx and
// components/ui/* is real. Not verified: a live authenticated Next page.
// @vitest-environment node
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "@playwright/test";

const root = process.cwd();
let css = "";
let js = "";

const STUBS: Record<string, string> = {
  "next/navigation": `export const usePathname=()=>"/w/acme"; export const useRouter=()=>({push(){},replace(){},refresh(){},prefetch(){},back(){},forward(){}});`,
  "next/link": `import React from "react"; export default function Link({href,prefetch,scroll,replace,children,...r}){return React.createElement("a",{href:typeof href==="string"?href:String(href),...r},children)}`,
  "next-themes": `export const useTheme=()=>({theme:"light",resolvedTheme:"light",setTheme(){}});`,
  "sonner": `export const toast={error(){},success(){}};`,
  "@/components/notifications/notification-bell": `import React from "react"; export const NotificationBell=()=>React.createElement("div");`,
  "@/components/auth/membership-provider": `export const useMembership=()=>({role:"admin",hasClient:true,projectRoles:{}});`,
  "@/lib/actions/auth": `export async function signOut(){}`,
  "@/lib/actions/templates": `export async function listProjectTemplateOptions(){return []} export async function createProjectFromTemplate(){return {ok:true,data:{name:"x",taskCount:0}}}`,
  "@/lib/actions/projects": `export async function reorderProject(){return {ok:true}}`,
  "@/components/new-project-dialog": `import React from "react"; export const NewProjectDialog=()=>null;`,
  "@/components/project-favorite-button": `import React from "react"; export const ProjectFavoriteButton=()=>null;`,
};

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "f025-"));
  const entry = join(dir, "entry.tsx");
  writeFileSync(
    entry,
    `import React from "react";
import { createRoot } from "react-dom/client";
import { AppSidebar } from "@/components/nav/app-sidebar";
createRoot(document.getElementById("root")!).render(
  <AppSidebar workspaceSlug="acme" workspaces={[{id:"w1",name:"Acme",slug:"acme"}]} currentWorkspaceId="w1"
    currentUser={{id:"u1",name:"T",email:"t@example.com",avatarUrl:null}} isGuest={false} canManageWorkspace={true}
    projects={[{id:"p1",name:"Apollo Launch",slug:"apollo",isFavorite:true}] as never} />
);
(window as any).__mounted = true;`,
  );
  const res = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
    nodePaths: [join(root, "node_modules")],
    absWorkingDir: root,
    logLevel: "silent",
    plugins: [
      {
        name: "stubs-and-alias",
        setup(b) {
          b.onResolve({ filter: /.*/ }, (a) => {
            if (a.path in STUBS) return { path: a.path, namespace: "stub" };
            if (a.path.startsWith("@/")) {
              const base = join(root, a.path.slice(2));
              for (const ext of [".tsx", ".ts", "/index.tsx", "/index.ts"]) {
                try {
                  readFileSync(base + ext);
                  return { path: base + ext };
                } catch {}
              }
            }
            return undefined;
          });
          b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({
            contents: STUBS[a.path],
            loader: "tsx",
            resolveDir: root,
          }));
        },
      },
    ],
  });
  js = res.outputFiles[0].text;
  const file = join(root, "app/globals.css");
  css = (await postcss([tailwind()]).process(readFileSync(file, "utf8"), { from: file })).css;
}, 180_000);

async function withPage<T>(width: number, fn: (p: Page) => Promise<T>): Promise<T> {
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.setContent(
      `<!doctype html><html><head><style>${css}</style></head><body><div id="root"></div></body></html>`,
    );
    await page.addScriptTag({ content: js });
    await page.waitForFunction(() => (window as unknown as { __mounted?: boolean }).__mounted === true);
    await page.waitForSelector("aside", { state: "attached" });
    const out = await fn(page);
    expect(errors).toEqual([]);
    return out;
  } finally {
    await browser?.close();
  }
}

describe("F025 SB-009 real 375px mobile nav", () => {
  it("test_SB_009_375px_hamburger_visible_and_desktop_aside_hidden", async () => {
    await withPage(375, async (p) => {
      expect(await p.getByRole("button", { name: "Open navigation" }).isVisible()).toBe(true);
      expect(await p.locator("aside").isVisible()).toBe(false);
    });
  }, 60_000);

  it("test_SB_009_1280px_aside_visible_and_hamburger_hidden_control", async () => {
    await withPage(1280, async (p) => {
      expect(await p.locator("aside").isVisible()).toBe(true);
      expect(await p.getByRole("button", { name: "Open navigation" }).isVisible()).toBe(false);
    });
  }, 60_000);

  it("test_SB_009_375px_sheet_opens_with_nav_tree_and_account_menu", async () => {
    await withPage(375, async (p) => {
      await p.getByRole("button", { name: "Open navigation" }).click();
      const dialog = p.getByRole("dialog");
      await dialog.waitFor({ state: "visible" });
      // F013 (SB-057): "Watching" no longer has its own sidebar item --
      // it's absorbed into the Inbox tabs.
      for (const name of [/dashboard/i, /my tasks/i, /^team$/i, /apollo launch/i]) {
        expect(await dialog.getByRole("link", { name }).first().isVisible(), String(name)).toBe(true);
      }
      expect(await dialog.getByRole("button", { name: "Account menu" }).isVisible()).toBe(true);
    });
  }, 60_000);

  it("test_SB_009_SB_023_375px_sheet_link_heights_clear_44px_measured_inside_sheet", async () => {
    await withPage(375, async (p) => {
      await p.getByRole("button", { name: "Open navigation" }).click();
      const dialog = p.getByRole("dialog");
      await dialog.waitFor({ state: "visible" });
      const heights = await dialog.evaluate((el) =>
        Array.from(el.querySelectorAll<HTMLAnchorElement>("nav a[href^='/w/acme']"))
          .filter((a) => /dashboard|team|my tasks/i.test(a.textContent ?? ""))
          .map((a) => a.getBoundingClientRect().height),
      );
      expect(heights.length).toBeGreaterThanOrEqual(3);
      for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
    });
  }, 60_000);

  // F035 (FU-22): the author's `w-64` must be the class that wins over the
  // shared Sheet default (`w-3/4` = 281.25px at 375). Sheet is 256px and fits
  // the viewport (desktop aside is a separate 240px column, untouched).
  it("test_SB_009_375px_sheet_width_is_authors_w_64_256px", async () => {
    await withPage(375, async (p) => {
      await p.getByRole("button", { name: "Open navigation" }).click();
      const dialog = p.getByRole("dialog");
      await dialog.waitFor({ state: "visible" });
      await p.waitForTimeout(400); // slide-in transition
      const w = await dialog.evaluate((el) => el.getBoundingClientRect().width);
      expect(w).toBeCloseTo(256, 0);
      expect(w).not.toBeCloseTo(281.25, 0);
      expect(w).toBeLessThan(375);
    });
  }, 60_000);
});
