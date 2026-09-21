// F009 (SB-033, SB-034) reuses the F025/F007 real-Chromium pipeline, with the REAL CommandPalette mounted beside the REAL AppSidebar.
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
  "next/navigation": `export const usePathname=()=>window.__path||"/w/acme"; export const useRouter=()=>({push(u){(window.__pushes=window.__pushes||[]).push(u)},replace(){},refresh(){},prefetch(){},back(){},forward(){}});`,
  "@/lib/actions/palette-search": `export async function searchPalette(){return {projects:[],tasks:[],members:[]}} export async function resolveRecentItems(){return {projects:[],tasks:[]}}`,
  "@/lib/hooks/use-palette-search-realtime": `export function usePaletteSearchRealtime(){}`,
  "next/link": `import React from "react"; export default function Link({href,prefetch,scroll,replace,children,...r}){return React.createElement("a",{href:typeof href==="string"?href:String(href),...r},children)}`,
  "next-themes": `export const useTheme=()=>({theme:"light",resolvedTheme:"light",setTheme(){}});`,
  "sonner": `export const toast={error(){},success(){}};`,
  "@/components/notifications/notification-bell": `import React from "react"; export const NotificationBell=()=>React.createElement("div");`,
  "@/components/auth/membership-provider": `export const useMembership=()=>({role:window.__role||"admin",hasClient:window.__hasClient!==false,projectRoles:{}});`,
  "@/lib/actions/auth": `export async function signOut(){}`,
  "@/lib/actions/projects": `export async function reorderProject(){return {ok:true}} export async function createProject(){return {ok:true,data:{name:"x"}}}`,
  "@/lib/actions/templates": `export async function createProjectFromTemplate(){return {ok:true,data:{name:"x",taskCount:0}}}`,
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
createRoot(document.getElementById("root")!).render(
  <><AppSidebar workspaceSlug="acme" workspaces={[{id:"w1",name:"ABCDEFGHIJ KLMNOPQRST UVWXYZ0123 456789ABCD",slug:"acme"}]} currentWorkspaceId="w1"
    currentUser={{id:"u1",name:"T",email:"t@example.com",avatarUrl:null}} isGuest={!!(window as any).__guest} canManageWorkspace={(window as any).__manage!==false}
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

type Opts = { role?: string; guest?: boolean; manage?: boolean; hasClient?: boolean; path?: string };
async function withPage<T>(width: number, fn: (p: Page) => Promise<T>, opts: Opts = {}): Promise<T> {
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.setContent(
      `<!doctype html><html><head><style>:root{--font-source-code-pro:"Source Code Pro";}${css}</style></head><body><div id="root"></div></body></html>`,
    );
    await page.evaluate((o) => {
      const w = window as unknown as Record<string, unknown>;
      w.__role = o.role; w.__guest = o.guest; w.__manage = o.manage; w.__hasClient = o.hasClient; w.__path = o.path;
      w.__events = [];
      window.addEventListener("pm-app:shortcut:new-task", (e) => (w.__events as unknown[]).push((e as CustomEvent).detail));
    }, opts);
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

const pushes = (p: Page) => p.evaluate(() => (window as unknown as { __pushes?: string[] }).__pushes ?? []);
const events = (p: Page) => p.evaluate(() => (window as unknown as { __events: unknown[] }).__events);

// Scope to the desktop aside or the mobile Sheet (the non-palette dialog).
async function scope(p: Page, width: number) {
  if (width >= 768) return p.locator("aside");
  await p.getByRole("button", { name: "Open navigation" }).click();
  const sheet = p.getByRole("dialog");
  await sheet.waitFor({ state: "visible" });
  return sheet;
}
async function openMenu(p: Page, width: number) {
  const s = await scope(p, width);
  await s.getByRole("button", { name: /^New$/ }).click();
  const menu = p.getByRole("menu");
  await menu.waitFor({ state: "visible" });
  return menu;
}
const items = (m: ReturnType<Page["getByRole"]>) => m.getByRole("menuitem").allInnerTexts();

for (const width of [1280, 375]) {
  const where = width === 1280 ? "desktop" : "375px_sheet";
  describe(`F009 SB-033 + New menu (${where})`, () => {
    it(`test_SB_033_${where}_menu_lists_task_project_request`, async () => {
      await withPage(width, async (p) => {
        const m = await openMenu(p, width);
        expect((await items(m)).map((t) => t.trim())).toEqual(["Task", "Project", "Request"]);
      });
    }, 60_000);

    // F028: the REAL NewProjectDialog is mounted (not stubbed). Clicking
    // Project must make the create dialog actually visible, in place.
    it(`test_SB_033_${where}_project_opens_real_new_project_dialog_in_place`, async () => {
      await withPage(width, async (p) => {
        const dialog = p.getByRole("dialog", { name: "New Project" });
        expect(await dialog.count()).toBe(0);
        const m = await openMenu(p, width);
        await m.getByRole("menuitem", { name: "Project" }).click();
        await dialog.waitFor({ state: "visible" });
        expect(await dialog.getByLabel("Name").isVisible()).toBe(true);
        expect(await dialog.getByRole("button", { name: "Create Project" }).isVisible()).toBe(true);
        expect(await pushes(p)).toEqual([]);
        // Cancel closes it again.
        await dialog.getByRole("button", { name: "Cancel" }).click();
        await dialog.waitFor({ state: "detached" });
      });
    }, 60_000);

    it(`test_SB_033_${where}_request_opens_its_existing_page`, async () => {
      await withPage(width, async (p) => {
        const m = await openMenu(p, width);
        await m.getByRole("menuitem", { name: "Request" }).click();
        expect(await pushes(p)).toEqual(["/w/acme/requests"]);
      });
    }, 60_000);

    it(`test_SB_033_${where}_task_on_project_route_opens_that_projects_new_task_flow`, async () => {
      await withPage(
        width,
        async (p) => {
          const m = await openMenu(p, width);
          await m.getByRole("menuitem", { name: "Task" }).click();
          expect(await events(p)).toEqual([{ projectId: "p-42" }]);
          expect(await pushes(p)).toEqual([]);
        },
        { path: "/w/acme/projects/p-42/board" },
      );
    }, 60_000);

    it(`test_SB_033_${where}_task_outside_project_goes_to_projects_page`, async () => {
      await withPage(width, async (p) => {
        const m = await openMenu(p, width);
        await m.getByRole("menuitem", { name: "Task" }).click();
        expect(await pushes(p)).toEqual(["/w/acme/projects"]);
        expect(await events(p)).toEqual([]);
      });
    }, 60_000);
  });

  describe(`F009 SB-034 + New role gating (${where})`, () => {
    it(`test_SB_034_${where}_guest_with_manage_flag_sees_no_new_button`, async () => {
      await withPage(
        width,
        async (p) => {
          const s = await scope(p, width);
          // Positive control: the neighbouring Search button IS there.
          await s.getByRole("button", { name: /Search/ }).waitFor({ state: "visible" });
          expect(await s.getByRole("button", { name: /^New$/ }).count()).toBe(0);
        },
        { guest: true, manage: true, role: "guest" },
      );
    }, 60_000);

    it(`test_SB_034_${where}_guest_flag_alone_hides_button_even_if_role_is_member`, async () => {
      await withPage(
        width,
        async (p) => {
          const s = await scope(p, width);
          await s.getByRole("button", { name: /Search/ }).waitFor({ state: "visible" });
          expect(await s.getByRole("button", { name: /^New$/ }).count()).toBe(0);
        },
        { guest: true, manage: true, role: "member" },
      );
    }, 60_000);

    it(`test_SB_034_${where}_member_sees_task_and_project_but_not_request`, async () => {
      await withPage(
        width,
        async (p) => {
          const m = await openMenu(p, width);
          expect((await items(m)).map((t) => t.trim())).toEqual(["Task", "Project"]);
        },
        { role: "member", manage: false },
      );
    }, 60_000);

    it(`test_SB_034_${where}_viewer_who_cannot_manage_sees_no_new_button`, async () => {
      await withPage(
        width,
        async (p) => {
          const s = await scope(p, width);
          await s.getByRole("button", { name: /Search/ }).waitFor({ state: "visible" });
          expect(await s.getByRole("button", { name: /^New$/ }).count()).toBe(0);
        },
        { role: "viewer", manage: false },
      );
    }, 60_000);

    it(`test_SB_034_${where}_admin_without_client_workspace_gets_no_request_entry`, async () => {
      await withPage(
        width,
        async (p) => {
          const m = await openMenu(p, width);
          expect((await items(m)).map((t) => t.trim())).toEqual(["Task", "Project"]);
        },
        { hasClient: false },
      );
    }, 60_000);
  });
}
