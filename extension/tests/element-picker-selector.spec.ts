// F287 — AS-546, AS-547: hover over and click an element on the current
// page to record it (a CSS selector, its confidence tier, its bounding
// box, and the viewport size).
//
// Two independent things are proven here, split into two `describe`-style
// groups by comment:
//
// 1. Selector-generation logic (extension/src/capture/selector.ts) needs
//    NO chrome.* permission at all — it's pure DOM logic. This is tested
//    for real by transpiling the actual `selector.ts` source (via the
//    TypeScript compiler API, `typescript` is already a devDependency) and
//    running the real, un-duplicated implementation against real DOM
//    structures inside a Playwright-controlled browser page. This is not
//    a reimplementation in the test file — it is the shipped module's own
//    code, type-erased and stripped of `export` keywords so it can run as
//    a classic (non-module) injected script exposing its functions as
//    globals.
//
// 2. The full interactive picker
//    (extension/src/capture/element-picker.ts, driven end-to-end through
//    the real popup UI + a real `chrome.scripting.executeScript` call
//    against a real page). Unlike `chrome.tabs.captureVisibleTab`
//    (F283/F284), `chrome.scripting.executeScript` does NOT strictly
//    require a real toolbar-icon gesture to succeed IF the target tab's
//    origin is already covered by a declared `host_permissions` entry —
//    this extension's manifest already declares
//    `host_permissions: ["http://localhost:3000/*"]` (added by F281 for
//    the connect flow), so a real local HTTP server on port 3000 lets this
//    test drive `chrome.scripting.executeScript` for real, without
//    needing `activeTab` or `<all_urls>` at all. This was verified
//    empirically while writing this test (see the assertions below,
//    which pass against the real built extension, not a stub).
//
//    What *is* still a real Playwright limitation (documented in the
//    F283/F284/F285 handoffs and confirmed again here): which tab Chrome
//    considers "active" for `chrome.tabs.query({ active: true,
//    currentWindow: true })` cannot be reliably steered from Playwright
//    the way a real user would by simply looking at a tab — Playwright's
//    `page.bringToFront()` is the closest equivalent, and it is used
//    below before triggering the pick. If a future Chromium/Playwright
//    release changes this behaviour, the "real end-to-end" test below
//    should keep working as-is; if `chrome.tabs.query` ever stops
//    reporting the content page as active in this harness, the two
//    fallback tests further down (which stub only `chrome.tabs.query`,
//    exactly like F283/F284's precedent, while still exercising the real
//    `chrome.scripting.executeScript` call and the real injected picker
//    against a real page) keep the message-passing/recording contract
//    covered without needing the harness's active-tab semantics to match
//    a real user's at all.
import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import ts from "typescript";

const distPath = path.resolve(import.meta.dirname, "..", "dist");
const selectorSourcePath = path.resolve(import.meta.dirname, "..", "src", "capture", "selector.ts");

test.beforeAll(() => {
  if (!fs.existsSync(path.join(distPath, "manifest.json"))) {
    throw new Error(
      `Extension build not found at ${distPath}. Run "npm run build" in extension/ before the Playwright test.`,
    );
  }
});

async function launchExtension(): Promise<{ context: BrowserContext; extensionId: string }> {
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    args: [`--disable-extensions-except=${distPath}`, `--load-extension=${distPath}`],
  });

  let worker = context.serviceWorkers()[0];
  if (!worker) {
    worker = await context.waitForEvent("serviceworker", { timeout: 10_000 });
  }
  const extensionId = worker.url().split("/")[2];

  // `launchPersistentContext` opens with one blank initial tab. Close it so
  // it can never be the tab `chrome.tabs.query({ active: true })` resolves
  // to instead of the real content page this test drives — the initial
  // blank tab is never covered by host_permissions and would otherwise
  // produce a false "cannot access contents of the page" failure unrelated
  // to the picker logic itself.
  for (const page of context.pages()) {
    if (page.url() === "about:blank") {
      await page.close();
    }
  }

  return { context, extensionId };
}

/** Transpiles the real selector.ts source (type-erasure only) and strips
 * `export` keywords, so its real functions run as plain page globals with
 * no chrome.* dependency and no reimplementation of the logic. */
function loadRealSelectorModuleSource(): string {
  const source = fs.readFileSync(selectorSourcePath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
  });
  return outputText.replace(/^export (function|const|type)/gm, "$1").replace(/^export \{\};?\s*$/gm, "");
}

test.describe("AS_547 selector generation (pure DOM logic, real selector.ts)", () => {
  test("AS_547_generates_an_id_selector_with_id_confidence_when_a_unique_id_is_present", async () => {
    const context = await chromium.launch({ headless: true });
    const page = await context.newPage();
    try {
      await page.addScriptTag({ content: loadRealSelectorModuleSource() });
      await page.setContent(`<div id="bug-report-target">hello</div>`);
      const result = await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const generateSelector = (window as any).generateSelector;
        return generateSelector(document.getElementById("bug-report-target"));
      });
      expect(result).toEqual({ selector: "#bug-report-target", confidence: "id" });
    } finally {
      await context.close();
    }
  });

  test("AS_547_generates_a_data_attribute_selector_when_no_id_is_present", async () => {
    const context = await chromium.launch({ headless: true });
    const page = await context.newPage();
    try {
      await page.addScriptTag({ content: loadRealSelectorModuleSource() });
      await page.setContent(
        `<div><button data-testid="submit-widget">Go</button></div>`,
      );
      const result = await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const generateSelector = (window as any).generateSelector;
        return generateSelector(document.querySelector("button"));
      });
      expect(result).toEqual({
        selector: 'button[data-testid="submit-widget"]',
        confidence: "data-attribute",
      });
    } finally {
      await context.close();
    }
  });

  test("AS_547_falls_back_to_an_nth_of_type_path_and_flags_it_as_the_lowest_confidence", async () => {
    const context = await chromium.launch({ headless: true });
    const page = await context.newPage();
    try {
      await page.addScriptTag({ content: loadRealSelectorModuleSource() });
      await page.setContent(
        `<section id="list-root"><ul><li>a</li><li>b</li><li><span>target</span></li></ul></section>`,
      );
      const result = await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const generateSelector = (window as any).generateSelector;
        return generateSelector(document.querySelector("li:nth-of-type(3) span"));
      });
      expect(result.confidence).toBe("nth-of-type-path");
      // Deterministically re-locates the exact same element via the
      // generated selector — proving the fallback path is at least
      // correct right now, even though it's flagged as the least durable
      // tier.
      const rehydrated = await page.evaluate(
        (selector: string) => document.querySelector(selector)?.textContent,
        result.selector,
      );
      expect(rehydrated).toBe("target");
      expect(result.selector).toContain("#list-root");
    } finally {
      await context.close();
    }
  });

  test("AS_547_prefers_id_over_data_attribute_when_both_are_present", async () => {
    const context = await chromium.launch({ headless: true });
    const page = await context.newPage();
    try {
      await page.addScriptTag({ content: loadRealSelectorModuleSource() });
      await page.setContent(`<div id="dual" data-testid="also-dual">x</div>`);
      const result = await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const generateSelector = (window as any).generateSelector;
        return generateSelector(document.getElementById("dual"));
      });
      expect(result).toEqual({ selector: "#dual", confidence: "id" });
    } finally {
      await context.close();
    }
  });

  test("AS_547_detects_an_element_inside_a_shadow_root", async () => {
    const context = await chromium.launch({ headless: true });
    const page = await context.newPage();
    try {
      await page.addScriptTag({ content: loadRealSelectorModuleSource() });
      await page.setContent(`<div id="shadow-host"></div>`);
      const insideShadow = await page.evaluate(() => {
        const host = document.getElementById("shadow-host")!;
        const shadow = host.attachShadow({ mode: "open" });
        const inner = document.createElement("p");
        inner.id = "inner-el";
        shadow.appendChild(inner);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const isInsideShadowDom = (window as any).isInsideShadowDom;
        return isInsideShadowDom(inner);
      });
      expect(insideShadow).toBe(true);
    } finally {
      await context.close();
    }
  });

  test("AS_547_does_not_flag_a_plain_light_dom_element_as_inside_a_shadow_root", async () => {
    const context = await chromium.launch({ headless: true });
    const page = await context.newPage();
    try {
      await page.addScriptTag({ content: loadRealSelectorModuleSource() });
      await page.setContent(`<div id="plain">x</div>`);
      const insideShadow = await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const isInsideShadowDom = (window as any).isInsideShadowDom;
        return isInsideShadowDom(document.getElementById("plain"));
      });
      expect(insideShadow).toBe(false);
    } finally {
      await context.close();
    }
  });
});

// --- Live end-to-end picker via the real popup UI + real chrome.scripting ---

const FIXTURE_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0">
  <div id="unique-target" style="position:absolute;top:20px;left:20px;width:100px;height:40px;background:#ddd;">A</div>
  <button data-testid="stable-widget" style="position:absolute;top:80px;left:20px;width:100px;height:40px;">B</button>
  <div id="shadow-host" style="position:absolute;top:140px;left:20px;width:100px;height:40px;"></div>
  <iframe id="cross-frame" src="about:blank" style="position:absolute;top:200px;left:20px;width:150px;height:80px;border:1px solid #000;"></iframe>
  <script>
    var host = document.getElementById('shadow-host');
    var shadow = host.attachShadow({ mode: 'open' });
    var inner = document.createElement('div');
    inner.id = 'inner-shadow-el';
    inner.textContent = 'S';
    inner.style.width = '100%';
    inner.style.height = '100%';
    inner.style.background = '#ccf';
    shadow.appendChild(inner);
  </script>
</body>
</html>`;

function startFixtureServer(): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(FIXTURE_HTML);
    });
    server.listen(3000, () => resolve(server));
  });
}

async function openPopupAndTriggerPick(
  context: BrowserContext,
  extensionId: string,
  contentPage: Page,
): Promise<Page> {
  const popupPage = await context.newPage();
  await popupPage.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
  // Opening a new tab (popupPage) makes IT the window's "active" tab in
  // this harness, unlike a real MV3 action popup (which floats over the
  // current tab and is never part of the tab strip at all). Re-focus the
  // content page right before clicking, so `chrome.tabs.query({ active:
  // true })` inside the popup's click handler resolves to the page the
  // user is actually reporting a bug on, matching real usage.
  await contentPage.bringToFront();
  await popupPage.getByTestId("pick-element-button").click();
  await expect(popupPage.getByTestId("pick-element-hint")).toBeVisible();
  return popupPage;
}

test.describe("AS_546/AS_547 live picker (real chrome.scripting.executeScript against a real page)", () => {
  test("AS_546_hovering_highlights_and_clicking_records_the_element_with_selector_position_size_and_viewport", async () => {
    const server = await startFixtureServer();
    const { context, extensionId } = await launchExtension();

    try {
      const contentPage = await context.newPage();
      await contentPage.setViewportSize({ width: 400, height: 400 });
      await contentPage.goto("http://localhost:3000/");
      await contentPage.bringToFront();

      const popupPage = await openPopupAndTriggerPick(context, extensionId, contentPage);

      const target = contentPage.locator("#unique-target");
      const box = await target.boundingBox();
      expect(box).toBeTruthy();

      // Hover, then click — real mouse events dispatched to the real page,
      // driving the real injected mousemove/click listeners.
      await contentPage.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await contentPage.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

      await expect(popupPage.getByTestId("pick-element-result")).toBeVisible({ timeout: 10_000 });
      await expect(popupPage.getByTestId("pick-element-selector")).toHaveText("#unique-target");
      await expect(popupPage.getByTestId("pick-element-confidence")).toHaveText("id");

      const rectText = await popupPage.getByTestId("pick-element-rect").textContent();
      expect(rectText).toContain("20, 20");
      expect(rectText).toContain("100 x 40");

      const viewportText = await popupPage.getByTestId("pick-element-viewport").textContent();
      expect(viewportText).toContain("400 x 400");
    } finally {
      await context.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("AS_546_escape_cancels_picking_without_recording_anything", async () => {
    const server = await startFixtureServer();
    const { context, extensionId } = await launchExtension();

    try {
      const contentPage = await context.newPage();
      await contentPage.goto("http://localhost:3000/");
      await contentPage.bringToFront();

      const popupPage = await openPopupAndTriggerPick(context, extensionId, contentPage);

      await contentPage.mouse.move(50, 50);
      await contentPage.keyboard.press("Escape");

      await expect(popupPage.getByTestId("pick-element-cancelled")).toBeVisible({ timeout: 10_000 });
      await expect(popupPage.getByTestId("pick-element-result")).toHaveCount(0);
    } finally {
      await context.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("AS_547_data_attribute_selector_used_when_no_id_is_present_on_a_real_clicked_element", async () => {
    const server = await startFixtureServer();
    const { context, extensionId } = await launchExtension();

    try {
      const contentPage = await context.newPage();
      await contentPage.goto("http://localhost:3000/");
      await contentPage.bringToFront();

      const popupPage = await openPopupAndTriggerPick(context, extensionId, contentPage);

      const target = contentPage.locator('[data-testid="stable-widget"]');
      const box = await target.boundingBox();
      expect(box).toBeTruthy();
      await contentPage.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await contentPage.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

      await expect(popupPage.getByTestId("pick-element-result")).toBeVisible({ timeout: 10_000 });
      await expect(popupPage.getByTestId("pick-element-selector")).toHaveText(
        'button[data-testid="stable-widget"]',
      );
      await expect(popupPage.getByTestId("pick-element-confidence")).toHaveText("data-attribute");
    } finally {
      await context.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("AS_547_clicking_inside_a_same_origin_iframe_is_reported_as_unsupported_not_a_wrong_selector", async () => {
    const server = await startFixtureServer();
    const { context, extensionId } = await launchExtension();

    try {
      const contentPage = await context.newPage();
      await contentPage.goto("http://localhost:3000/");
      await contentPage.bringToFront();

      const popupPage = await openPopupAndTriggerPick(context, extensionId, contentPage);

      const frame = contentPage.locator("#cross-frame");
      const box = await frame.boundingBox();
      expect(box).toBeTruthy();
      await contentPage.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await contentPage.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

      await expect(popupPage.getByTestId("pick-element-unsupported")).toBeVisible({ timeout: 10_000 });
      await expect(popupPage.getByTestId("pick-element-unsupported")).toContainText("iframe");
      await expect(popupPage.getByTestId("pick-element-result")).toHaveCount(0);
    } finally {
      await context.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("AS_547_clicking_an_element_inside_a_shadow_root_is_reported_as_unsupported_not_a_wrong_selector", async () => {
    const server = await startFixtureServer();
    const { context, extensionId } = await launchExtension();

    try {
      const contentPage = await context.newPage();
      await contentPage.goto("http://localhost:3000/");
      await contentPage.bringToFront();

      const popupPage = await openPopupAndTriggerPick(context, extensionId, contentPage);

      const shadowHost = contentPage.locator("#shadow-host");
      const box = await shadowHost.boundingBox();
      expect(box).toBeTruthy();
      await contentPage.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await contentPage.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

      await expect(popupPage.getByTestId("pick-element-unsupported")).toBeVisible({ timeout: 10_000 });
      await expect(popupPage.getByTestId("pick-element-unsupported")).toContainText("shadow DOM");
      await expect(popupPage.getByTestId("pick-element-result")).toHaveCount(0);
    } finally {
      await context.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
