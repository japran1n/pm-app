// F036 (SB-030 / AS-017): measure, in real Chromium, the Suspense fallback
// (WorkspaceSwitcherSkeleton) against the resolved WorkspaceSwitcher inside the
// same header row markup the sidebar uses. Not under test / stubbed: next/link.
// Real: WorkspaceSwitcher, WorkspaceLogo, Button, skeletons, app globals.css.
// @vitest-environment node
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

const root = process.cwd();
let css = "";
let js = "";

const LONG = "ABCDEFGHIJ KLMNOPQRST UVWXYZ0123 456789ABCD";
const SHORT = "Acme";
// Documented ceiling from components/workspace-switcher.tsx.
const CEILING_ROW_H = 90 + 12; // trigger max 90 + header row py-1.5

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "f036-"));
  const entry = join(dir, "entry.tsx");
  writeFileSync(
    entry,
    `import React from "react";
import { createRoot } from "react-dom/client";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { WorkspaceSwitcherSkeleton } from "@/components/nav/figures/skeletons";
const Row = ({ id, children }: any) => (
  <aside style={{ width: 256 }}><div id={id} className="flex min-h-12 items-center gap-2 border-b px-3 py-1.5">
    <div className="min-w-0 flex-1">{children}</div>
    <span className="inline-flex h-[38px] w-[38px] shrink-0" />
  </div></aside>
);
const ws = (name: string) => [{ id: "w1", name, slug: "a" }];
createRoot(document.getElementById("root")!).render(
  <>
    <Row id="fb"><WorkspaceSwitcherSkeleton /></Row>
    <Row id="short"><WorkspaceSwitcher workspaces={ws(${JSON.stringify(SHORT)})} currentWorkspaceId="w1" /></Row>
    <Row id="huge"><WorkspaceSwitcher workspaces={ws(${JSON.stringify("WORD".repeat(30))})} currentWorkspaceId="w1" /></Row>
    <Row id="long"><WorkspaceSwitcher workspaces={ws(${JSON.stringify(LONG)})} currentWorkspaceId="w1" /></Row>
  </>
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
          b.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next/link", namespace: "stub" }));
          b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
            contents: `import React from "react"; export default function Link({href,prefetch,scroll,replace,children,...r}){return React.createElement("a",{href:String(href),...r},children)}`,
            loader: "tsx",
            resolveDir: root,
          }));
          b.onResolve({ filter: /^@\// }, (a) => {
            const base = join(root, a.path.slice(2));
            for (const ext of [".tsx", ".ts", "/index.tsx", "/index.ts"]) {
              try {
                readFileSync(base + ext);
                return { path: base + ext };
              } catch {}
            }
            return undefined;
          });
        },
      },
    ],
  });
  js = res.outputFiles[0].text;
  const file = join(root, "app/globals.css");
  css = (await postcss([tailwind()]).process(readFileSync(file, "utf8"), { from: file })).css;
}, 180_000);

async function heights(): Promise<{ fbBox: number; shortBox: number; fb: number; short: number; long: number; huge: number }> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body><div id="root"></div></body></html>`);
    await page.addScriptTag({ content: js });
    await page.waitForFunction(() => (window as unknown as { __mounted?: boolean }).__mounted === true);
    await page.waitForSelector("#long button");
    const out = await page.evaluate(() => {
      const h = (id: string) => document.getElementById(id)!.getBoundingClientRect().height;
      const box = (id: string) => document.querySelector(`#${id} .flex-1 > *`)!.getBoundingClientRect().height;
      return { fbBox: box("fb"), shortBox: box("short"), fb: h("fb"), short: h("short"), long: h("long"), huge: h("huge") };
    });
    expect(errors).toEqual([]);
    return out;
  } finally {
    await browser.close();
  }
}

describe("F036 SB-030/AS-017 switcher skeleton footprint (measured)", () => {
  it("test_SB_030_fallback_height_matches_resolved_single_line_header_within_1px", async () => {
    const h = await heights();
    expect(Math.abs(h.fb - h.short), `fallback ${h.fb} vs resolved ${h.short}`).toBeLessThanOrEqual(1);
    // The header row's min-h-12 can mask a wrong skeleton, so also compare the
    // placeholder box itself against the resolved trigger box.
    expect(Math.abs(h.fbBox - h.shortBox), `box ${h.fbBox} vs ${h.shortBox}`).toBeLessThanOrEqual(1);
  }, 60_000);

  it("test_SB_030_long_name_resolved_header_stays_under_documented_ceiling", async () => {
    const h = await heights();
    expect(h.long).toBeGreaterThan(h.short); // it does wrap (name not truncated)
    expect(h.long).toBeLessThanOrEqual(CEILING_ROW_H);
    // A pathological 120-char name must not grow the row past the ceiling.
    expect(h.huge).toBeLessThanOrEqual(CEILING_ROW_H);
  }, 60_000);
});
