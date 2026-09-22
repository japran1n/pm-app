// F008 (SB-031, SB-032) reuses the F025/F007 real-Chromium pipeline, with the REAL CommandPalette mounted beside the REAL AppSidebar.
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
import { COMMAND_PALETTE_OPEN_EVENT } from "@/lib/hooks/use-shortcut";

const root = process.cwd();
let css = "";
let js = "";

const STUBS: Record<string, string> = {
  "next/navigation": `export const usePathname=()=>"/w/acme"; export const useRouter=()=>({push(u){(window.__pushes=window.__pushes||[]).push(u)},replace(){},refresh(){},prefetch(){},back(){},forward(){}}); export const useSearchParams=()=>new URLSearchParams();`,
  "@/lib/actions/palette-search": `export async function searchPalette(){return {projects:[],tasks:[],members:[]}} export async function resolveRecentItems(){return {projects:[],tasks:[]}}`,
  "@/lib/hooks/use-palette-search-realtime": `export function usePaletteSearchRealtime(){}`,
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
  const dir = mkdtempSync(join(tmpdir(), "f007-"));
  const entry = join(dir, "entry.tsx");
  writeFileSync(
    entry,
    `import React from "react";
import { createRoot } from "react-dom/client";
import { AppSidebar } from "@/components/nav/app-sidebar";
import { CommandPalette } from "@/components/command/command-palette";
const withPalette = !(window as any).__nopalette;
createRoot(document.getElementById("root")!).render(
  <>{withPalette && <CommandPalette workspaceId="w1" workspaceSlug="acme" />}<AppSidebar workspaceSlug="acme" workspaces={[{id:"w1",name:"ABCDEFGHIJ KLMNOPQRST UVWXYZ0123 456789ABCD",slug:"acme"}]} currentWorkspaceId="w1"
    currentUser={{id:"u1",name:"T",email:"t@example.com",avatarUrl:null}} isGuest={false} canManageWorkspace={true}
    projects={[{id:"p1",name:"Apollo Launch",slug:"apollo"}] as never} /></>
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

async function withPage<T>(width: number, fn: (p: Page) => Promise<T>, opts: { palette?: boolean; platform?: string } = {}): Promise<T> {
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.setContent(
      `<!doctype html><html><head><style>:root{--font-source-code-pro:"Source Code Pro";}${css}</style></head><body><div id="root"></div></body></html>`,
    );
    // Set before the bundle runs: platform (drives the hint) and whether a palette is mounted.
    await page.evaluate(
      ([platform, nopalette]) => {
        Object.defineProperty(navigator, "platform", { get: () => platform as string });
        (window as unknown as { __nopalette?: boolean }).__nopalette = nopalette as boolean;
      },
      [opts.platform ?? "Linux x86_64", opts.palette === false] as const,
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


const dialogs = (p: Page) => p.locator('[role="dialog"]:has([cmdk-input])');

describe("F008 SB-031 sidebar Search button", () => {
  it("test_SB_031_desktop_button_shows_mono_hint_and_click_opens_palette", async () => {
    await withPage(1280, async (p) => {
      const btn = p.locator("aside").getByRole("button", { name: /Search/ });
      await btn.waitFor({ state: "visible" });
      const kbd = btn.locator("kbd");
      expect(await kbd.innerText()).toBe("Ctrl K");
      expect(await kbd.evaluate((e) => getComputedStyle(e).fontFamily.toLowerCase())).toContain("source code pro");
      expect(await dialogs(p).count()).toBe(0);
      await btn.click();
      await dialogs(p).first().waitFor({ state: "visible" });
      expect(await dialogs(p).count()).toBe(1);
    });
  }, 60_000);

  it("test_SB_031_mac_platform_shows_command_glyph", async () => {
    await withPage(
      1280,
      async (p) => {
        const kbd = p.locator("aside").getByRole("button", { name: /Search/ }).locator("kbd");
        await p.waitForFunction(() => document.querySelector("aside kbd")?.textContent === "\u2318K");
        expect(await kbd.innerText()).toBe("\u2318K");
      },
      { platform: "MacIntel" },
    );
  }, 60_000);

  it("test_SB_031_375px_sheet_button_opens_palette", async () => {
    await withPage(375, async (p) => {
      await p.getByRole("button", { name: "Open navigation" }).click();
      const sheet = p.getByRole("dialog").filter({ hasNot: p.locator("[cmdk-input]") });
      await sheet.waitFor({ state: "visible" });
      await sheet.getByRole("button", { name: /Search/ }).click();
      await dialogs(p).first().waitFor({ state: "visible" });
      expect(await dialogs(p).count()).toBe(1);
      await p.locator("[cmdk-input]").waitFor({ state: "visible" });
    });
  }, 60_000);

  it("test_SB_031_without_palette_falls_back_to_search_page", async () => {
    await withPage(
      1280,
      async (p) => {
        await p.locator("aside").getByRole("button", { name: /Search/ }).click();
        expect(await p.evaluate(() => (window as unknown as { __pushes?: string[] }).__pushes)).toEqual([
          "/w/acme/search",
        ]);
        expect(await dialogs(p).count()).toBe(0);
      },
      { palette: false },
    );
  }, 60_000);
});

// F032 (FU-18): the sidebar dispatches the SHARED constant's event name (the
// listener is registered from the constant's value, in real Chromium, with no
// palette mounted so nothing else answers).
describe("F032 SB-031 sidebar dispatches the shared event name", () => {
  it("test_SB_031_desktop_click_dispatches_shared_constant_event", async () => {
    await withPage(
      1280,
      async (p) => {
        await p.evaluate((name) => {
          (window as unknown as { __seen: number }).__seen = 0;
          window.addEventListener(name, () => ((window as unknown as { __seen: number }).__seen += 1));
        }, COMMAND_PALETTE_OPEN_EVENT);
        await p.locator("aside").getByRole("button", { name: /Search/ }).click();
        expect(await p.evaluate(() => (window as unknown as { __seen: number }).__seen)).toBe(1);
      },
      { palette: false },
    );
  }, 60_000);

  it("test_SB_031_375px_sheet_click_dispatches_shared_constant_event", async () => {
    await withPage(
      375,
      async (p) => {
        await p.evaluate((name) => {
          (window as unknown as { __seen: number }).__seen = 0;
          window.addEventListener(name, () => ((window as unknown as { __seen: number }).__seen += 1));
        }, COMMAND_PALETTE_OPEN_EVENT);
        await p.getByRole("button", { name: "Open navigation" }).click();
        const sheet = p.getByRole("dialog");
        await sheet.waitFor({ state: "visible" });
        await sheet.getByRole("button", { name: /Search/ }).click();
        expect(await p.evaluate(() => (window as unknown as { __seen: number }).__seen)).toBe(1);
      },
      { palette: false },
    );
  }, 60_000);
});

describe("F008 SB-032 keyboard shortcut opens exactly one palette", () => {
  it("test_SB_032_ctrl_k_opens_one_dialog_and_second_press_closes_it", async () => {
    await withPage(1280, async (p) => {
      await p.keyboard.press("Control+k");
      await dialogs(p).first().waitFor({ state: "visible" });
      expect(await dialogs(p).count()).toBe(1);
      // A duplicate listener would toggle twice (net closed) or mount twice.
      await p.keyboard.press("Control+k");
      await p.waitForFunction(() => document.querySelectorAll("[cmdk-input]").length === 0);
      await p.keyboard.press("Control+k");
      await dialogs(p).first().waitFor({ state: "visible" });
      expect(await dialogs(p).count()).toBe(1);
    });
  }, 60_000);

  it("test_SB_032_meta_k_opens_one_dialog_at_375px", async () => {
    await withPage(375, async (p) => {
      await p.keyboard.press("Meta+k");
      await dialogs(p).first().waitFor({ state: "visible" });
      expect(await dialogs(p).count()).toBe(1);
    });
  }, 60_000);

  it("test_SB_032_button_then_shortcut_still_single_dialog", async () => {
    await withPage(1280, async (p) => {
      await p.locator("aside").getByRole("button", { name: /Search/ }).click();
      await dialogs(p).first().waitFor({ state: "visible" });
      await p.keyboard.press("Control+k");
      await p.waitForFunction(() => document.querySelectorAll("[cmdk-input]").length === 0);
      expect(await dialogs(p).count()).toBe(0);
    });
  }, 60_000);
});
