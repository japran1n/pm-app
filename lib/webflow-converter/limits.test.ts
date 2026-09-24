// Pathological-input bounds for the converter engine: every case must finish
// quickly with either a clean error or a bounded payload, and never throw.

import { describe, expect, it } from "vitest";

import { convert } from "./convert";
import { expandDeclaration } from "./longhand";
import {
  CSS_TOO_DEEP_ERROR,
  HTML_TOO_DEEP_ERROR,
  HTML_TOO_MANY_ELEMENTS_ERROR,
  INPUT_TOO_LARGE_ERROR,
  MAX_CLASSES,
  MAX_ENGINE_INPUT_CHARS,
  MAX_HTML_DEPTH,
  MAX_OUTPUT_CHARS,
  OUTPUT_TOO_LARGE_ERROR,
  TOO_MANY_CLASSES_ERROR,
  stripUnterminatedMarkup,
} from "./limits";
import { isTailwindClassName, validatePayload } from "./validator";

const BUDGET_MS = 500;

function timed<T>(fn: () => T): { value: T; ms: number } {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
}

function expectBoundedConvert(html: string, css = "") {
  const { value, ms } = timed(() => convert(html, css));
  expect(ms).toBeLessThan(BUDGET_MS);
  if (value.payload) {
    expect(JSON.stringify(value.payload).length).toBeLessThanOrEqual(MAX_OUTPUT_CHARS);
  }
  return value;
}

describe("converter limits: pathological inputs", () => {
  it("validates a 100k-character class name in linear time", () => {
    const name = "a" + "a".repeat(100_000) + "!";
    const { ms } = timed(() => {
      for (let i = 0; i < 4; i++) isTailwindClassName(name);
    });
    expect(ms).toBeLessThan(50);

    const result = expectBoundedConvert(`<div class="${name}">x</div>`);
    expect(result.payload).toBeNull();
    expect(result.errors[0]).toMatch(/is not a valid Webflow class name/);
  });

  it("keeps the Tailwind class-name rule's accept/reject behaviour", () => {
    for (const ok of ["md:w-1/2", "hover:text-blue-500", "w-[32px]", "dark:hover:bg-red-500", "md:bg-[a:b]", "a:b:c[d]e"]) {
      expect(isTailwindClassName(ok)).toBe(true);
    }
    for (const bad of ["1-bad-class", "md:[x]", ":a", "md:", "a::b", "w-[32px", "bg-[url(a:b)]:x"]) {
      expect(isTailwindClassName(bad)).toBe(false);
    }
  });

  it("rejects 10k-deep nesting with a clean error instead of overflowing the stack", () => {
    const html = "<div>".repeat(10_000) + "x" + "</div>".repeat(10_000);
    const result = expectBoundedConvert(html);
    expect(result.payload).toBeNull();
    expect(result.errors).toEqual([HTML_TOO_DEEP_ERROR]);
  });

  it("rejects thousands of unclosed tags before the parser has to unwind them", () => {
    const result = expectBoundedConvert("<div>".repeat(8_000) + "x");
    expect(result.errors).toEqual([HTML_TOO_DEEP_ERROR]);
  });

  it("still converts nesting at the depth limit", () => {
    const depth = MAX_HTML_DEPTH;
    const html = "<div>".repeat(depth) + "x" + "</div>".repeat(depth);
    const result = expectBoundedConvert(html);
    expect(result.errors).toEqual([]);
    expect(result.payload).not.toBeNull();
  });

  it("rejects a large fan-out of elements", () => {
    const html = "<section>" + '<div class="a">x</div>'.repeat(20_000) + "</section>";
    const result = expectBoundedConvert(html);
    expect(result.errors).toEqual([HTML_TOO_MANY_ELEMENTS_ERROR]);
  });

  it("rejects input over the engine size cap", () => {
    const result = expectBoundedConvert("<div>" + "x".repeat(MAX_ENGINE_INPUT_CHARS) + "</div>");
    expect(result.errors).toEqual([INPUT_TOO_LARGE_ERROR]);
  });

  it("caps output when a script is repeated into many sections", () => {
    const html =
      '<section class="a"></section>'.repeat(2_000) + `<script>${"x".repeat(100_000)}</script>`;
    const result = expectBoundedConvert(html, ".a { display: inline-flex; }");
    expect(result.payload).toBeNull();
    expect(result.errors).toEqual([OUTPUT_TOO_LARGE_ERROR]);
  });

  it("caps the number of distinct classes", () => {
    const classes = Array.from({ length: MAX_CLASSES + 1 }, (_, i) => `c${i}`).join(" ");
    const result = expectBoundedConvert(`<div class="${classes}">x</div>`);
    expect(result.errors).toEqual([TOO_MANY_CLASSES_ERROR]);

    const css = Array.from({ length: MAX_CLASSES + 1 }, (_, i) => `.k${i}{color:red}`).join("\n");
    expect(expectBoundedConvert("<div>x</div>", css).errors).toEqual([TOO_MANY_CLASSES_ERROR]);
  });

  it("stays fast on many combo rules against many elements within the limits", () => {
    const css = Array.from({ length: 1_500 }, (_, i) => `.a${i}.b { display: inline-flex; }`).join("\n");
    const html = '<section><i class="b">x</i></section>'.repeat(3_000);
    const result = expectBoundedConvert(html, css);
    expect(result.errors).toEqual([]);
  });

  it("rejects deeply nested CSS at-rules with a clean error", () => {
    const css = "@supports (x: y) {".repeat(5_000) + ".a { color: red; }" + "}".repeat(5_000);
    const result = expectBoundedConvert('<div class="a">x</div>', css);
    expect(result.errors).toEqual([CSS_TOO_DEEP_ERROR]);
  });

  it("parses repeated unterminated comment openers in linear time", () => {
    const result = expectBoundedConvert("<div>x</div>" + "<!--".repeat(100_000));
    expect(result.errors).toEqual([]);
    expect(stripUnterminatedMarkup("<p>a</p><!-- open <!-- again")).toBe("<p>a</p>");
    expect(stripUnterminatedMarkup("<!-- a --><p>b</p>")).toBe("<!-- a --><p>b</p>");
  });

  it("parses repeated unterminated CDATA openers in linear time", () => {
    const result = expectBoundedConvert("<div>x</div>" + "<![CDATA[".repeat(50_000));
    expect(result.errors).toEqual([]);
  });

  it("normalizes font slashes in linear time on long whitespace runs", () => {
    const { value, ms } = timed(() => expandDeclaration("font", `a${" ".repeat(100_000)}b`));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(value).toBeDefined();
    expect(expandDeclaration("font", "12px / 1.5 Inter").decls["line-height"]).toBe("1.5");
  });

  it("detects cycles without recursion on a 10k-long chain", () => {
    const n = 10_000;
    const nodes = Array.from({ length: n }, (_, i) => ({
      _id: `n${i}`,
      type: "Block",
      tag: "div",
      classes: [],
      children: [`n${(i + 1) % n}`],
      data: {},
    }));
    const { value, ms } = timed(() => validatePayload({ nodes, styles: [] } as never));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(value.errors).toContain("Node tree contains a circular reference");
  });
});
