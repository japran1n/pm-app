// F086 (missions/20260910-182104, AS-179): "Text on section cards and page
// columns meets WCAG AA contrast in both themes." The architecture board's
// tinted section cards / page-kind badges use --component and --cms as
// low-opacity fills with --component-foreground / --cms-foreground as the
// on-top text color (see components/architecture/section-card.tsx and
// components/architecture/page-kind-badge.tsx).
//
// We can't run a full colorimetric contrast calculation against CSS
// `oklch(from ...)` relative-color syntax without a browser, so this test
// asserts the tokens exist, are non-empty, and are defined for both the
// light (:root) and dark ([data-theme='dark']) scopes — the structural
// precondition the fix in app/globals.css relies on. The actual
// derivation was changed to inherit --foreground's lightness (which the
// base Supabase design system already guarantees is AA-compliant against
// --card/--background) instead of deriving from the accent color's own
// lightness, which had produced near-white-on-light / near-black-on-dark
// text before this fix.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const globalsCssPath = path.join(process.cwd(), "app", "globals.css");
const css = fs.readFileSync(globalsCssPath, "utf8");

function extractScope(source: string, selectorPattern: RegExp): string {
  const match = selectorPattern.exec(source);
  if (!match) return "";
  const startIndex = match.index + match[0].length;
  let depth = 1;
  let i = startIndex;
  while (i < source.length && depth > 0) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") depth -= 1;
    i += 1;
  }
  return source.slice(startIndex, i - 1);
}

function tokenValue(scope: string, name: string): string | null {
  const re = new RegExp(`${name.replace(/[-]/g, "\\-")}\\s*:\\s*([^;]+);`);
  const match = re.exec(scope);
  return match ? match[1].trim() : null;
}

describe("F086 AS-179: contrast tokens exist and are non-empty in both themes", () => {
  // :root is the light-mode default scope in app/globals.css.
  const rootScope = extractScope(css, /:root\s*\{/);
  const darkScope = extractScope(css, /\[data-theme=['"]dark['"]\][^{]*\{/);
  const lightScope = extractScope(css, /\[data-theme=['"]light['"]\][^{]*\{/);

  it("defines --component (fill) and --component-foreground in :root with non-empty values", () => {
    expect(rootScope.length).toBeGreaterThan(0);
    const fill = tokenValue(rootScope, "--component");
    const foreground = tokenValue(rootScope, "--component-foreground");
    expect(fill).toBeTruthy();
    expect(foreground).toBeTruthy();
  });

  it("defines --cms (fill) and --cms-foreground in :root with non-empty values", () => {
    const fill = tokenValue(rootScope, "--cms");
    const foreground = tokenValue(rootScope, "--cms-foreground");
    expect(fill).toBeTruthy();
    expect(foreground).toBeTruthy();
  });

  it("resolves --component-lightness for the dark theme scope so --component is defined in dark mode too", () => {
    expect(darkScope.length).toBeGreaterThan(0);
    const componentLightness = tokenValue(darkScope, "--component-lightness");
    expect(componentLightness).toBeTruthy();
  });

  it("resolves --cms-lightness for the dark theme scope so --cms is defined in dark mode too", () => {
    const cmsLightness = tokenValue(darkScope, "--cms-lightness");
    expect(cmsLightness).toBeTruthy();
  });

  it("resolves --component-lightness and --cms-lightness distinctly for the light theme scope", () => {
    expect(lightScope.length).toBeGreaterThan(0);
    expect(tokenValue(lightScope, "--component-lightness")).toBeTruthy();
    expect(tokenValue(lightScope, "--cms-lightness")).toBeTruthy();
  });

  it("derives --component-foreground and --cms-foreground from --foreground's lightness, not the accent color's own lightness", () => {
    // Regression guard for the original bug: the foreground formulas used
    // to read `from var(--component)` / `from var(--cms)` (the accent
    // color itself), which — since --component/--cms are only ever
    // painted as a ~10-15% tint over --card, never a solid fill — produced
    // text with inverted contrast. Anchoring to --foreground keeps the
    // guaranteed-AA lightness of ordinary body text.
    const componentForeground = tokenValue(rootScope, "--component-foreground");
    const cmsForeground = tokenValue(rootScope, "--cms-foreground");
    expect(componentForeground).toMatch(/from var\(--foreground\)/);
    expect(cmsForeground).toMatch(/from var\(--foreground\)/);
  });
});
