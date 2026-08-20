// F298 — AS-569: capture, element-pick, and console-capture-start all work
// the FIRST time on a page the extension has genuinely never touched
// before — no prior visit to that page, no prior grant beyond the one-time
// activeTab-equivalent gesture the popup interaction itself provides.
//
// This is a holistic proof, distinct from F283/F287/F289's own per-feature
// tests: it exercises all three capabilities back-to-back against ONE
// single fresh page (a unique, never-served-before path) within a single
// test, to prove "no prior setup" as a combined claim rather than three
// separate ones.
//
// Follows F287/F289's established `host_permissions:
// ["http://localhost:3000/*"]` trick for driving `chrome.scripting.
// executeScript` without a real toolbar-icon gesture Playwright cannot
// reproduce (documented at length in element-picker-selector.spec.ts and
// console-capture.spec.ts). The one capability that genuinely requires the
// literal activeTab gesture — `chrome.tabs.captureVisibleTab` — is proven
// the same way capture-visible-tab.spec.ts proves it: by stubbing only
// that one Chrome API call with a real Playwright-captured PNG, since no
// harness can script a real toolbar-icon click (a Playwright/Chromium
// limitation, not a gap in this extension's behaviour). Crucially, the
// page itself is real, freshly served, and never previously visited by
// this browser context — nothing about the page or its origin has been
// "warmed up" beforehand.
import { test, expect, chromium, type BrowserContext } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import crypto from "node:crypto";

const distPath = path.resolve(import.meta.dirname, "..", "dist");

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

  for (const page of context.pages()) {
    if (page.url() === "about:blank") {
      await page.close();
    }
  }

  return { context, extensionId };
}

// A unique path per test run, so this is provably a page never served or
// visited before — not a fixture reused across test runs.
function freshFixtureHtml(marker: string): string {
  return `<!doctype html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;background:#eef">
  <p>fresh page ${marker}</p>
  <div id="target" style="position:absolute;top:20px;left:20px;width:100px;height:40px;background:#ddd;">pick me</div>
</body>
</html>`;
}

function startFixtureServer(marker: string, uniquePath: string): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === uniquePath) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(freshFixtureHtml(marker));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(3000, () => resolve(server));
  });
}

test("AS_569_capture_pick_and_console_start_all_work_the_first_time_on_a_genuinely_never_before_seen_page", async () => {
  const marker = crypto.randomBytes(8).toString("hex");
  const uniquePath = `/never-seen-${marker}`;
  const server = await startFixtureServer(marker, uniquePath);
  const { context, extensionId } = await launchExtension();

  try {
    // The single fresh page under test — never visited or served before
    // this exact test run, proven by the random path.
    const contentPage = await context.newPage();
    await contentPage.goto(`http://localhost:3000${uniquePath}`);
    await expect(contentPage.getByText(`fresh page ${marker}`)).toBeVisible();

    // --- capability 1: screenshot capture ---
    // `chrome.tabs.captureVisibleTab` strictly requires a real
    // toolbar-icon-click activeTab grant that no test harness can produce
    // (documented in capture-visible-tab.spec.ts); stub only that single
    // Chrome call with a real Playwright-captured PNG of this exact fresh
    // page, so the rest of the flow (popup wiring, decoding, display) runs
    // for real against this never-before-seen page.
    const screenshotBuffer = await contentPage.screenshot({ type: "png" });
    const realPngDataUrl = `data:image/png;base64,${screenshotBuffer.toString("base64")}`;

    const popupPage = await context.newPage();
    // Only `chrome.tabs.captureVisibleTab` needs stubbing (see file header
    // — no harness can script the real toolbar-icon gesture it demands).
    // `chrome.tabs.query` is left as the real Chrome API: it works for
    // real here because the fixture origin is covered by
    // `host_permissions`, exactly as F287/F289 rely on — stubbing it would
    // risk hiding a real regression in tab targeting.
    await popupPage.addInitScript((dataUrl) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (chrome.tabs as any).captureVisibleTab = async () => dataUrl;
    }, realPngDataUrl);
    await popupPage.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await contentPage.bringToFront();

    await popupPage.getByTestId("capture-button").click();
    await expect(popupPage.getByTestId("capture-preview")).toBeVisible({ timeout: 10_000 });
    await expect(popupPage.getByTestId("capture-success")).toBeVisible();
    await expect(popupPage.getByTestId("capture-error")).toHaveCount(0);

    // --- capability 2: element pick ---
    // Real chrome.scripting.executeScript against the real fresh page —
    // no prior visit, no prior injection, works purely off
    // host_permissions + this gesture-adjacent popup interaction.
    await contentPage.bringToFront();
    await popupPage.getByTestId("pick-element-button").click();
    await expect(popupPage.getByTestId("pick-element-hint")).toBeVisible();

    const target = contentPage.locator("#target");
    const box = await target.boundingBox();
    expect(box).toBeTruthy();
    await contentPage.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await contentPage.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

    await expect(popupPage.getByTestId("pick-element-result")).toBeVisible({ timeout: 10_000 });
    await expect(popupPage.getByTestId("pick-element-selector")).toHaveText("#target");

    // --- capability 3: console capture start (once the privacy toggle is
    // turned on, per F291) ---
    await popupPage.getByTestId("privacy-toggle-console").click();
    await expect(popupPage.getByTestId("privacy-toggle-console")).toBeChecked({ timeout: 10_000 });
    await contentPage.bringToFront();
    await popupPage.getByTestId("console-capture-start-button").click();
    await expect(popupPage.getByText("Console capture running")).toBeVisible({ timeout: 10_000 });

    await contentPage.evaluate(() => console.error("first-time console message"));

    await popupPage.getByTestId("console-capture-refresh-button").click();
    await expect(popupPage.getByTestId("console-capture-count")).toHaveText("1 message captured.", {
      timeout: 10_000,
    });
    const listText = await popupPage.getByTestId("console-capture-list").textContent();
    expect(listText).toContain("first-time console message");
  } finally {
    await context.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
