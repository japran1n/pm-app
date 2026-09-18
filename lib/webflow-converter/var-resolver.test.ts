import { describe, expect, it } from "vitest";
import { resolveVarFallback, parseCss } from "./css";

// M7: resolveVarFallback() strips CSS custom property references down to
// their fallback value so styleLess never receives a `var(...)` expression
// — Webflow's clipboard style engine crashes on those with "Invalid style
// type: undefined at buildStyleBlock".

describe("M7 resolveVarFallback", () => {
  it("resolves var(--color, #fff) to its fallback", () => {
    expect(resolveVarFallback("var(--color, #fff)")).toBe("#fff");
  });

  it("resolves var(--size, 1rem) to its fallback", () => {
    expect(resolveVarFallback("var(--size, 1rem)")).toBe("1rem");
  });

  it("resolves nested var(--a, var(--b, blue)) recursively to the innermost fallback", () => {
    expect(resolveVarFallback("var(--a, var(--b, blue))")).toBe("blue");
  });

  it("returns null for var(--x) with no fallback", () => {
    expect(resolveVarFallback("var(--x)")).toBeNull();
  });

  it("returns a value with no var() unchanged", () => {
    expect(resolveVarFallback("0.875rem")).toBe("0.875rem");
  });

  it("resolves multiple var() tokens in one value independently", () => {
    expect(resolveVarFallback("var(--x, #fff) var(--y, 2px)")).toBe("#fff 2px");
  });

  it("returns null when one of multiple var() tokens has no fallback", () => {
    expect(resolveVarFallback("var(--x, #fff) var(--y)")).toBeNull();
  });
});

describe("M7 parseCss integration", () => {
  it("puts the fallback-resolved value into styleLess (base) for a var() with a fallback", () => {
    const { classes } = parseCss(`.card { color: var(--text-color, #111111); }`);
    const rec = classes.get("card")!;
    expect(rec.base.color).toBe("#111111");
    expect(rec.unsupported.color).toBeUndefined();
  });

  it("routes a var() with no fallback to `unsupported`, preserving the original value", () => {
    const { classes } = parseCss(`.card { color: var(--text-color); }`);
    const rec = classes.get("card")!;
    expect(rec.base.color).toBeUndefined();
    expect(rec.unsupported.color).toBe("var(--text-color)");
  });

  it("routes an unresolvable var() from a breakpoint/state variant into unsupportedVariants with the original value", () => {
    const { classes } = parseCss(`.card:hover { color: var(--text-color); }`);
    const rec = classes.get("card")!;
    expect(rec.unsupportedVariants.main_hover?.color).toBe("var(--text-color)");
  });
});
