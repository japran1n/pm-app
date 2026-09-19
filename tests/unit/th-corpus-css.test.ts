import { describe, expect, it } from "vitest";
import {
  buildCorpus,
  buildCorpusFromCss,
  mergeCorpora,
} from "@/lib/code-editor/corpus";

describe("F104 external CSS corpus tests", () => {
  it("TH-250: buildCorpusFromCss extracts simple class selectors", () => {
    const css = `.foo { color: red; } .bar { color: blue; }`;
    const corpus = buildCorpusFromCss(css);
    expect(corpus.classes).toEqual(["bar", "foo"]);
  });

  it("TH-251: buildCorpusFromCss extracts compound class selectors (multiple classes per rule)", () => {
    const css = `.foo.bar { color: red; }`;
    const corpus = buildCorpusFromCss(css);
    expect(corpus.classes).toEqual(["bar", "foo"]);
  });

  it("TH-252: buildCorpusFromCss extracts classes from pseudo-class selectors", () => {
    const css = `.foo:hover { color: red; } .baz::before { content: ''; }`;
    const corpus = buildCorpusFromCss(css);
    expect(corpus.classes).toEqual(["baz", "foo"]);
  });

  it("TH-253: buildCorpusFromCss extracts custom property declarations", () => {
    const css = `:root { --brand-color: #ff0000; --spacing-lg: 24px; }`;
    const corpus = buildCorpusFromCss(css);
    expect(corpus.cssVars).toEqual(["--brand-color", "--spacing-lg"]);
  });

  it("TH-254: buildCorpusFromCss extracts custom property references (var(--x))", () => {
    const css = `.foo { color: var(--brand-color); }`;
    const corpus = buildCorpusFromCss(css);
    expect(corpus.cssVars).toEqual(["--brand-color"]);
    expect(corpus.classes).toEqual(["foo"]);
  });

  it("TH-255: buildCorpusFromCss deduplicates repeated selectors/vars", () => {
    const css = `.foo {} .foo {} :root { --x: 1; --x: 2; }`;
    const corpus = buildCorpusFromCss(css);
    expect(corpus.classes).toEqual(["foo"]);
    expect(corpus.cssVars).toEqual(["--x"]);
  });

  it("TH-256: buildCorpusFromCss returns empty arrays for empty/falsy input", () => {
    expect(buildCorpusFromCss("")).toEqual({
      classes: [],
      cssVars: [],
      dataAttrs: [],
    });
  });

  it("TH-257: buildCorpusFromCss never throws on malformed CSS", () => {
    const css = `.foo { color: red; ` /* unclosed rule */;
    expect(() => buildCorpusFromCss(css)).not.toThrow();
  });

  it("TH-258: mergeCorpora unions classes/cssVars/dataAttrs across multiple corpora", () => {
    const a = { classes: ["a"], cssVars: ["--x"], dataAttrs: ["foo"] };
    const b = { classes: ["b"], cssVars: ["--y"], dataAttrs: ["bar"] };
    const merged = mergeCorpora(a, b);
    expect(merged.classes).toEqual(["a", "b"]);
    expect(merged.cssVars).toEqual(["--x", "--y"]);
    expect(merged.dataAttrs).toEqual(["bar", "foo"]);
  });

  it("TH-259: mergeCorpora deduplicates overlapping entries and sorts results", () => {
    const a = { classes: ["z", "a"], cssVars: ["--x"], dataAttrs: [] };
    const b = { classes: ["a", "m"], cssVars: ["--x", "--y"], dataAttrs: [] };
    const merged = mergeCorpora(a, b);
    expect(merged.classes).toEqual(["a", "m", "z"]);
    expect(merged.cssVars).toEqual(["--x", "--y"]);
  });

  it("TH-260: mergeCorpora combines an HTML-derived corpus with a CSS-derived corpus (integration)", () => {
    const html = `<div class="html-only" data-testid="x" style="--v: 1"></div>`;
    const css = `.css-only { color: var(--v); }`;
    const htmlCorpus = buildCorpus(html);
    const cssCorpus = buildCorpusFromCss(css);
    const merged = mergeCorpora(htmlCorpus, cssCorpus);
    expect(merged.classes).toEqual(
      expect.arrayContaining(["html-only", "css-only"])
    );
    expect(merged.cssVars).toEqual(expect.arrayContaining(["--v"]));
    expect(merged.dataAttrs).toEqual(expect.arrayContaining(["testid"]));
  });
});
