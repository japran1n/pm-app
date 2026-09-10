import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// F001 (missions/20260910-182104): --component-* and --cms-* tokens must
// be derived from the existing OKLCH knobs, never a hand-written hex, and
// must resolve in both the light and dark themes.
const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf-8");

function block(selectorRegex: RegExp): string {
  const match = css.match(selectorRegex);
  if (!match) return "";
  const start = match.index! + match[0].length;
  let depth = 1;
  let i = start;
  while (depth > 0 && i < css.length) {
    if (css[i] === "{") depth++;
    if (css[i] === "}") depth--;
    i++;
  }
  return css.slice(start, i);
}

const rootBlocks = [...css.matchAll(/:root\s*\{/g)].map((m) => {
  let depth = 1;
  let i = m.index! + m[0].length;
  while (depth > 0 && i < css.length) {
    if (css[i] === "{") depth++;
    if (css[i] === "}") depth--;
    i++;
  }
  return css.slice(m.index! + m[0].length, i);
});
const rootCss = rootBlocks.join("\n");
const lightCss = block(/\[data-theme=['"]light['"]\]\s*,\s*\.light\s*\{/);
const darkCss = block(/\[data-theme=['"]dark['"]\]\s*,\s*\.dark\s*\{/);

describe("F001 derived colour tokens", () => {
  it("AS-075/AS-076: --component-* is fully defined (fill, border, border-hover, foreground)", () => {
    expect(rootCss).toMatch(/--component:\s*oklch\(/);
    expect(rootCss).toMatch(/--component-border:\s*oklch\(/);
    expect(rootCss).toMatch(/--component-border-hover:\s*oklch\(/);
    expect(rootCss).toMatch(/--component-foreground:\s*oklch\(/);
  });

  it("AS-077/AS-078: --cms-* is fully defined (fill, border, border-hover, foreground)", () => {
    expect(rootCss).toMatch(/--cms:\s*oklch\(/);
    expect(rootCss).toMatch(/--cms-border:\s*oklch\(/);
    expect(rootCss).toMatch(/--cms-border-hover:\s*oklch\(/);
    expect(rootCss).toMatch(/--cms-foreground:\s*oklch\(/);
  });

  it("AS-079: the lightness knobs each token depends on resolve in both the light and dark theme blocks, not only one", () => {
    expect(lightCss).toMatch(/--component-lightness:/);
    expect(darkCss).toMatch(/--component-lightness:/);
    expect(lightCss).toMatch(/--cms-lightness:/);
    expect(darkCss).toMatch(/--cms-lightness:/);
  });

  it("AS-080: no hand-written hex literal is used for any --component-*/--cms-* token", () => {
    const tokenLines = css
      .split("\n")
      .filter((line) => /--(component|cms)(-[a-z-]+)?:/.test(line));
    expect(tokenLines.length).toBeGreaterThan(0);
    for (const line of tokenLines) {
      expect(line).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    }
  });

  it("derives hue from the existing --hue/--primary-hue knob rather than a fixed absolute colour", () => {
    expect(rootCss).toMatch(/--component-hue:\s*clamp\(\s*130,\s*calc\(142 \+ \(var\(--primary-hue\)/);
    expect(rootCss).toMatch(/--cms-hue:\s*clamp\(\s*270,\s*calc\(285 \+ \(var\(--primary-hue\)/);
  });
});
