// F035 (TH-115, TH-116, TH-117, TH-118) — buildCorpus pure regex-based
// extraction of class names, CSS custom properties, and data-* attribute
// names from an HTML document string, for Monaco autocomplete.

import { describe, expect, it } from "vitest";
import { buildCorpus } from "@/lib/code-editor/corpus";

describe("buildCorpus", () => {
  // TH-115: buildCorpus extracts class names from HTML
  it("TH-115: extracts class names from multiple elements", () => {
    const html = `
      <div class="wrapper active">
        <span class='badge primary'></span>
        <p class="wrapper">Duplicate class name here</p>
      </div>
    `;
    const corpus = buildCorpus(html);
    expect(corpus.classes).toEqual(["active", "badge", "primary", "wrapper"]);
  });

  // TH-116: buildCorpus extracts CSS custom properties
  it("TH-116: extracts CSS vars from style blocks and inline styles", () => {
    const html = `
      <style>
        :root {
          --brand-color: #ff0000;
          --spacing-md: 8px;
        }
        .a { color: var(--brand-color); }
      </style>
      <div style="--inline-var: 10px; color: var(--brand-color);"></div>
    `;
    const corpus = buildCorpus(html);
    expect(corpus.cssVars).toEqual([
      "--brand-color",
      "--inline-var",
      "--spacing-md",
    ]);
  });

  // TH-117: buildCorpus extracts data-* attribute names
  it("TH-117: extracts data-* attribute names without the data- prefix", () => {
    const html = `
      <div data-id="123" data-test-id="foo"></div>
      <button data-action="submit"></button>
    `;
    const corpus = buildCorpus(html);
    expect(corpus.dataAttrs).toEqual(["action", "id", "test-id"]);
  });

  it("TH-118 / empty: empty html returns all-empty arrays", () => {
    expect(buildCorpus("")).toEqual({
      classes: [],
      cssVars: [],
      dataAttrs: [],
    });
  });

  // TH-118: results are deduplicated and sorted
  it("TH-118: results are deduplicated and sorted", () => {
    const html = `
      <style>
        :root { --z-var: 1; --a-var: 2; --z-var: 3; }
      </style>
      <div class="zebra apple zebra" data-zeta="1" data-alpha="2" data-zeta="3"></div>
    `;
    const corpus = buildCorpus(html);
    expect(corpus.classes).toEqual(["apple", "zebra"]);
    expect(corpus.cssVars).toEqual(["--a-var", "--z-var"]);
    expect(corpus.dataAttrs).toEqual(["alpha", "zeta"]);
  });

  it("malformed HTML returns partial results without throwing", () => {
    const html = `<div class="foo" data-bar="1" <span class="unterminated`;
    expect(() => buildCorpus(html)).not.toThrow();
    const corpus = buildCorpus(html);
    expect(corpus.classes).toContain("foo");
    expect(corpus.dataAttrs).toContain("bar");
  });
});
