// Audit SEC-EXT-04: pure test for describe.ts's redactPageUrl — the page URL
// written into a task description drops its query string and fragment
// (which can carry OAuth codes/tokens) unless the reporter opts in.
//
// Node-only: transpiles describe.ts in memory and imports it as a data: URL.
// No browser, no extension build needed.
import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { Buffer } from "node:buffer";
import ts from "typescript";

const sourcePath = path.resolve(import.meta.dirname, "..", "src", "submit", "describe.ts");

async function loadDescribe(): Promise<typeof import("../src/submit/describe")> {
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}

test("SEC-EXT-04: query and fragment are stripped by default", async () => {
  const { redactPageUrl } = await loadDescribe();
  expect(
    redactPageUrl("https://app.example.com/callback?code=abc&state=xyz#access_token=secret", false),
  ).toBe("https://app.example.com/callback");
  expect(redactPageUrl("https://app.example.com/a/b#frag", false)).toBe("https://app.example.com/a/b");
  expect(redactPageUrl("https://app.example.com/plain", false)).toBe("https://app.example.com/plain");
});

test("SEC-EXT-04: the full URL is kept only on explicit opt-in", async () => {
  const { redactPageUrl } = await loadDescribe();
  const full = "https://app.example.com/p?q=1#h";
  expect(redactPageUrl(full, true)).toBe(full);
});

test("SEC-EXT-04: the redacted URL is what lands in the description", async () => {
  const { buildTaskDescription, redactPageUrl } = await loadDescribe();
  const out = buildTaskDescription({
    reporterText: "Broken",
    environment: {
      pageUrl: redactPageUrl("https://x.test/cb?token=t0k3n", false),
      browserName: "Chrome",
      browserVersion: "140",
      os: "macOS",
      viewportWidth: 1,
      viewportHeight: 1,
      devicePixelRatio: 1,
    },
  });
  expect(out).toContain("URL: https://x.test/cb");
  expect(out).not.toContain("t0k3n");
});
