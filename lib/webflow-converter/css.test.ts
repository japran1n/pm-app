import { describe, expect, it } from "vitest";
import { parseCss, parseSelector, STATE_ALIASES } from "./css";

// F012: CSS selector parser — port of the prototype's parseSelector().
// Tests adapted from the reference implementation's existing passing tests
// (~/Desktop/html-to-webflow), covering AS-039 through AS-045.

describe("F012 parseSelector", () => {
  it("AS-039: parses a plain class selector into a single-element chain", () => {
    const result = parseSelector(".card");
    expect(result).toEqual({ chain: ["card"], state: null });
  });

  it("AS-040: parses a chained class selector as a combo class chain", () => {
    const result = parseSelector(".card.is-featured");
    expect(result).toEqual({ chain: ["card", "is-featured"], state: null });
  });

  it("AS-041: parses a class selector with a supported pseudo-state (:hover)", () => {
    const result = parseSelector(".button:hover");
    expect(result).toEqual({ chain: ["button"], state: "hover" });
  });

  it("AS-041: maps :active to the 'pressed' Webflow state", () => {
    const result = parseSelector(".button:active");
    expect(result).toEqual({ chain: ["button"], state: "pressed" });
  });

  it("AS-041: parses each supported pseudo-state to its Webflow variant name", () => {
    expect(parseSelector(".x:focus")?.state).toBe("focus");
    expect(parseSelector(".x:focus-visible")?.state).toBe("focus-visible");
    expect(parseSelector(".x:visited")?.state).toBe("visited");
    expect(parseSelector(".x::placeholder")?.state).toBe("placeholder");
    expect(parseSelector(".x::before")?.state).toBe("before");
    expect(parseSelector(".x::after")?.state).toBe("after");
  });

  it("AS-041: combo class chain with a trailing pseudo-state", () => {
    const result = parseSelector(".button.is-big:hover");
    expect(result).toEqual({ chain: ["button", "is-big"], state: "hover" });
  });

  it("rejects an unsupported pseudo-state", () => {
    expect(parseSelector(".button:nth-child(2)")).toBeNull();
  });

  it("AS-042: rejects a descendant selector", () => {
    expect(parseSelector(".card h3")).toBeNull();
  });

  it("AS-043: rejects an ID selector", () => {
    expect(parseSelector("#hero")).toBeNull();
  });

  it("AS-044: rejects a combinator selector", () => {
    expect(parseSelector("a.btn > span")).toBeNull();
  });

  it("AS-045: rejects an attribute selector", () => {
    expect(parseSelector("[data-x]")).toBeNull();
  });

  it("rejects a bare element/tag selector", () => {
    expect(parseSelector("div")).toBeNull();
  });

  it("rejects an empty string", () => {
    expect(parseSelector("")).toBeNull();
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(parseSelector("  .card  ")).toEqual({ chain: ["card"], state: null });
  });

  it("exposes the STATE_ALIASES map ported from the prototype", () => {
    expect(STATE_ALIASES).toEqual({
      hover: "hover",
      active: "pressed",
      focus: "focus",
      "focus-visible": "focus-visible",
      visited: "visited",
      placeholder: "placeholder",
      before: "before",
      after: "after",
    });
  });
});

// F014: parseCss() orchestration — walks postcss AST, dispatches
// selector/breakpoint/shorthand logic, builds the class map.
// Covers AS-046, AS-049, AS-050, AS-051, AS-052, AS-075, AS-076.

describe("F014 parseCss", () => {
  it("empty input produces an empty result of the populated shape", () => {
    const result = parseCss("");
    expect(result.classes).toBeInstanceOf(Map);
    expect(result.classes.size).toBe(0);
    expect(result.order).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("a simple class rule produces a styleLess-equivalent base declaration set", () => {
    const result = parseCss(".card { color: red; }");
    const card = result.classes.get("card");
    expect(card).toBeDefined();
    expect(card!.base).toEqual({ color: "red" });
    expect(card!.variants).toEqual({});
    expect(card!.comboOf).toBeNull();
    expect(result.order).toEqual(["card"]);
  });

  it("shorthand expansion flows through parseCss into longhand declarations", () => {
    const result = parseCss(".box { margin: 1px 2px 3px 4px; }");
    const box = result.classes.get("box")!;
    expect(box.base).toEqual({
      "margin-top": "1px",
      "margin-right": "2px",
      "margin-bottom": "3px",
      "margin-left": "4px",
    });
    expect(result.warnings).toEqual([]);
  });

  it("AS-051: an @media rule maps to the correct Webflow breakpoint variant key", () => {
    const result = parseCss("@media (max-width: 767px) { .card { color: blue; } }");
    const card = result.classes.get("card")!;
    expect(card.base).toEqual({});
    expect(card.variants.small).toEqual({ color: "blue" });
  });

  it("AS-051: an @media rule combined with a pseudo-state maps to a combined variant key", () => {
    const result = parseCss("@media (max-width: 991px) { .card:hover { color: green; } }");
    const card = result.classes.get("card")!;
    expect(card.variants.medium_hover).toEqual({ color: "green" });
  });

  it("a bare pseudo-state (no @media) maps to a main_<state> variant key", () => {
    const result = parseCss(".button:hover { color: purple; }");
    const button = result.classes.get("button")!;
    expect(button.base).toEqual({});
    expect(button.variants.main_hover).toEqual({ color: "purple" });
  });

  it("test_AS_057_nested_rule_warns_and_does_not_clobber_parent_decls", () => {
    const result = parseCss(".a { color: red; &:hover { color: blue } }");
    const a = result.classes.get("a")!;
    expect(a.base).toEqual({ color: "red" });
    expect(result.warnings.some((w) => /nested CSS/i.test(w))).toBe(true);
  });

  it("test_AS_057_nested_atrule_warns_instead_of_silent_loss", () => {
    const result = parseCss(".a{color:red; @media (max-width:767px){color:blue}}");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("test_AS_057_unknown_top_level_atrule_container_warns", () => {
    const result = parseCss("@container (max-width:500px){ .a{color:red} }");
    expect(result.warnings.some((w) => w.includes("@container is not supported"))).toBe(true);
  });

  it("test_AS_057_unknown_top_level_atrule_page_warns", () => {
    const result = parseCss("@page{margin:1cm}");
    expect(result.warnings.some((w) => w.includes("@page is not supported"))).toBe(true);
  });

  it("test_AS_057_unknown_top_level_atrule_import_warns", () => {
    const result = parseCss("@import url(x.css);");
    expect(result.warnings.some((w) => w.includes("@import is not supported"))).toBe(true);
  });

  it("AS-052: a combo class (.a.b) registers a combo entry with comboOf ['a']", () => {
    const result = parseCss(".card.is-featured { color: gold; }");
    const card = result.classes.get("card")!;
    const combo = result.classes.get("card|is-featured")!;
    expect(card.comboOf).toBeNull();
    expect(combo.name).toBe("is-featured");
    expect(combo.comboOf).toEqual(["card"]);
    expect(combo.base).toEqual({ color: "gold" });
    expect(result.order).toEqual(["card", "is-featured", "card|is-featured"]);
  });

  it("AS-039: a standalone class and its later combo use produce two separate entries, standalone is not destroyed", () => {
    const result = parseCss(".b { color: red; } .a.b { color: blue; }");
    const standalone = result.classes.get("b")!;
    const combo = result.classes.get("a|b")!;
    expect(standalone.base).toEqual({ color: "red" });
    expect(standalone.comboOf).toBeNull();
    expect(combo.base).toEqual({ color: "blue" });
    expect(combo.comboOf).toEqual(["a"]);
    expect(result.classes.size).toBe(3); // "a", "b" (standalone), "a|b" (combo)
  });

  it("AS-039: combo-then-standalone is order-independent, still produces two entries", () => {
    const result = parseCss(".a.b { color: blue; } .b { color: red; }");
    const standalone = result.classes.get("b")!;
    const combo = result.classes.get("a|b")!;
    expect(standalone.base).toEqual({ color: "red" });
    expect(standalone.comboOf).toBeNull();
    expect(combo.base).toEqual({ color: "blue" });
    expect(combo.comboOf).toEqual(["a"]);
    expect(result.classes.size).toBe(3);
  });

  it("AS-040: a three-deep combo chain (.a.b.c) preserves all ancestors in comboOf", () => {
    const result = parseCss(".a.b.c { color: green; }");
    const combo = result.classes.get("a|b|c")!;
    expect(combo.name).toBe("c");
    expect(combo.comboOf).toEqual(["a", "b"]);
    expect(combo.base).toEqual({ color: "green" });
    // Each individual chain member is also registered standalone.
    expect(result.classes.has("a")).toBe(true);
    expect(result.classes.has("b")).toBe(true);
    expect(result.classes.has("c")).toBe(true);
  });

  it("AS-040: the same terminal class under two different bases are distinct combo entries", () => {
    const result = parseCss(".x.z { color: red; } .y.z { color: blue; }");
    const xz = result.classes.get("x|z")!;
    const yz = result.classes.get("y|z")!;
    expect(xz).not.toBe(yz);
    expect(xz.comboOf).toEqual(["x"]);
    expect(xz.base).toEqual({ color: "red" });
    expect(yz.comboOf).toEqual(["y"]);
    expect(yz.base).toEqual({ color: "blue" });
    // The standalone "z" (never declared on its own) is still registered but empty.
    expect(result.classes.get("z")!.base).toEqual({});
  });

  it("non-class selectors (descendant, id, element, attribute) produce warnings and are skipped", () => {
    const result = parseCss(`
      .card h3 { color: red; }
      #hero { color: red; }
      div { color: red; }
      [data-x] { color: red; }
    `);
    expect(result.classes.size).toBe(0);
    expect(result.warnings).toHaveLength(4);
    expect(result.warnings[0]).toMatch(/not a plain class selector/);
    expect(result.warnings.every((w) => w.includes("skipped"))).toBe(true);
  });

  it("AS-042: a descendant selector (.card h3) produces a warning and is not converted into any style", () => {
    const result = parseCss(".card h3 { color: red; }");
    expect(result.classes.size).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/not a plain class selector/);
    expect(result.warnings[0]).toContain("skipped");
  });

  it("AS-043: an ID selector (#hero) produces a warning and is not converted into any style", () => {
    const result = parseCss("#hero { color: red; }");
    expect(result.classes.size).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/not a plain class selector/);
    expect(result.warnings[0]).toContain("skipped");
  });

  it("AS-044: a combinator selector (a.btn > span) produces a warning and is not converted into any style", () => {
    const result = parseCss("a.btn > span { color: red; }");
    expect(result.classes.size).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/not a plain class selector/);
    expect(result.warnings[0]).toContain("skipped");
  });

  it("AS-045: an attribute selector ([data-x]) produces a warning and is not converted into any style", () => {
    const result = parseCss("[data-x] { color: red; }");
    expect(result.classes.size).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/not a plain class selector/);
    expect(result.warnings[0]).toContain("skipped");
  });

  it("AS-046: !important is stripped from the value, the declaration still applies, and a warning is added", () => {
    const result = parseCss(".card { color: red !important; }");
    const card = result.classes.get("card")!;
    expect(card.base).toEqual({ color: "red" });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/!important.*color.*dropped/);
  });

  it("warnings from shorthand expansion aggregate into the overall warnings list", () => {
    const result = parseCss(`
      .a { margin: inherit; }
      .b { border-radius: 4px / 8px; }
    `);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toMatch(/dropped "margin: inherit"/);
    expect(result.warnings[1]).toMatch(/elliptical radii flattened/);
  });

  it("AS-075: background-image is passed through untouched, no special-casing", () => {
    const result = parseCss(`.hero { background-image: url("/img/hero.jpg"); }`);
    const hero = result.classes.get("hero")!;
    expect(hero.base["background-image"]).toBe('url("/img/hero.jpg")');
  });

  it("AS-076: other background-* longhand properties on the same class are unaffected by the presence of background-image", () => {
    const result = parseCss(`
      .hero {
        background-image: url("/img/hero.jpg");
        background-color: red;
        background-position: center;
        background-size: cover;
      }
    `);
    const hero = result.classes.get("hero")!;
    expect(hero.base["background-image"]).toBe('url("/img/hero.jpg")');
    expect(hero.base["background-color"]).toBe("red");
    expect(hero.base["background-position"]).toBe("center");
    expect(hero.base["background-size"]).toBe("cover");
  });

  it("AS-048: an unmappable @media query (e.g. print) is reported as a warning and skipped", () => {
    const result = parseCss("@media print { .card { color: red; } }");
    expect(result.classes.size).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/does not map to a Webflow breakpoint/);
  });

  it("AS-048: @media (max-width: 1200px) is not a Webflow breakpoint — warns and its rules are skipped, no silent snap to 'medium'", () => {
    const result = parseCss("@media (max-width: 1200px) { .card { color: red; } }");
    expect(result.classes.size).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/does not map to a Webflow breakpoint/);
    expect(Array.from(result.classes.keys())).toHaveLength(0);
  });

  it("AS-049: a @keyframes block produces a warning recommending it be moved to page custom code, and is not converted into any style", () => {
    const result = parseCss(`@keyframes spin { from { transform: rotate(0deg); } }`);
    expect(result.classes.size).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/@keyframes "spin" cannot be pasted/);
    expect(result.warnings[0]).toMatch(/page custom code/);
  });

  it("AS-050: a @font-face block produces a warning recommending the font be uploaded via Webflow site settings, and is not converted into any style", () => {
    const result = parseCss(`@font-face { font-family: "Foo"; src: url("/foo.woff2"); }`);
    expect(result.classes.size).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/@font-face cannot be pasted/);
    expect(result.warnings[0]).toMatch(/Webflow site settings/);
  });

  it("@keyframes and @font-face at-rules together each produce their own warning instead of being parsed as classes", () => {
    const result = parseCss(`
      @keyframes spin { from { transform: rotate(0deg); } }
      @font-face { font-family: "Foo"; src: url("/foo.woff2"); }
    `);
    expect(result.classes.size).toBe(0);
    expect(result.warnings).toEqual([
      expect.stringMatching(/@keyframes "spin" cannot be pasted/),
      expect.stringMatching(/@font-face cannot be pasted/),
    ]);
  });

  it("@supports wraps its contents transparently, preserving the outer breakpoint", () => {
    const result = parseCss(`
      @supports (display: grid) {
        @media (max-width: 479px) {
          .grid { display: grid; }
        }
      }
    `);
    const grid = result.classes.get("grid")!;
    expect(grid.variants.tiny).toEqual({ display: "grid" });
  });

  it("multiple selectors sharing a rule are each parsed independently", () => {
    const result = parseCss(".a, .b { color: red; }");
    expect(result.classes.get("a")!.base).toEqual({ color: "red" });
    expect(result.classes.get("b")!.base).toEqual({ color: "red" });
  });
});

// F058: per-declaration error containment (AS-057, AS-029) — a malformed
// declaration or an unparseable stylesheet must never throw out of parseCss.
describe("F058 per-declaration error containment", () => {
  it("AS-057: an empty border-radius value does not throw and reports a warning", () => {
    expect(() => parseCss(".a{border-radius: ;}")).not.toThrow();
    const result = parseCss(".a{border-radius: ;}");
    expect(result.warnings.some((w) => w.includes("border-radius"))).toBe(true);
  });

  it("AS-057: a leading-slash border-radius value does not throw and reports a warning", () => {
    expect(() => parseCss(".a{border-radius: / 4px}")).not.toThrow();
    const result = parseCss(".a{border-radius: / 4px}");
    expect(result.warnings.some((w) => w.includes("border-radius"))).toBe(true);
  });

  it("AS-029: unparseable CSS returns an empty result with a warning instead of throwing", () => {
    expect(() => parseCss("not valid css {{{{")).not.toThrow();
    const result = parseCss("not valid css {{{{");
    expect(result.classes.size).toBe(0);
    expect(result.order).toEqual([]);
    expect(result.warnings.some((w) => /CSS parse error/.test(w))).toBe(true);
  });
});
