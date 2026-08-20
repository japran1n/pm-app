// F289 — AS-550 (console errors/warnings are attached to the report),
// AS-551 (capture is bounded), AS-552 (the limitation is stated
// plainly).
//
// Same split as F287's element-picker-selector.spec.ts:
//
// 1. Pure logic (serializeLogArgument in console-hook.ts, RingBuffer in
//    ring-buffer.ts) needs no chrome.* permission at all — tested by
//    transpiling the real shipped source (TypeScript compiler API,
//    type-erasure only, no reimplementation) and running it in a plain
//    Playwright page.
// 2. The full live capture flow (real popup + real
//    chrome.scripting.executeScript, world: "MAIN", against a real
//    page), following the same `host_permissions: ["http://localhost:3000/*"]`
//    trick F287/F281 established so this can run without a real
//    toolbar-icon gesture.
import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import ts from "typescript";

const distPath = path.resolve(import.meta.dirname, "..", "dist");
const consoleHookSourcePath = path.resolve(import.meta.dirname, "..", "src", "capture", "console-hook.ts");
const ringBufferSourcePath = path.resolve(import.meta.dirname, "..", "src", "capture", "ring-buffer.ts");

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

test.describe("AS_550/AS_551 pure logic (real console-hook.ts and ring-buffer.ts)", () => {
  test("AS_550_serializes_a_plain_string_and_number_argument_readably", async () => {
    const context = await chromium.launch({ headless: true });
    const page = await context.newPage();
    try {
      await page.addScriptTag({ content: transpileToGlobals(consoleHookSourcePath) });
      const result = await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const serializeLogArgument = (window as any).serializeLogArgument;
        return [serializeLogArgument("boom"), serializeLogArgument(42)];
      });
      expect(result).toEqual(["boom", "42"]);
    } finally {
      await context.close();
    }
  });

  test("AS_550_serialization_never_throws_on_circular_objects_DOM_nodes_Errors_undefined_or_functions", async () => {
    const context = await chromium.launch({ headless: true });
    const page = await context.newPage();
    try {
      await page.addScriptTag({ content: transpileToGlobals(consoleHookSourcePath) });
      await page.setContent(`<div id="probe">hi</div>`);
      const result = await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const serializeLogArgument = (window as any).serializeLogArgument;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const circular: any = { a: 1 };
        circular.self = circular;

        const outputs: string[] = [];
        let threw = false;
        try {
          outputs.push(serializeLogArgument(circular));
          outputs.push(serializeLogArgument(document.getElementById("probe")));
          outputs.push(serializeLogArgument(new Error("kaboom")));
          outputs.push(serializeLogArgument(undefined));
          outputs.push(serializeLogArgument(null));
          outputs.push(serializeLogArgument(function namedFn() {}));
          outputs.push(serializeLogArgument(Symbol("sym")));
        } catch {
          threw = true;
        }
        return { threw, outputs };
      });
      expect(result.threw).toBe(false);
      expect(result.outputs).toHaveLength(7);
      for (const out of result.outputs) {
        expect(typeof out).toBe("string");
        expect(out.length).toBeGreaterThan(0);
      }
      expect(result.outputs[1]).toContain("div");
      expect(result.outputs[1]).toContain("probe");
      expect(result.outputs[2]).toContain("kaboom");
      expect(result.outputs[3]).toBe("undefined");
      expect(result.outputs[4]).toBe("null");
      expect(result.outputs[5]).toContain("namedFn");
    } finally {
      await context.close();
    }
  });

  test("AS_551_RingBuffer_evicts_the_oldest_entry_once_over_capacity", async () => {
    const context = await chromium.launch({ headless: true });
    const page = await context.newPage();
    try {
      await page.addScriptTag({ content: transpileToGlobals(ringBufferSourcePath) });
      const result = await page.evaluate(() => {
        // `class` declarations at top level are global *bindings* but,
        // unlike `function`/`var`, are not attached as a property of
        // `window` — reference the identifier directly rather than via
        // `(window as any).RingBuffer`.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const RingBufferCtor = (0, eval)("RingBuffer");
        const buf = new RingBufferCtor(3);
        buf.push("a");
        buf.push("b");
        buf.push("c");
        buf.push("d"); // evicts "a"
        buf.push("e"); // evicts "b"
        return { all: buf.getAll(), length: buf.length };
      });
      expect(result.length).toBe(3);
      expect(result.all).toEqual(["c", "d", "e"]);
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
  <p>console capture fixture</p>
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

async function openPopup(context: BrowserContext, extensionId: string, contentPage: Page): Promise<Page> {
  const popupPage = await context.newPage();
  await popupPage.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
  await contentPage.bringToFront();
  return popupPage;
}

test.describe("AS_550/AS_551/AS_552 live console capture (real chrome.scripting.executeScript, world: MAIN)", () => {
  test("AS_552_the_limitation_is_stated_plainly_in_the_popup", async () => {
    const server = await startFixtureServer();
    const { context, extensionId } = await launchExtension();
    try {
      const contentPage = await context.newPage();
      await contentPage.goto("http://localhost:3000/");
      const popupPage = await openPopup(context, extensionId, contentPage);

      await expect(popupPage.getByTestId("console-capture-limitation")).toBeVisible();
      const text = await popupPage.getByTestId("console-capture-limitation").textContent();
      expect(text?.toLowerCase()).toContain("after you start capturing");
    } finally {
      await context.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("AS_550_real_console_error_and_warn_calls_made_after_injection_are_captured_with_the_right_level_and_message", async () => {
    const server = await startFixtureServer();
    const { context, extensionId } = await launchExtension();
    try {
      const contentPage = await context.newPage();
      await contentPage.goto("http://localhost:3000/");
      const popupPage = await openPopup(context, extensionId, contentPage);

      await contentPage.bringToFront();
      await popupPage.getByTestId("console-capture-start-button").click();
      await expect(popupPage.getByTestId("console-capture-limitation")).toBeVisible();
      await expect(popupPage.getByText("Console capture running")).toBeVisible({ timeout: 10_000 });

      await contentPage.evaluate(() => {
        console.error("something broke", { code: 42 });
        console.warn("heads up");
        console.log("should not be captured (log level excluded by design)");
      });

      await popupPage.getByTestId("console-capture-refresh-button").click();
      await expect(popupPage.getByTestId("console-capture-count")).toHaveText("2 messages captured.", {
        timeout: 10_000,
      });

      const entries = popupPage.getByTestId("console-capture-entry");
      await expect(entries).toHaveCount(2);
      const firstText = await entries.nth(0).textContent();
      const secondText = await entries.nth(1).textContent();
      expect(firstText).toContain("error");
      expect(firstText).toContain("something broke");
      expect(secondText).toContain("warn");
      expect(secondText).toContain("heads up");
    } finally {
      await context.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("AS_550_uncaught_errors_and_unhandled_rejections_are_also_captured", async () => {
    const server = await startFixtureServer();
    const { context, extensionId } = await launchExtension();
    try {
      const contentPage = await context.newPage();
      await contentPage.goto("http://localhost:3000/");
      const popupPage = await openPopup(context, extensionId, contentPage);

      await contentPage.bringToFront();
      await popupPage.getByTestId("console-capture-start-button").click();
      await expect(popupPage.getByText("Console capture running")).toBeVisible({ timeout: 10_000 });

      await contentPage.evaluate(() => {
        setTimeout(() => {
          throw new Error("uncaught boom");
        }, 0);
      });
      await contentPage.evaluate(() => {
        Promise.reject(new Error("unhandled rejection boom"));
      });
      // Give the browser a beat to dispatch the error/unhandledrejection
      // events before reading the buffer back.
      await contentPage.waitForTimeout(300);

      await popupPage.getByTestId("console-capture-refresh-button").click();
      await expect(popupPage.getByTestId("console-capture-list")).toBeVisible({ timeout: 10_000 });

      const listText = await popupPage.getByTestId("console-capture-list").textContent();
      expect(listText).toContain("uncaught boom");
      expect(listText).toContain("unhandled rejection boom");
      expect(listText).toContain("onerror");
      expect(listText).toContain("unhandledrejection");
    } finally {
      await context.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("AS_551_the_buffer_is_bounded_older_entries_are_evicted_once_over_capacity", async () => {
    const server = await startFixtureServer();
    const { context, extensionId } = await launchExtension();
    try {
      const contentPage = await context.newPage();
      await contentPage.goto("http://localhost:3000/");
      const popupPage = await openPopup(context, extensionId, contentPage);

      await contentPage.bringToFront();
      await popupPage.getByTestId("console-capture-start-button").click();
      await expect(popupPage.getByText("Console capture running")).toBeVisible({ timeout: 10_000 });

      // MAX_CONSOLE_ENTRIES is 200 — log well past it and confirm the
      // buffer does not keep growing (bounded) and the oldest entries
      // (the "log-000".."log-049" range) are evicted, not the earliest
      // capacity's worth kept forever.
      await contentPage.evaluate(() => {
        for (let i = 0; i < 250; i++) {
          console.error(`log-${String(i).padStart(3, "0")}`);
        }
      });

      await popupPage.getByTestId("console-capture-refresh-button").click();
      await expect(popupPage.getByTestId("console-capture-count")).toHaveText("200 messages captured.", {
        timeout: 10_000,
      });

      const entries = popupPage.getByTestId("console-capture-entry");
      await expect(entries).toHaveCount(200);
      const firstText = await entries.nth(0).textContent();
      const lastText = await entries.nth(199).textContent();
      // The oldest 50 (log-000..log-049) were evicted; the buffer starts
      // at log-050 and ends at log-249.
      expect(firstText).toContain("log-050");
      expect(lastText).toContain("log-249");
    } finally {
      await context.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("AS_550_messages_logged_before_capture_starts_are_not_included", async () => {
    const server = await startFixtureServer();
    const { context, extensionId } = await launchExtension();
    try {
      const contentPage = await context.newPage();
      await contentPage.goto("http://localhost:3000/");

      // Logged BEFORE the popup even opens / before capture starts —
      // per AS-552's stated limitation, this must never show up.
      await contentPage.evaluate(() => console.error("before capture started"));

      const popupPage = await openPopup(context, extensionId, contentPage);
      await contentPage.bringToFront();
      await popupPage.getByTestId("console-capture-start-button").click();
      await expect(popupPage.getByText("Console capture running")).toBeVisible({ timeout: 10_000 });

      await contentPage.evaluate(() => console.error("after capture started"));

      await popupPage.getByTestId("console-capture-refresh-button").click();
      await expect(popupPage.getByTestId("console-capture-count")).toHaveText("1 message captured.", {
        timeout: 10_000,
      });
      const listText = await popupPage.getByTestId("console-capture-list").textContent();
      expect(listText).toContain("after capture started");
      expect(listText).not.toContain("before capture started");
    } finally {
      await context.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
