// F295 — AS-560: pure assembly-logic tests for
// `extension/src/submit/describe.ts`'s buildTaskDescription().
//
// `describe.ts` is pure (no chrome.* API, no DOM), but this workspace has
// no vitest setup for pure TS logic — F287's `selector.ts` established the
// pattern this follows instead: transpile the real source with the
// TypeScript compiler and run the real exported function inside a real
// browser page loaded by Playwright, rather than inventing a new test
// runner for this one module.
import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import ts from "typescript";

const distPath = path.resolve(import.meta.dirname, "..", "dist");
const sourcePath = path.resolve(import.meta.dirname, "..", "src", "submit", "describe.ts");

test.beforeAll(() => {
  if (!fs.existsSync(path.join(distPath, "manifest.json"))) {
    throw new Error(
      `Extension build not found at ${distPath}. Run "npm run build" in extension/ before the Playwright test.`,
    );
  }
  writeCompiledModule();
});

const compiledModulePath = path.join(distPath, "__f295-describe-test.js");

function writeCompiledModule(): void {
  const source = fs.readFileSync(sourcePath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  fs.writeFileSync(
    compiledModulePath,
    `${outputText}\nwindow.__describe = { buildTaskDescription };`,
  );
}

test.afterAll(() => {
  fs.rmSync(compiledModulePath, { force: true });
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
  return { context, extensionId };
}

async function loadDescribeOnPopup(context: BrowserContext, extensionId: string): Promise<Page> {
  const popupPage = await context.newPage();
  await popupPage.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
  await popupPage.addScriptTag({ url: "/__f295-describe-test.js", type: "module" });
  await popupPage.waitForFunction(() => "__describe" in window);
  return popupPage;
}

const ENV = {
  pageUrl: "https://example.com/page",
  browserName: "Chrome",
  browserVersion: "128",
  os: "macOS",
  viewportWidth: 1280,
  viewportHeight: 800,
  devicePixelRatio: 2,
};

test("AS_560_metadata_block_contains_environment_details_in_readable_form", async () => {
  const { context, extensionId } = await launchExtension();
  try {
    const popupPage = await loadDescribeOnPopup(context, extensionId);
    const result = await popupPage.evaluate(
      (env) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__describe.buildTaskDescription({
          reporterText: "The button does not work.",
          environment: env,
        }),
      ENV,
    );
    expect(result).toContain("https://example.com/page");
    expect(result).toContain("Chrome 128");
    expect(result).toContain("macOS");
    expect(result).toContain("1280 x 800");
    expect(result).toContain("2");
  } finally {
    await context.close();
  }
});

test("AS_560_reporters_own_text_comes_before_the_metadata_block", async () => {
  const { context, extensionId } = await launchExtension();
  try {
    const popupPage = await loadDescribeOnPopup(context, extensionId);
    const result = await popupPage.evaluate(
      (env) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__describe.buildTaskDescription({
          reporterText: "MY OWN WORDS FIRST",
          environment: env,
          element: { selector: "#submit-button", rect: { x: 10, y: 20, width: 100, height: 40 } },
        }),
      ENV,
    );
    const reporterIndex = result.indexOf("MY OWN WORDS FIRST");
    const metadataIndex = result.indexOf("Technical details");
    expect(reporterIndex).toBeGreaterThanOrEqual(0);
    expect(metadataIndex).toBeGreaterThan(reporterIndex);
  } finally {
    await context.close();
  }
});

test("AS_560_omits_empty_sections_rather_than_rendering_none_noise", async () => {
  const { context, extensionId } = await launchExtension();
  try {
    const popupPage = await loadDescribeOnPopup(context, extensionId);
    const result = await popupPage.evaluate(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__describe.buildTaskDescription({
        reporterText: "Just words, nothing captured.",
        environment: null,
        element: null,
      }),
    );
    expect(result).toBe("Just words, nothing captured.");
    expect(result).not.toContain("Technical details");
    expect(result).not.toContain("Element");
  } finally {
    await context.close();
  }
});

test("AS_560_element_section_included_when_present", async () => {
  const { context, extensionId } = await launchExtension();
  try {
    const popupPage = await loadDescribeOnPopup(context, extensionId);
    const result = await popupPage.evaluate(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__describe.buildTaskDescription({
        reporterText: "Broke here.",
        element: { selector: "#submit-button", rect: { x: 12, y: 34, width: 56, height: 78 } },
      }),
    );
    expect(result).toContain("Picked element:");
    expect(result).toContain("#submit-button");
  } finally {
    await context.close();
  }
});

// M19 scrutiny BLOCKER-1 (AS-547): the picker collects the element's
// position and size (`rect`) and the popup displays it to the reporter, but
// prior to this fix the submit boundary (report-form.tsx) discarded it,
// sending only `{ selector }`. This test follows the value all the way into
// the SUBMITTED DESCRIPTION STRING that report-form.tsx actually sends to
// POST /api/extension/tasks (buildTaskDescription's return value IS that
// string — see describe.ts's file header) rather than stopping at the
// picker's own return value the way `element-picker-selector.spec.ts:288`
// does, which is exactly why that test could pass against the broken
// behaviour.
test("AS_547_submitted_description_contains_selector_and_position_and_size", async () => {
  const { context, extensionId } = await launchExtension();
  try {
    const popupPage = await loadDescribeOnPopup(context, extensionId);
    const submittedDescription = await popupPage.evaluate(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__describe.buildTaskDescription({
        reporterText: "The submit button is unresponsive.",
        element: {
          selector: "#unique-target",
          rect: { x: 20, y: 20, width: 100, height: 40 },
        },
      }),
    );
    // A CSS selector...
    expect(submittedDescription).toContain("#unique-target");
    // ...AND the element's position and size, both present in the same
    // string that is actually sent to the server.
    expect(submittedDescription).toContain("20, 20");
    expect(submittedDescription).toContain("100 x 40");
  } finally {
    await context.close();
  }
});
