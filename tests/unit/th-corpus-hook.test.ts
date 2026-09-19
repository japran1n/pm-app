// @vitest-environment jsdom
//
// F054 (TH-180) — corpus reset heuristic and useCorpus memoized hook.

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { shouldResetCorpus } from "@/lib/code-editor/corpus";
import { useCorpus } from "@/lib/code-editor/use-corpus";

describe("F054 shouldResetCorpus", () => {
  it("TH-180: returns true when the hostname in the HTML changes", () => {
    const oldHtml = `<link rel="canonical" href="https://old-site.webflow.io/">`;
    const newHtml = `<link rel="canonical" href="https://new-site.webflow.io/">`;
    expect(shouldResetCorpus(oldHtml, newHtml)).toBe(true);
  });

  it("TH-180: returns false when hostname is unchanged and length is similar", () => {
    const oldHtml = `<link rel="canonical" href="https://same-site.webflow.io/"><body class="a"></body>`;
    const newHtml = `<link rel="canonical" href="https://same-site.webflow.io/"><body class="a b"></body>`;
    expect(shouldResetCorpus(oldHtml, newHtml)).toBe(false);
  });

  it("TH-180: returns true when HTML length changes by more than 20% (heuristic)", () => {
    const oldHtml = "<div>" + "a".repeat(1000) + "</div>";
    const newHtml = "<div>" + "a".repeat(1300) + "</div>";
    expect(shouldResetCorpus(oldHtml, newHtml)).toBe(true);
  });

  it("TH-180: returns false when length change is within 20%", () => {
    const oldHtml = "<div>" + "a".repeat(1000) + "</div>";
    const newHtml = "<div>" + "a".repeat(1050) + "</div>";
    expect(shouldResetCorpus(oldHtml, newHtml)).toBe(false);
  });

  it("does not throw on empty inputs", () => {
    expect(() => shouldResetCorpus("", "")).not.toThrow();
    expect(shouldResetCorpus("", "")).toBe(false);
    expect(shouldResetCorpus("", "<div>x</div>")).toBe(true);
  });
});

describe("F054 useCorpus hook", () => {
  it("TH-180: returns an empty corpus for empty html", () => {
    const { result } = renderHook(() => useCorpus(""));
    expect(result.current).toEqual({ classes: [], cssVars: [], dataAttrs: [] });
  });

  it("builds a corpus from html", () => {
    const html = `<div class="foo bar" data-test="x" style="--brand: red"></div>`;
    const { result } = renderHook(() => useCorpus(html));
    expect(result.current.classes).toEqual(["bar", "foo"]);
    expect(result.current.dataAttrs).toEqual(["test"]);
    expect(result.current.cssVars).toEqual(["--brand"]);
  });

  it("memoizes the corpus object when html does not change across rerenders", () => {
    const html = `<div class="foo"></div>`;
    const { result, rerender } = renderHook(({ h }: { h: string }) => useCorpus(h), {
      initialProps: { h: html },
    });
    const first = result.current;
    rerender({ h: html });
    expect(result.current).toBe(first);
  });

  it("rebuilds the corpus when html changes", () => {
    const { result, rerender } = renderHook(({ h }: { h: string }) => useCorpus(h), {
      initialProps: { h: `<div class="foo"></div>` },
    });
    const first = result.current;
    rerender({ h: `<div class="bar"></div>` });
    expect(result.current).not.toBe(first);
    expect(result.current.classes).toEqual(["bar"]);
  });
});
