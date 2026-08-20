// F288 — AS-548: page URL, browser name+version, OS, viewport size, device
//         pixel ratio.
//         AS-549: reporter identity and capture timestamp.
//
// This feature's scope is a single collector module
// (extension/src/capture/environment.ts) with no popup UI wiring yet (a
// later feature wires it into a capture flow), so there is no
// `data-testid` button to drive. To still test it as *real, unstubbed
// browser state* (per this feature's testing instructions) rather than a
// unit test against a mocked DOM, this transpiles the actual source file
// with the TypeScript compiler (already a devDependency — no new tooling)
// and injects the compiled module into a real extension page loaded by
// Playwright/Chromium (same `launchExtension` harness every other spec in
// this suite uses), then calls the real exported function from the page
// and asserts against the page's own real `navigator`/`window`/`Intl`
// state (e.g. comparing the collector's viewport numbers against the
// page's actual `window.innerWidth`/`innerHeight`).
import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import ts from "typescript";

const distPath = path.resolve(import.meta.dirname, "..", "dist");
const sourcePath = path.resolve(
  import.meta.dirname,
  "..",
  "src",
  "capture",
  "environment.ts",
);

test.beforeAll(() => {
  if (!fs.existsSync(path.join(distPath, "manifest.json"))) {
    throw new Error(
      `Extension build not found at ${distPath}. Run "npm run build" in extension/ before the Playwright test.`,
    );
  }
  writeCompiledModule();
});

// The extension's own manifest CSP (`script-src 'self'`) blocks inline
// `<script>` injection, so the compiled module is written into `dist/`
// (served from the extension's own `chrome-extension://` origin, which
// `'self'` permits) rather than injected as inline content.
const compiledModulePath = path.join(distPath, "__f288-environment-test.js");

function writeCompiledModule(): void {
  const source = fs.readFileSync(sourcePath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  // Expose the exports on `window` so a plain (non-module) page.evaluate
  // can call them — the transpiled module itself is loaded as a real
  // <script type="module"> so its own `export`/`import` syntax is valid.
  fs.writeFileSync(
    compiledModulePath,
    `${outputText}\nwindow.__env = { collectEnvironmentMetadata, UNKNOWN };`,
  );
}

test.afterAll(() => {
  fs.rmSync(compiledModulePath, { force: true });
});

async function launchExtension(): Promise<{
  context: BrowserContext;
  extensionId: string;
}> {
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    args: [
      `--disable-extensions-except=${distPath}`,
      `--load-extension=${distPath}`,
    ],
  });

  let worker = context.serviceWorkers()[0];
  if (!worker) {
    worker = await context.waitForEvent("serviceworker", { timeout: 10_000 });
  }
  const extensionId = worker.url().split("/")[2];
  return { context, extensionId };
}

async function loadCollectorOnPopup(
  context: BrowserContext,
  extensionId: string,
): Promise<Page> {
  const popupPage = await context.newPage();
  await popupPage.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
  await popupPage.addScriptTag({ url: "/__f288-environment-test.js", type: "module" });
  await popupPage.waitForFunction(() => "__env" in window);
  return popupPage;
}

test("AS_548_reports_real_page_url_browser_os_viewport_and_device_pixel_ratio", async () => {
  const { context, extensionId } = await launchExtension();

  try {
    const popupPage = await loadCollectorOnPopup(context, extensionId);
    await popupPage.setViewportSize({ width: 640, height: 480 });

    const [result, realState] = await Promise.all([
      popupPage.evaluate(() =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__env.collectEnvironmentMetadata({ id: null, email: null }),
      ),
      popupPage.evaluate(() => ({
        href: window.location.href,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        hasUserAgentData: typeof (navigator as unknown as { userAgentData?: unknown })
          .userAgentData !== "undefined",
      })),
    ]);

    // Real page URL, not a placeholder.
    expect(result.pageUrl).toBe(realState.href);
    expect(result.pageUrl.startsWith("chrome-extension://")).toBe(true);

    // Real viewport, matches the page's own reported size.
    expect(result.viewportWidth).toBe(realState.innerWidth);
    expect(result.viewportHeight).toBe(realState.innerHeight);

    // Real device pixel ratio.
    expect(result.devicePixelRatio).toBe(realState.devicePixelRatio);

    // Chromium extension popup context genuinely has userAgentData
    // (confirms this feature's "confirm this rather than assuming"
    // instruction) — the collector must have used it, not the fallback
    // parse path, and must report real, non-"unknown" browser/OS values.
    expect(realState.hasUserAgentData).toBe(true);
    expect(result.source).toBe("userAgentData");
    expect(result.browserName).not.toBe("unknown");
    expect(result.browserVersion).not.toBe("unknown");
    expect(result.os).not.toBe("unknown");
    expect(typeof result.browserName).toBe("string");
    expect(result.browserName.length).toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});

test("AS_548_falls_back_to_user_agent_string_parsing_when_userAgentData_is_unavailable", async () => {
  const { context, extensionId } = await launchExtension();

  try {
    const popupPage = await context.newPage();
    // Real removal of the API (not a stub returning fake data) — proves
    // the fallback path itself is real, not just reachable in theory.
    await popupPage.addInitScript(() => {
      Object.defineProperty(navigator, "userAgentData", {
        value: undefined,
        configurable: true,
      });
    });
    await popupPage.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await popupPage.addScriptTag({ url: "/__f288-environment-test.js", type: "module" });
    await popupPage.waitForFunction(() => "__env" in window);

    const result = await popupPage.evaluate(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__env.collectEnvironmentMetadata({ id: null, email: null }),
    );

    expect(result.source).toBe("userAgentParse");
    // Real Chromium UA string still parses to a real, non-"unknown" name —
    // proves the fallback path itself does real work, not just returns
    // "unknown" for everything.
    expect(result.browserName).not.toBe("unknown");
    expect(["Chrome", "Edge", "Opera"]).toContain(result.browserName);
  } finally {
    await context.close();
  }
});

test("AS_548_reports_unknown_rather_than_guessing_when_no_browser_api_is_available", async () => {
  const { context, extensionId } = await launchExtension();

  try {
    const popupPage = await context.newPage();
    // Both real information sources removed/emptied — the genuine
    // "could not be determined" case, not a synthetic default.
    await popupPage.addInitScript(() => {
      Object.defineProperty(navigator, "userAgentData", {
        value: undefined,
        configurable: true,
      });
      Object.defineProperty(navigator, "userAgent", {
        value: "",
        configurable: true,
      });
    });
    await popupPage.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await popupPage.addScriptTag({ url: "/__f288-environment-test.js", type: "module" });
    await popupPage.waitForFunction(() => "__env" in window);

    const result = await popupPage.evaluate(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__env.collectEnvironmentMetadata({ id: null, email: null }),
    );

    expect(result.source).toBe("unknown");
    expect(result.browserName).toBe("unknown");
    expect(result.browserVersion).toBe("unknown");
    expect(result.os).toBe("unknown");
  } finally {
    await context.close();
  }
});

test("AS_549_records_reporter_identity_when_known_and_unknown_when_not", async () => {
  const { context, extensionId } = await launchExtension();

  try {
    const popupPage = await loadCollectorOnPopup(context, extensionId);

    const known = await popupPage.evaluate(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__env.collectEnvironmentMetadata({
        id: "user-123",
        email: "reporter@example.com",
      }),
    );
    expect(known.reporterId).toBe("user-123");
    expect(known.reporterEmail).toBe("reporter@example.com");

    const unknownReporter = await popupPage.evaluate(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__env.collectEnvironmentMetadata({ id: null, email: undefined }),
    );
    expect(unknownReporter.reporterId).toBe("unknown");
    expect(unknownReporter.reporterEmail).toBe("unknown");
  } finally {
    await context.close();
  }
});

test("AS_549_captures_an_instant_plus_the_reporters_iana_timezone_matching_the_mission_convention", async () => {
  const { context, extensionId } = await launchExtension();

  try {
    const popupPage = await loadCollectorOnPopup(context, extensionId);

    const before = Date.now();
    const result = await popupPage.evaluate(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__env.collectEnvironmentMetadata({ id: null, email: null }),
    );
    const after = Date.now();

    // capturedAt: a real ISO 8601 UTC instant close to "now", not a
    // pre-formatted local string (F124's convention — see
    // lib/time/user-timezone.ts).
    expect(result.capturedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    const capturedMs = new Date(result.capturedAt).getTime();
    expect(capturedMs).toBeGreaterThanOrEqual(before - 1000);
    expect(capturedMs).toBeLessThanOrEqual(after + 1000);

    // timeZone: the reporter's real IANA zone, sibling field to the
    // instant — never baked into a formatted string.
    const realTimeZone = await popupPage.evaluate(
      () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    expect(result.timeZone).toBe(realTimeZone);
    expect(result.timeZone).not.toBe("unknown");
  } finally {
    await context.close();
  }
});

test("AS_549_records_unknown_timezone_rather_than_throwing_when_Intl_cannot_resolve_one", async () => {
  const { context, extensionId } = await launchExtension();

  try {
    const popupPage = await context.newPage();
    // Real failure injected at the API boundary this module actually
    // calls (Intl.DateTimeFormat) — proves the "unknown, never throws"
    // path is exercised for real, not merely plausible by inspection.
    await popupPage.addInitScript(() => {
      const OriginalDateTimeFormat = Intl.DateTimeFormat;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Intl as any).DateTimeFormat = function (...args: unknown[]) {
        if (args.length === 0) {
          throw new Error("Simulated Intl failure for AS-549 unknown-timezone test.");
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return new (OriginalDateTimeFormat as any)(...args);
      };
    });
    await popupPage.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await popupPage.addScriptTag({ url: "/__f288-environment-test.js", type: "module" });
    await popupPage.waitForFunction(() => "__env" in window);

    const result = await popupPage.evaluate(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__env.collectEnvironmentMetadata({ id: null, email: null }),
    );

    expect(result.timeZone).toBe("unknown");
    // The rest of the collector still completes without throwing.
    expect(typeof result.capturedAt).toBe("string");
  } finally {
    await context.close();
  }
});
