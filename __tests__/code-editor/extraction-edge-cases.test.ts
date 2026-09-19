// F036 (TH-119) — extraction edge cases: empty/malformed documents, CDATA
// wrappers, string literals containing closing tags, and minified content.

import { describe, expect, it } from "vitest";
import { extractStyleBlocks, extractScriptBlocks } from "@/lib/code-editor/extract";

describe("extraction edge cases", () => {
  // TH-119: empty document returns empty lists, never throws
  it("TH-119: empty string returns empty style and script lists", () => {
    expect(extractStyleBlocks("")).toEqual([]);
    expect(extractScriptBlocks("")).toEqual([]);
  });

  it("TH-119: fragment with no <head> returns empty lists rather than throwing", () => {
    const html = "<div>just a fragment</div>";
    expect(() => extractStyleBlocks(html)).not.toThrow();
    expect(() => extractScriptBlocks(html)).not.toThrow();
    expect(extractStyleBlocks(html)).toEqual([]);
    expect(extractScriptBlocks(html)).toEqual([]);
  });

  it("TH-119: document with only external assets returns empty lists", () => {
    const html =
      '<html><head><link rel="stylesheet" href="/a.css"></head>' +
      '<body><script src="/a.js"></script></body></html>';
    expect(extractStyleBlocks(html)).toEqual([]);
    expect(extractScriptBlocks(html)).toEqual([]);
  });

  it("TH-119: non-string input never throws and returns empty arrays", () => {
    // @ts-expect-error deliberately passing bad input
    expect(extractStyleBlocks(null)).toEqual([]);
    // @ts-expect-error deliberately passing bad input
    expect(extractScriptBlocks(undefined)).toEqual([]);
  });

  // CDATA wrapper handling
  it("strips a CDATA wrapper from style content", () => {
    const html = "<style><![CDATA[\n.a{color:red;}\n]]></style>";
    const blocks = extractStyleBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toContain(".a{color:red;}");
    expect(blocks[0].content).not.toContain("CDATA");
  });

  it("strips a CDATA wrapper (with JS comment markers) from script content", () => {
    const html = "<script>//<![CDATA[\nconsole.log('x');\n//]]></script>";
    const blocks = extractScriptBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toContain("console.log('x');");
    expect(blocks[0].content).not.toContain("CDATA");
  });

  // Minified content
  it("extracts minified CSS correctly", () => {
    const minified = ".a{color:red}.b{color:blue}.c{display:flex}";
    const html = `<style>${minified}</style>`;
    const blocks = extractStyleBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toBe(minified);
  });

  it("extracts minified JS correctly", () => {
    const minified = 'var a=1,b=2;function f(){return a+b}console.log(f());';
    const html = `<script>${minified}</script>`;
    const blocks = extractScriptBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toBe(minified);
  });

  // Known limitation: a string literal containing "</script>" or "</style>"
  // will split the regex match early. This cannot be solved without a real
  // HTML/JS parser (see handoff notes). We assert the *documented* behaviour
  // here so a future change to add a parser has a regression test to update.
  it("documents the known limitation: a string literal containing </script> splits the match", () => {
    const html = "<script>var s = \"</script>\";</script>";
    const blocks = extractScriptBlocks(html);
    // The regex closes at the first literal `</script>`, so content is only
    // the text up to (not including) that literal — not the full source.
    expect(blocks[0]?.content).toBe('var s = "');
  });

  it("does not throw on unclosed style/script tags", () => {
    const html = "<style>.a{color:red;}";
    expect(() => extractStyleBlocks(html)).not.toThrow();
    expect(extractStyleBlocks(html)).toEqual([]);
  });
});
