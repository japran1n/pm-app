// F030 (TH-100, TH-103, TH-104, TH-105, TH-106) — extractStyleBlocks pure
// regex-based extraction of inline <style> blocks from an HTML document.

import { describe, expect, it } from "vitest";
import { extractStyleBlocks } from "@/lib/code-editor/extract";

describe("extractStyleBlocks", () => {
  // TH-100 / TH-103: multiple blocks extracted, in document order
  it("TH-100: TH-103: extracts multiple style blocks in document order", () => {
    const html = `
      <html>
        <head><style>.a { color: red; }</style></head>
        <body>
          <style>.b { color: blue; }</style>
          <div><style>.c { color: green; }</style></div>
        </body>
      </html>
    `;
    const blocks = extractStyleBlocks(html);
    expect(blocks).toHaveLength(3);
    expect(blocks.map((b) => b.content)).toEqual([
      ".a { color: red; }",
      ".b { color: blue; }",
      ".c { color: green; }",
    ]);
    expect(blocks.map((b) => b.index)).toEqual([0, 1, 2]);
    blocks.forEach((b) => expect(b.type).toBe("style"));
  });

  // TH-104: empty document returns []
  it("TH-104: returns [] for an empty html string", () => {
    expect(extractStyleBlocks("")).toEqual([]);
  });

  it("TH-104: returns [] for html with no style tags", () => {
    expect(extractStyleBlocks("<html><body><p>hi</p></body></html>")).toEqual([]);
  });

  // Style block with attributes still extracted
  it("extracts a style block that has attributes on the tag", () => {
    const html = `<style type="text/css" media="screen">.x { display: none; }</style>`;
    const blocks = extractStyleBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toBe(".x { display: none; }");
  });

  // TH-105: malformed HTML does not throw
  it("TH-105: does not throw on an unclosed style tag and returns what is available", () => {
    const html = `<style>.a { color: red; }</style><style>.b { color: blue;`;
    expect(() => extractStyleBlocks(html)).not.toThrow();
    const blocks = extractStyleBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toBe(".a { color: red; }");
  });

  it("TH-105: does not throw on non-string / null-like input", () => {
    expect(() => extractStyleBlocks(null as unknown as string)).not.toThrow();
    expect(extractStyleBlocks(null as unknown as string)).toEqual([]);
    expect(() => extractStyleBlocks(undefined as unknown as string)).not.toThrow();
  });

  // TH-106: content matches exactly what is between tags
  it("TH-106: originalContent and content match exactly what is between the tags", () => {
    const css = "\n  .foo {\n    margin: 0;\n  }\n  ";
    const html = `<style>${css}</style>`;
    const blocks = extractStyleBlocks(html);
    expect(blocks[0].originalContent).toBe(css);
    expect(blocks[0].content).toBe(css);
  });

  it("excludes a style tag with a src attribute", () => {
    const html = `<style src="external.css"></style><style>.real { color: red; }</style>`;
    const blocks = extractStyleBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toBe(".real { color: red; }");
  });
});
