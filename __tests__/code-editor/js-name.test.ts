// F034 (TH-112, TH-113, TH-114) — deriveJsName() heuristic for naming
// extracted inline <script> blocks in the code editor.

import { describe, expect, it } from "vitest";
import { deriveJsName, extractScriptBlocks } from "@/lib/code-editor/extract";

describe("deriveJsName", () => {
  // TH-112: JS blocks named from first comment if present
  it("TH-112: uses first-line comment text when present", () => {
    const content = `// Initializes the carousel widget\nconst x = 1;`;
    expect(deriveJsName(content, 0)).toBe("Initializes the carousel widget");
  });

  // TH-113: JS blocks named from first declaration if no comment
  it("TH-113: uses function declaration name when no leading comment", () => {
    const content = `function setupCarousel() {\n  return true;\n}`;
    expect(deriveJsName(content, 0)).toBe("setupCarousel");
  });

  it("TH-113: uses const declaration name when no leading comment", () => {
    const content = `const carouselConfig = { speed: 3 };`;
    expect(deriveJsName(content, 0)).toBe("carouselConfig");
  });

  // TH-114: fallback name is script-N.js
  it("TH-114: falls back to script-N.js when no comment or declaration found", () => {
    const content = `console.log("hello world");`;
    expect(deriveJsName(content, 0)).toBe("script-1.js");
    expect(deriveJsName(content, 4)).toBe("script-5.js");
  });

  it("truncates long names to 60 chars with a trailing ellipsis", () => {
    const longComment = "a".repeat(80);
    const content = `// ${longComment}\nconst x = 1;`;
    const name = deriveJsName(content, 0);
    expect(name.length).toBe(61); // 60 chars + ellipsis
    expect(name.endsWith("…")).toBe(true);
  });

  it("populates name on blocks returned by extractScriptBlocks", () => {
    const html = `<script>// header nav toggle\nconst x = 1;</script><script>function initMap(){}</script><script>1+1;</script>`;
    const blocks = extractScriptBlocks(html);
    expect(blocks[0].name).toBe("header nav toggle");
    expect(blocks[1].name).toBe("initMap");
    expect(blocks[2].name).toBe("script-3.js");
  });
});
