import { describe, expect, it } from "vitest";
import { parseSelector, STATE_ALIASES } from "./css";

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
