// F037 (SB-031, SB-032, FU-21): sidebar hint and help dialog share ONE platform detector; palette fallback warns in dev; ack after open. Reuses the F025/F007 real-Chromium pipeline, with the REAL CommandPalette mounted beside the REAL AppSidebar.
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
import { ShortcutHelpDialog } from "@/components/command/shortcut-help";
const withPalette = !(window as any).__nopalette;
createRoot(document.getElementById("root")!).render(
  <><ShortcutHelpDialog />{withPalette && <CommandPalette workspaceId="w1" workspaceSlug="acme" />}<AppSidebar workspaceSlug="acme" workspaces={[{id:"w1",name:"ABCDEFGHIJ KLMNOPQRST UVWXYZ0123 456789ABCD",slug:"acme"}]} currentWorkspaceId="w1"
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

async function withPage<T>(width: number, fn: (p: Page) => Promise<T>, opts: { palette?: boolean; platform?: string; uaPlatform?: string } = {}): Promise<T> {
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    const errors: string[] = [];
    page.on("console", (m) => { if (m.type() === "warning") (globalThis as unknown as { __warns: string[] }).__warns.push(m.text()); });
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.setContent(
      `<!doctype html><html><head><style>:root{--font-source-code-pro:"Source Code Pro";}${css}</style></head><body><div id="root"></div></body></html>`,
    );
    // Set before the bundle runs: platform (drives the hint) and whether a palette is mounted.
    await page.evaluate(
      ([platform, nopalette, uaPlatform]) => {
        Object.defineProperty(navigator, "platform", { get: () => platform as string });
        if (uaPlatform) Object.defineProperty(navigator, "userAgentData", { get: () => ({ platform: uaPlatform }) });
        (window as unknown as { __nopalette?: boolean }).__nopalette = nopalette as boolean;
      },
      [opts.platform ?? "Linux x86_64", opts.palette === false, opts.uaPlatform ?? ""] as const,
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



(globalThis as unknown as { __warns: string[] }).__warns = [];
const warns = () => (globalThis as unknown as { __warns: string[] }).__warns;

async function labels(p: Page) {
  const hint = (await p.locator("aside").getByRole("button", { name: /Search/ }).locator("kbd").innerText()).trim();
  await p.evaluate(() => window.dispatchEvent(new CustomEvent("pm-app:shortcut:open-help")));
  const dlg = p.getByRole("dialog");
  await dlg.waitFor({ state: "visible" });
  const rowText = await dlg.evaluate((d) => {
    const el = Array.from(d.querySelectorAll("kbd")).map((k) => k.textContent ?? "");
    return el.join("|");
  });
  return { hint, rowText };
}

describe("F037 FU-21 one platform detector for sidebar hint and help dialog", () => {
  // Cases the old hand-rolled regex in the sidebar got wrong or right; both surfaces must agree.
  for (const c of [
    { name: "userAgentData mac while navigator.platform is not", platform: "Linux x86_64", uaPlatform: "macOS", mac: true },
    { name: "iPod", platform: "iPod", uaPlatform: "", mac: true },
    { name: "plain linux", platform: "Linux x86_64", uaPlatform: "", mac: false },
  ]) {
    it(`test_SB_031_sidebar_hint_and_help_dialog_agree_${c.name.replace(/\W+/g, "_")}`, async () => {
      await withPage(1280, async (p) => {
        const { hint, rowText } = await labels(p);
        expect(hint).toBe(c.mac ? "⌘K" : "Ctrl K");
        expect(rowText).toContain(c.mac ? "⌘" : "Ctrl");
        if (c.mac) expect(rowText).not.toContain("Ctrl");
        else expect(rowText).not.toContain("⌘");
      }, { platform: c.platform, uaPlatform: c.uaPlatform });
    }, 60_000);
  }
});

describe("F037 FU-21 palette fallback is visible, ack follows open", () => {
  it("test_SB_031_no_palette_click_warns_in_development_and_navigates", async () => {
    warns().length = 0;
    await withPage(1280, async (p) => {
      await p.locator("aside").getByRole("button", { name: /Search/ }).click();
      await p.waitForFunction(() => ((window as unknown as { __pushes?: string[] }).__pushes ?? []).length > 0);
      expect(await p.evaluate(() => (window as unknown as { __pushes: string[] }).__pushes)).toEqual(["/w/acme/search"]);
    }, { palette: false });
    expect(warns().some((w) => /CommandPalette|acknowledged/.test(w))).toBe(true);
  }, 60_000);

  it("test_SB_031_mounted_palette_click_does_not_warn_or_navigate", async () => {
    warns().length = 0;
    await withPage(1280, async (p) => {
      await p.locator("aside").getByRole("button", { name: /Search/ }).click();
      await p.locator('[role="dialog"]:has([cmdk-input])').waitFor({ state: "visible" });
      expect(await p.evaluate(() => (window as unknown as { __pushes?: string[] }).__pushes ?? [])).toEqual([]);
    });
    expect(warns().filter((w) => /acknowledged/.test(w))).toEqual([]);
  }, 60_000);

  it("test_SB_031_palette_acknowledges_only_after_setOpen", () => {
    const src = readFileSync(join(root, "components/command/command-palette.tsx"), "utf8");
    const fn = src.slice(src.indexOf("function onOpenRequest"));
    const body = fn.slice(0, fn.indexOf("window.addEventListener(COMMAND_PALETTE_OPEN_EVENT"));
    expect(body.indexOf("setOpen(true)")).toBeGreaterThan(-1);
    expect(body.indexOf("setOpen(true)")).toBeLessThan(body.indexOf("handled = true"));
  });
});
