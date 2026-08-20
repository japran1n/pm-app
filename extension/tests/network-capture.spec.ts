// F290 — AS-553 (failed requests visible to the page are captured).
//
// Same split as F287/F289's Playwright suites:
//
// 1. Pure logic (redactUrl in network-hook.ts) needs no chrome.*
//    permission at all — tested by transpiling the real shipped source
//    (TypeScript compiler API, type-erasure only, no reimplementation)
//    and running it in a plain Playwright page.
// 2. The full live capture flow (real popup + real
//    chrome.scripting.executeScript, world: "MAIN", against a real
//    page + a real local HTTP server that can return 4xx/5xx statuses
//    and genuinely fail requests), following the same
//    `host_permissions: ["http://localhost:3000/*"]` trick F281/F287/
//    F289 established so this can run without a real toolbar-icon
//    gesture.
import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import ts from "typescript";

const distPath = path.resolve(import.meta.dirname, "..", "dist");
const networkHookSourcePath = path.resolve(import.meta.dirname, "..", "src", "capture", "network-hook.ts");

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

function transpileToGlobals(sourcePath: string): string {
  const source = fs.readFileSync(sourcePath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
  });
  return outputText
    .replace(/^export (async function|function|const|type|class)/gm, "$1")
    .replace(/^export \{\};?\s*$/gm, "");
}

test.describe("AS_553 pure logic (real network-hook.ts)", () => {
  test("AS_553_redactUrl_redacts_token_query_param_values_but_keeps_path_and_other_params", async () => {
    const context = await chromium.launch({ headless: true });
    const page = await context.newPage();
    try {
      await page.addScriptTag({ content: transpileToGlobals(networkHookSourcePath) });
      const result = await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const redactUrl = (window as any).redactUrl;
        return [
          redactUrl("http://localhost:3000/api/things?token=abc123&page=2"),
          redactUrl("http://localhost:3000/api/things?apiKey=xyz&keep=me"),
          redactUrl("http://localhost:3000/api/things?page=2"),
        ];
      });
      expect(result[0]).toContain("token=%5BREDACTED%5D");
      expect(result[0]).toContain("page=2");
      expect(result[0]).toContain("/api/things");
      expect(result[0]).not.toContain("abc123");

      expect(result[1]).toContain("apiKey=%5BREDACTED%5D");
      expect(result[1]).toContain("keep=me");
      expect(result[1]).not.toContain("xyz");

      // No secret-looking params — URL passed through unchanged.
      expect(result[2]).toBe("http://localhost:3000/api/things?page=2");
    } finally {
      await context.close();
    }
  });
});

// --- Live end-to-end capture via the real popup UI + real chrome.scripting ---

const FIXTURE_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0">
  <p>network capture fixture</p>
</body>
</html>`;

function startFixtureServer(): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost:3000");
      if (url.pathname === "/api/ok") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (url.pathname === "/api/notfound") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }
      if (url.pathname === "/api/servererror") {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "boom" }));
        return;
      }
      if (url.pathname === "/network-error") {
        // Destroy the connection outright to simulate a genuine network
        // failure (not just a bad status code) rather than a slow
        // timeout, so the test stays fast and deterministic.
        req.socket.destroy();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(FIXTURE_HTML);
    });
    server.listen(3000, () => resolve(server));
  });
}

async function openPopup(context: BrowserContext, extensionId: string, contentPage: Page): Promise<Page> {
  const popupPage = await context.newPage();
  await popupPage.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
  await contentPage.bringToFront();
  return popupPage;
}

test.describe("AS_553 live network capture (real chrome.scripting.executeScript, world: MAIN)", () => {
  test("AS_553_a_failed_fetch_with_a_4xx_or_5xx_status_is_captured_with_method_url_status", async () => {
    const server = await startFixtureServer();
    const { context, extensionId } = await launchExtension();
    try {
      const contentPage = await context.newPage();
      await contentPage.goto("http://localhost:3000/");
      const popupPage = await openPopup(context, extensionId, contentPage);

      await contentPage.bringToFront();
      // F291: capture is gated behind a persisted, private-by-default
      // toggle now — turn it on before starting capture, matching the
      // real reporter flow.
      await popupPage.getByTestId("privacy-toggle-network").click();
      await expect(popupPage.getByTestId("privacy-toggle-network")).toBeChecked({ timeout: 10_000 });
      await popupPage.getByTestId("network-capture-start-button").click();
      await expect(popupPage.getByText("Network capture running")).toBeVisible({ timeout: 10_000 });

      await contentPage.evaluate(async () => {
        await fetch("/api/notfound");
        await fetch("/api/servererror", { method: "POST" });
      });

      await popupPage.getByTestId("network-capture-refresh-button").click();
      await expect(popupPage.getByTestId("network-capture-count")).toHaveText("2 failed requests captured.", {
        timeout: 10_000,
      });

      const entries = popupPage.getByTestId("network-capture-entry");
      await expect(entries).toHaveCount(2);
      const firstText = await entries.nth(0).textContent();
      const secondText = await entries.nth(1).textContent();
      expect(firstText).toContain("GET");
      expect(firstText).toContain("/api/notfound");
      expect(firstText).toContain("404");
      expect(secondText).toContain("POST");
      expect(secondText).toContain("/api/servererror");
      expect(secondText).toContain("500");
    } finally {
      await context.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("AS_553_a_genuinely_network_erroring_fetch_is_captured", async () => {
    const server = await startFixtureServer();
    const { context, extensionId } = await launchExtension();
    try {
      const contentPage = await context.newPage();
      await contentPage.goto("http://localhost:3000/");
      const popupPage = await openPopup(context, extensionId, contentPage);

      await contentPage.bringToFront();
      // F291: capture is gated behind a persisted, private-by-default
      // toggle now — turn it on before starting capture, matching the
      // real reporter flow.
      await popupPage.getByTestId("privacy-toggle-network").click();
      await expect(popupPage.getByTestId("privacy-toggle-network")).toBeChecked({ timeout: 10_000 });
      await popupPage.getByTestId("network-capture-start-button").click();
      await expect(popupPage.getByText("Network capture running")).toBeVisible({ timeout: 10_000 });

      await contentPage.evaluate(async () => {
        try {
          await fetch("/network-error");
        } catch {
          // expected — the connection is destroyed by the server
        }
      });

      await popupPage.getByTestId("network-capture-refresh-button").click();
      await expect(popupPage.getByTestId("network-capture-count")).toHaveText("1 failed request captured.", {
        timeout: 10_000,
      });

      const entryText = await popupPage.getByTestId("network-capture-entry").textContent();
      expect(entryText).toContain("network-error");
      expect(entryText).toContain("network error");
    } finally {
      await context.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("AS_553_a_successful_2xx_fetch_is_not_captured", async () => {
    const server = await startFixtureServer();
    const { context, extensionId } = await launchExtension();
    try {
      const contentPage = await context.newPage();
      await contentPage.goto("http://localhost:3000/");
      const popupPage = await openPopup(context, extensionId, contentPage);

      await contentPage.bringToFront();
      // F291: capture is gated behind a persisted, private-by-default
      // toggle now — turn it on before starting capture, matching the
      // real reporter flow.
      await popupPage.getByTestId("privacy-toggle-network").click();
      await expect(popupPage.getByTestId("privacy-toggle-network")).toBeChecked({ timeout: 10_000 });
      await popupPage.getByTestId("network-capture-start-button").click();
      await expect(popupPage.getByText("Network capture running")).toBeVisible({ timeout: 10_000 });

      await contentPage.evaluate(async () => {
        await fetch("/api/ok");
      });

      await popupPage.getByTestId("network-capture-refresh-button").click();
      await expect(popupPage.getByTestId("network-capture-count")).toHaveText("0 failed requests captured.", {
        timeout: 10_000,
      });
      await expect(popupPage.getByTestId("network-capture-entry")).toHaveCount(0);
    } finally {
      await context.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("AS_553_an_XHR_based_failed_request_is_also_captured_not_just_fetch", async () => {
    const server = await startFixtureServer();
    const { context, extensionId } = await launchExtension();
    try {
      const contentPage = await context.newPage();
      await contentPage.goto("http://localhost:3000/");
      const popupPage = await openPopup(context, extensionId, contentPage);

      await contentPage.bringToFront();
      // F291: capture is gated behind a persisted, private-by-default
      // toggle now — turn it on before starting capture, matching the
      // real reporter flow.
      await popupPage.getByTestId("privacy-toggle-network").click();
      await expect(popupPage.getByTestId("privacy-toggle-network")).toBeChecked({ timeout: 10_000 });
      await popupPage.getByTestId("network-capture-start-button").click();
      await expect(popupPage.getByText("Network capture running")).toBeVisible({ timeout: 10_000 });

      await contentPage.evaluate(() => {
        return new Promise<void>((resolve) => {
          const xhr = new XMLHttpRequest();
          xhr.open("GET", "/api/servererror");
          xhr.addEventListener("loadend", () => resolve());
          xhr.send();
        });
      });

      await popupPage.getByTestId("network-capture-refresh-button").click();
      await expect(popupPage.getByTestId("network-capture-count")).toHaveText("1 failed request captured.", {
        timeout: 10_000,
      });
      const entryText = await popupPage.getByTestId("network-capture-entry").textContent();
      expect(entryText).toContain("GET");
      expect(entryText).toContain("/api/servererror");
      expect(entryText).toContain("500");
    } finally {
      await context.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("AS_553_a_token_query_param_in_a_captured_URL_is_redacted_rest_of_url_intact", async () => {
    const server = await startFixtureServer();
    const { context, extensionId } = await launchExtension();
    try {
      const contentPage = await context.newPage();
      await contentPage.goto("http://localhost:3000/");
      const popupPage = await openPopup(context, extensionId, contentPage);

      await contentPage.bringToFront();
      // F291: capture is gated behind a persisted, private-by-default
      // toggle now — turn it on before starting capture, matching the
      // real reporter flow.
      await popupPage.getByTestId("privacy-toggle-network").click();
      await expect(popupPage.getByTestId("privacy-toggle-network")).toBeChecked({ timeout: 10_000 });
      await popupPage.getByTestId("network-capture-start-button").click();
      await expect(popupPage.getByText("Network capture running")).toBeVisible({ timeout: 10_000 });

      await contentPage.evaluate(async () => {
        await fetch("/api/notfound?token=super-secret-value&page=3");
      });

      await popupPage.getByTestId("network-capture-refresh-button").click();
      await expect(popupPage.getByTestId("network-capture-count")).toHaveText("1 failed request captured.", {
        timeout: 10_000,
      });
      const entryText = await popupPage.getByTestId("network-capture-entry").textContent();
      expect(entryText).not.toContain("super-secret-value");
      expect(entryText).toContain("/api/notfound");
      expect(entryText).toContain("page=3");
      expect(entryText).toContain("REDACTED");
    } finally {
      await context.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
