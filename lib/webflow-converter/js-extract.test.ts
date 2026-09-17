import { describe, expect, it } from "vitest";
import { extractScripts, extractStyles } from "./js-extract";

describe("extractScripts (AS-101, AS-102, AS-103, AS-104, AS-105, AS-134)", () => {
  it("extracts inline script content", () => {
    const html = `<div><script>console.log("hi");</script></div>`;
    const result = extractScripts(html);
    expect(result.scripts).toEqual(['console.log("hi");']);
    expect(result.warnings).toEqual([]);
  });

  it("carries the original tag markup for an external script src, alongside an advisory warning", () => {
    const html = `<script src="https://cdn.example.com/foo.js"></script>`;
    const result = extractScripts(html);
    expect(result.scripts).toEqual(['<script src="https://cdn.example.com/foo.js"></script>']);
    expect(result.warnings).toEqual([
      "external script 'https://cdn.example.com/foo.js' included in custom code — verify it loads correctly in Webflow",
    ]);
  });

  it("extracts inline scripts and carries external scripts together, each with its warning", () => {
    const html = `
      <script src="/vendor.js"></script>
      <script>var x = 1;</script>
    `;
    const result = extractScripts(html);
    expect(result.scripts).toEqual(['<script src="/vendor.js"></script>', "var x = 1;"]);
    expect(result.warnings).toEqual([
      "external script '/vendor.js' included in custom code — verify it loads correctly in Webflow",
    ]);
  });

  it("carries interleaved inline and external scripts in source order, with exactly one advisory warning", () => {
    const html = `<script>A</script><script src="x.js"></script><script>B</script>`;
    const result = extractScripts(html);
    expect(result.scripts).toHaveLength(3);
    expect(result.scripts).toEqual(["A", '<script src="x.js"></script>', "B"]);
    expect(result.warnings).toHaveLength(1);
  });

  it("has zero warnings for a plain inline-only case", () => {
    const html = `<script>A</script><script>B</script>`;
    const result = extractScripts(html);
    expect(result.scripts).toEqual(["A", "B"]);
    expect(result.warnings).toEqual([]);
  });

  it("returns an empty scripts array and no warnings when there are no scripts", () => {
    const html = `<div><p>no scripts here</p></div>`;
    const result = extractScripts(html);
    expect(result.scripts).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("returns empty result of the same shape for empty input", () => {
    const result = extractScripts("");
    expect(result).toEqual({ scripts: [], warnings: [] });
  });

  it("never throws for malformed input", () => {
    expect(() => extractScripts("<script>not closed")).not.toThrow();
  });
});

describe("extractStyles (AS-107, AS-108, AS-109, AS-110)", () => {
  it("extracts inline style block content", () => {
    const html = `<style>.foo { color: red; }</style>`;
    const result = extractStyles(html);
    expect(result.styles).toEqual([".foo { color: red; }"]);
    expect(result.warnings).toEqual([]);
  });

  it("returns an empty styles array when there are no style blocks", () => {
    const html = `<div><p>no styles here</p></div>`;
    const result = extractStyles(html);
    expect(result.styles).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("returns empty result of the same shape for empty input", () => {
    const result = extractStyles("");
    expect(result).toEqual({ styles: [], warnings: [] });
  });
});
