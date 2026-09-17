import { describe, expect, it } from "vitest";
import { extractScripts, extractStyles } from "./js-extract";

describe("extractScripts (AS-101, AS-102, AS-103, AS-104, AS-105, AS-134)", () => {
  it("extracts inline script content", () => {
    const html = `<div><script>console.log("hi");</script></div>`;
    const result = extractScripts(html);
    expect(result.scripts).toEqual(['console.log("hi");']);
    expect(result.warnings).toEqual([]);
  });

  it("warns about external script src and includes no content for it", () => {
    const html = `<script src="https://cdn.example.com/foo.js"></script>`;
    const result = extractScripts(html);
    expect(result.scripts).toEqual([]);
    expect(result.warnings).toEqual([
      "external script 'https://cdn.example.com/foo.js' not included — add manually in Webflow custom code",
    ]);
  });

  it("extracts inline scripts and warns about external scripts together", () => {
    const html = `
      <script src="/vendor.js"></script>
      <script>var x = 1;</script>
    `;
    const result = extractScripts(html);
    expect(result.scripts).toEqual(["var x = 1;"]);
    expect(result.warnings).toEqual([
      "external script '/vendor.js' not included — add manually in Webflow custom code",
    ]);
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
