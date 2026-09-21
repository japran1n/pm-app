import { describe, expect, it } from "vitest";
import {
  extractStyleBlocks,
  extractScriptBlocks,
  deriveCssName,
  deriveJsName,
  deduplicateBlocks,
} from "@/lib/code-editor/extract";

describe("F037 extraction tests", () => {
  it("TH-119: extractStyleBlocks returns correct count", () => {
    const html = `
      <html><head>
      <style>.a { color: red; }</style>
      <style>.b { color: blue; }</style>
      </head><body></body></html>
    `;
    const blocks = extractStyleBlocks(html);
    expect(blocks).toHaveLength(2);
  });

  it("TH-120: extractStyleBlocks content matches source", () => {
    const html = `<style>.foo { color: red; }</style>`;
    const blocks = extractStyleBlocks(html);
    expect(blocks[0].content).toBe(".foo { color: red; }");
    expect(blocks[0].originalContent).toBe(".foo { color: red; }");
  });

  it("TH-121: extractScriptBlocks returns correct count", () => {
    const html = `
      <script>const a = 1;</script>
      <script src="https://example.com/x.js"></script>
      <script>const b = 2;</script>
    `;
    const blocks = extractScriptBlocks(html);
    // external <script src> is excluded, so only 2 inline blocks
    expect(blocks).toHaveLength(2);
  });

  it("TH-122: extractScriptBlocks content matches source", () => {
    const html = `<script>function hello() { return 1; }</script>`;
    const blocks = extractScriptBlocks(html);
    expect(blocks[0].content).toBe("function hello() { return 1; }");
    expect(blocks[0].originalContent).toBe("function hello() { return 1; }");
  });

  it("TH-123: style block name uses leading comment when present", () => {
    const name = deriveCssName("/* Main styles */\n.foo { color: red; }", 0);
    expect(name).toBe("Main-styles.css");
  });

  it("TH-124: style block name falls back to first selector when no comment", () => {
    const name = deriveCssName(".foo { color: red; }", 0);
    expect(name).toBe("foo.css");
  });

  it("TH-125: style block name falls back to style-N.css when no comment or selector", () => {
    const name = deriveCssName("", 2);
    expect(name).toBe("style-3.css");
  });

  it("TH-126: script block name uses leading // comment when present", () => {
    const name = deriveJsName("// init handler\nconst x = 1;", 0);
    expect(name).toBe("init-handler.js");
  });

  it("TH-127: script block name falls back to declaration name when no comment", () => {
    const name = deriveJsName("function initHandler() {}", 0);
    expect(name).toBe("initHandler.js");
  });

  it("TH-128: script block name falls back to script-N.js when no comment or declaration", () => {
    const name = deriveJsName("1 + 1;", 4);
    expect(name).toBe("script-5.js");
  });

  it("TH-129: deduplicateBlocks removes blocks with identical trimmed content, keeping first occurrence and original indexes", () => {
    const blocks = [
      { index: 0, originalContent: "  .a { color: red; }  " },
      { index: 1, originalContent: ".b { color: blue; }" },
      { index: 2, originalContent: ".a { color: red; }" },
    ];
    const result = deduplicateBlocks(blocks);
    expect(result).toHaveLength(2);
    expect(result.map((b) => b.index)).toEqual([0, 1]);
  });

  it("extraction never throws on malformed HTML (edge case)", () => {
    const html = "<style>.unclosed { color: red; ";
    expect(() => extractStyleBlocks(html)).not.toThrow();
    expect(extractStyleBlocks(html)).toEqual([]);
  });

  it("extraction returns empty arrays for empty/falsy input (edge case)", () => {
    expect(extractStyleBlocks("")).toEqual([]);
    expect(extractScriptBlocks("")).toEqual([]);
    // @ts-expect-error deliberate non-string input to exercise guard
    expect(extractStyleBlocks(null)).toEqual([]);
  });

  it("extractScriptBlocks excludes nonce-bearing script tags (edge case)", () => {
    const html = `<script nonce="abc123">const injected = true;</script><script>const real = true;</script>`;
    const blocks = extractScriptBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toBe("const real = true;");
  });

  it("extractStyleBlocks/extractScriptBlocks preserve document order across mixed style/script tags", () => {
    const html = `
      <style>.first { color: red; }</style>
      <script>const first = 1;</script>
      <style>.second { color: blue; }</style>
      <script>const second = 2;</script>
    `;
    const styles = extractStyleBlocks(html);
    const scripts = extractScriptBlocks(html);
    expect(styles.map((b) => b.index)).toEqual([0, 1]);
    expect(scripts.map((b) => b.index)).toEqual([0, 1]);
    expect(styles[0].content).toContain(".first");
    expect(styles[1].content).toContain(".second");
    expect(scripts[0].content).toContain("first");
    expect(scripts[1].content).toContain("second");
  });
});
