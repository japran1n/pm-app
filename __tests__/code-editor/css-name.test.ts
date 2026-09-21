// F033 (TH-110, TH-111, TH-114) — deriveCssName() heuristic for naming
// extracted inline <style> blocks.

import { describe, expect, it } from "vitest";
import { deriveCssName, extractStyleBlocks } from "@/lib/code-editor/extract";

describe("deriveCssName", () => {
  // TH-110: named from a leading /* comment */
  it("TH-110: uses leading comment text when present", () => {
    const content = `/* Nav bar styles */\n.w-nav { display: flex; }`;
    expect(deriveCssName(content, 0)).toBe("Nav-bar-styles.css");
  });

  // TH-111: named from the first selector when no comment
  it("TH-111: uses first selector when no leading comment", () => {
    const content = `.w-nav { display: flex; }`;
    expect(deriveCssName(content, 0)).toBe("w-nav.css");
  });

  it("TH-111: uses first selector for id selectors", () => {
    const content = `#hero { color: red; }`;
    expect(deriveCssName(content, 0)).toBe("hero.css");
  });

  // TH-114: fallback name is style-N.css
  it("TH-114: falls back to style-N.css when no comment or selector found", () => {
    const content = "   ";
    expect(deriveCssName(content, 0)).toBe("style-1.css");
    expect(deriveCssName(content, 3)).toBe("style-4.css");
  });

  it("ignores comments longer than 40 chars and uses the selector instead", () => {
    const content = `/* ${"x".repeat(100)} */\n.card { color: red; }`;
    expect(deriveCssName(content, 0)).toBe("card.css");
  });

  it("truncates very long selector names to 60 chars before the extension", () => {
    const name = deriveCssName(`.${"a".repeat(80)} {}`, 0);
    expect(name).toBe(`${"a".repeat(60)}.css`);
  });

  it("moden naming: first class selector without the dot", () => {
    expect(deriveCssName(".container{max-width:1200px}", 0)).toBe("container.css");
    expect(deriveCssName(".hero_stats-list > li { gap: 1rem }", 0)).toBe("hero_stats-list.css");
  });

  it("skips element selectors and finds the first class/ID after them", () => {
    expect(deriveCssName("body { margin: 0 }\n.nav_link:hover { color: #fff }", 0)).toBe("nav_link.css");
  });

  it("element-only selectors fall back to style-N.css", () => {
    expect(deriveCssName("html, body { margin: 0; color: #333 }", 2)).toBe("style-3.css");
  });

  it("ignores separator comments made of dashes/equals", () => {
    expect(deriveCssName("/* ========== */\n.footer { color: red }", 0)).toBe("footer.css");
    expect(deriveCssName("/* ----- Hero ----- */\n.x{}", 0)).toBe("Hero.css");
  });

  it("does not treat hex colours in values as ID selectors", () => {
    expect(deriveCssName("body { color: #abcdef; }", 0)).toBe("style-1.css");
  });

  it("extractStyleBlocks() sets block.name using the heuristic", () => {
    const html = "<style>/* Hero section */\n.hero{color:red;}</style><style>.card{}</style>";
    const blocks = extractStyleBlocks(html);
    expect(blocks[0].name).toBe("Hero-section.css");
    expect(blocks[1].name).toBe("card.css");
  });
});
