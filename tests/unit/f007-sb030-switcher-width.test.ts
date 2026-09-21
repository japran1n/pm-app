// F007 (SB-030) reuses the F025 real-Chromium pipeline.
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
import { chromium, type Browser, type Locator, type Page } from "@playwright/test";

const root = process.cwd();
let css = "";
let js = "";

const STUBS: Record<string, string> = {
  "next/navigation": `export const usePathname=()=>"/w/acme"; export const useRouter=()=>({push(){},replace(){},refresh(){},prefetch(){},back(){},forward(){}});`,
  "next/link": `import React from "react"; export default function Link({href,prefetch,scroll,replace,children,...r}){return React.createElement("a",{href:typeof href==="string"?href:String(href),...r},children)}`,
  "next-themes": `export const useTheme=()=>({theme:"light",resolvedTheme:"light",setTheme(){}});`,
  "sonner": `export const toast={error(){},success(){}};`,
  "@/components/notifications/notification-bell": `import React from "react"; export const NotificationBell=()=>React.createElement("button",{type:"button","aria-label":"Notifications",className:"inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-md border border-border max-md:size-11"});`,
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
createRoot(document.getElementById("root")!).render(
  <AppSidebar workspaceSlug="acme" workspaces={[{id:"w1",name:(window as any).__NAME || "ABCDEFGHIJ KLMNOPQRST UVWXYZ0123 456789ABCD",slug:"acme"}]} currentWorkspaceId="w1"
    currentUser={{id:"u1",name:"T",email:"t@example.com",avatarUrl:null}} isGuest={false} canManageWorkspace={true}
    projects={[{id:"p1",name:"Apollo Launch",slug:"apollo"}] as never} />
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

async function withPage<T>(width: number, name: string, fn: (p: Page) => Promise<T>): Promise<T> {
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.setContent(
      `<!doctype html><html><head><style>${css}</style></head><body><div id="root"></div></body></html>`,
    );
    await page.evaluate((n) => { (window as unknown as { __NAME: string }).__NAME = n; }, name);
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

const NAME = "ABCDEFGHIJ KLMNOPQRST UVWXYZ0123 456789ABCD";
const NAME_NOSPACE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCD";

// Measures the trigger inside `scope`: is the full name laid out with no
// clipping, and how wide is the trigger relative to its column?
function measure(scope: Locator, NAME: string) {
  return scope.evaluate((root, name) => {
    const btn = Array.from(root.querySelectorAll<HTMLElement>("button")).find((b) =>
      (b.textContent ?? "").replace(/\s+/g, " ").includes(name),
    )!;
    const span = Array.from(btn.querySelectorAll<HTMLElement>("span")).find((s) =>
      (s.textContent ?? "").includes(name),
    )!;
    const cs = getComputedStyle(span);
    const col = btn.parentElement!.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    const r = document.createRange();
    r.selectNodeContents(span);
    const rects = Array.from(r.getClientRects());
    const sp = span.getBoundingClientRect();
    const row = btn.parentElement!.parentElement!.getBoundingClientRect();
    const aside = (btn.closest("aside,[role=dialog]") as HTMLElement);
    const acs = getComputedStyle(aside);
    const asideInner =
      aside.getBoundingClientRect().width -
      parseFloat(acs.paddingLeft) - parseFloat(acs.paddingRight) -
      parseFloat(acs.borderLeftWidth) - parseFloat(acs.borderRightWidth);
    const rowEl = btn.parentElement!.parentElement!;
    const rcs = getComputedStyle(rowEl);
    const bellEl = aside.querySelector<HTMLElement>('button[aria-label="Notifications"]')!;
    const bell = bellEl.getBoundingClientRect();
    const bellInHeaderRow = rowEl.contains(bellEl);
    const bellVisible = bell.width > 0 && bell.left >= aside.getBoundingClientRect().left && bell.right <= aside.getBoundingClientRect().right + 0.5;
    const asideW = aside.getBoundingClientRect().width;
    const rowPadX = parseFloat(rcs.paddingLeft) + parseFloat(rcs.paddingRight);
    const rowGap = parseFloat(rcs.columnGap);
    const rowBorderX = parseFloat(rcs.borderLeftWidth) + parseFloat(rcs.borderRightWidth);
    const nextSib = btn.parentElement!.parentElement!.nextElementSibling!.getBoundingClientRect();
    return {
      inRow: b.top >= row.top - 0.5 && b.bottom <= row.bottom + 0.5 && b.left >= row.left - 0.5 && b.right <= row.right + 0.5,
      rowRect: [row.top, row.bottom],
      btnRect: [b.top, b.bottom],
      labelInViewport: rects.length > 0 && rects.every((x) => x.top >= 0 && x.bottom <= innerHeight),
      overlapsNext: b.bottom > nextSib.top + 0.5,
      asideInner,
      rowInner: row.width,
      textOverflow: cs.textOverflow,
      // Real (non-tautological) clamp check: with a line-clamp, hidden lines
      // make scrollHeight exceed clientHeight.
      labelHidden: span.scrollHeight > span.clientHeight + 1,
      bellWidth: bell.width,
      bellInHeaderRow,
      bellVisible,
      asideW,
      rowPadX,
      rowGap,
      rowBorderX,
      textInsideSpan: rects.every((x) => x.right <= sp.right + 1 && x.left >= sp.left - 1),
      btnWidth: b.width,
      colWidth: col.width,
      title: btn.getAttribute("title"),
      btnScrollH: btn.scrollHeight,
      btnH: b.height,
    };
  }, NAME);
}

// F027: containment, not self-fit. The trigger must sit inside the header row,
// the label must be inside the viewport vertically, it must not overlap the
// block below, and it must span the sidebar's own inner width (minus the row's
// horizontal padding and the bell) -- compared against the aside, not the
// flex-1 column that matches the button by construction.
function expectContained(m: Awaited<ReturnType<typeof measure>>) {
  expect(m.inRow, `btn ${m.btnRect} vs row ${m.rowRect}`).toBe(true);
  expect(m.labelInViewport).toBe(true);
  expect(m.overlapsNext).toBe(false);
  expect(m.labelHidden, "40-char name must be fully visible (SB-030)").toBe(false);
  // F038: the bell no longer shares the header row, so the trigger spans the
  // FULL sidebar inner width: aside - border - row padding. It must not be
  // reduced by a bell or gap. The bell stays reachable elsewhere in the aside.
  expect(m.bellInHeaderRow, "bell must not steal width from the switcher row").toBe(false);
  expect(m.bellVisible, "bell must remain reachable inside the sidebar").toBe(true);
  expect(m.bellWidth).toBeGreaterThanOrEqual(38);
  const expected = m.asideInner - m.rowBorderX - m.rowPadX;
  expect(Math.abs(m.btnWidth - expected), `btn ${m.btnWidth} vs expected ${expected}`).toBeLessThanOrEqual(1);
  // ...and that is the sidebar's inner width less only the 12px row padding each side.
  expect(Math.abs(m.btnWidth - (m.asideW - 24)), `btn ${m.btnWidth} vs aside ${m.asideW}`).toBeLessThanOrEqual(2);
  // Vertical ceiling (documented in workspace-switcher.tsx): the label is
  // capped at 6 lines, so the trigger can never exceed WORKSPACE_TRIGGER_MAX_H.
  expect(m.btnH).toBeLessThanOrEqual(TRIGGER_MAX_H);
}

// 6 lines x 20px (text-sm line-height) + py-1 (8) + 1px borders (2) = 130.
const TRIGGER_MAX_H = 130;

const CASES: Array<[string, string]> = [["spaced", NAME], ["nospace", NAME_NOSPACE], ["short-words", "AAAAAAAA BBBBBBBB CCCCCCCC DDDDDDDD EEEEEEEE"]];

describe("F007/F038 SB-030 workspace switcher full width, 40-char name", () => {
  for (const width of [1440, 1280]) {
    for (const [label, nm] of CASES) {
      it(`test_SB_030_desktop_${width}_${label}_name_fully_visible_and_trigger_full_width`, async () => {
        await withPage(width, nm, async (p) => {
          const m = await measure(p.locator("aside"), nm);
          expect(m.textOverflow).not.toBe("ellipsis");
          expect(m.textInsideSpan).toBe(true);
          expect(m.btnH).toBeGreaterThanOrEqual(m.btnScrollH - 1);
          expect(m.title).toBe(nm);
          expectContained(m);
        });
      }, 60_000);
    }
  }

  for (const [label, nm] of CASES) {
    it(`test_SB_030_375px_sheet_${label}_name_fully_visible_and_trigger_full_width`, async () => {
      await withPage(375, nm, async (p) => {
        await p.getByRole("button", { name: "Open navigation" }).click();
        const dialog = p.getByRole("dialog");
        await dialog.waitFor({ state: "visible" });
        const m = await measure(dialog, nm);
        expect(m.textOverflow).not.toBe("ellipsis");
        expect(m.textInsideSpan).toBe(true);
        expect(m.btnH).toBeGreaterThanOrEqual(m.btnScrollH - 1);
        expect(m.title).toBe(nm);
        expectContained(m);
      });
    }, 60_000);
  }

  it("test_SB_030_search_and_new_controls_still_fit_at_240px", async () => {
    await withPage(1280, NAME, async (p) => {
      const r = await p.locator("aside").evaluate((a) => {
        const aw = a.getBoundingClientRect();
        const btns = Array.from(a.querySelectorAll<HTMLElement>("button")).filter((b) => /Search|Notifications/.test((b.textContent ?? "") + (b.getAttribute("aria-label") ?? "")));
        return btns.map((b) => { const x = b.getBoundingClientRect(); return { w: x.width, l: x.left - aw.left, r: aw.right - x.right, sh: b.scrollWidth - b.clientWidth }; });
      });
      expect(r.length).toBe(2);
      for (const c of r) { expect(c.w).toBeGreaterThan(30); expect(c.l).toBeGreaterThanOrEqual(0); expect(c.r).toBeGreaterThanOrEqual(0); expect(c.sh).toBeLessThanOrEqual(1); }
    });
  }, 60_000);
});
