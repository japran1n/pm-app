// F033 (TH-110, TH-111, TH-114) — deriveCssName() heuristic for naming
// extracted inline <style> blocks.

import { describe, expect, it } from "vitest";
import { deriveCssName, extractStyleBlocks } from "@/lib/code-editor/extract";

describe("deriveCssName", () => {
  // TH-110: named from a leading /* comment */
  it("TH-110: uses leading comment text when present", () => {
    const content = `/* Nav bar styles */\n.w-nav { display: flex; }`;
    expect(deriveCssName(content, 0)).toBe("Nav bar styles");
  });

  // TH-111: named from the first selector when no comment
  it("TH-111: uses first selector when no leading comment", () => {
    const content = `.w-nav { display: flex; }`;
    expect(deriveCssName(content, 0)).toBe(".w-nav");
  });

  it("TH-111: uses first selector for id selectors", () => {
    const content = `#hero { color: red; }`;
    expect(deriveCssName(content, 0)).toBe("#hero");
  });

  // TH-114: fallback name is style-N.css
  it("TH-114: falls back to style-N.css when no comment or selector found", () => {
    const content = "   ";
    expect(deriveCssName(content, 0)).toBe("style-1.css");
    expect(deriveCssName(content, 3)).toBe("style-4.css");
  });

  it("truncates long names to 60 chars with a trailing ellipsis", () => {
    const longComment = "x".repeat(100);
    const content = `/* ${longComment} */`;
    const name = deriveCssName(content, 0);
    expect(name.length).toBe(61); // 60 chars + ellipsis
    expect(name.endsWith("…")).toBe(true);
  });

  it("extractStyleBlocks() sets block.name using the heuristic", () => {
    const html = "<style>/* Hero section */\n.hero{color:red;}</style><style>.card{}</style>";
    const blocks = extractStyleBlocks(html);
    expect(blocks[0].name).toBe("Hero section");
    expect(blocks[1].name).toBe(".card");
  });
});
