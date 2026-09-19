// @vitest-environment jsdom
//
// F056 (TH-184..TH-188) + F055 dirty-state (TH-181..TH-183): Prettier v3
// async format-on-save, and the dirty-tracking hook that backs the
// unsaved-indicator behaviour. Assertions derive from observable
// behaviour: formatting changes messy code into well-formatted code,
// never throws, leaves content untouched on error, and dirty tracking
// toggles a `•` prefix correctly.
import { describe, expect, it } from "vitest";
import { formatCode } from "@/lib/code-editor/format";
import { renderHook, act } from "@testing-library/react";
import { useDirtyState, dirtyLabel } from "@/lib/code-editor/use-dirty-state";

describe("TH-184: formatCode formats valid CSS", () => {
  it("normalizes spacing and quotes in CSS", async () => {
    const messy = "  .a{color :red;background:blue}";
    const formatted = await formatCode(messy, "css");
    expect(formatted).not.toBe(messy);
    expect(formatted).toContain(".a {");
    expect(formatted.trim().length).toBeGreaterThan(0);
  });
});

describe("TH-185: formatCode formats valid JavaScript (async, v3 API)", () => {
  it("normalizes spacing/quotes in JS using babel+estree parsers", async () => {
    const messy = "function foo(a,b){return a+b}";
    const formatted = await formatCode(messy, "javascript");
    expect(formatted).not.toBe(messy);
    expect(formatted).toContain("function foo(a, b)");
  });

  it("returns a Promise (v3 async API), not a synchronous string", () => {
    const result = formatCode("const x=1", "javascript");
    expect(result).toBeInstanceOf(Promise);
  });
});

describe("TH-186: formatting never throws on invalid input", () => {
  it("resolves (does not reject/throw) for malformed CSS", async () => {
    await expect(formatCode("{{{ not css ][", "css")).resolves.toBeTypeOf("string");
  });

  it("resolves (does not reject/throw) for malformed JS", async () => {
    await expect(formatCode("function ( { [", "javascript")).resolves.toBeTypeOf("string");
  });
});

describe("TH-187: on format error, original content is returned unchanged", () => {
  it("returns the exact original string for unparseable CSS", async () => {
    const broken = "this is definitely not valid css {{{{";
    const result = await formatCode(broken, "css");
    expect(result).toBe(broken);
  });

  it("returns the exact original string for unparseable JS", async () => {
    const broken = "function ( { [ this is not js";
    const result = await formatCode(broken, "javascript");
    expect(result).toBe(broken);
  });
});

describe("TH-188: formatting is idempotent on already-formatted code", () => {
  it("formatting twice produces the same result", async () => {
    const once = await formatCode(".a{color:red}", "css");
    const twice = await formatCode(once, "css");
    expect(twice).toBe(once);
  });
});

describe("TH-181: dirty state tracks per-block modified status", () => {
  it("a block is not dirty until marked dirty", () => {
    const { result } = renderHook(() => useDirtyState());
    expect(result.current.isDirty(0)).toBe(false);
  });

  it("markDirty flags a block index as dirty", () => {
    const { result } = renderHook(() => useDirtyState());
    act(() => result.current.markDirty(2));
    expect(result.current.isDirty(2)).toBe(true);
    expect(result.current.isDirty(0)).toBe(false);
  });
});

describe("TH-182: markClean clears the dirty flag for a block", () => {
  it("clears dirty state after save", () => {
    const { result } = renderHook(() => useDirtyState());
    act(() => result.current.markDirty(1));
    expect(result.current.isDirty(1)).toBe(true);
    act(() => result.current.markClean(1));
    expect(result.current.isDirty(1)).toBe(false);
  });
});

describe("TH-183: dirty indicator shows a bullet prefix, clean shows none", () => {
  it("prefixes the label with a bullet when dirty", () => {
    expect(dirtyLabel("styles.css", true)).toBe("• styles.css");
  });

  it("leaves the label unprefixed when clean", () => {
    expect(dirtyLabel("styles.css", false)).toBe("styles.css");
  });

  it("resetAll clears dirty state for every tracked block", () => {
    const { result } = renderHook(() => useDirtyState());
    act(() => {
      result.current.markDirty(0);
      result.current.markDirty(1);
    });
    act(() => result.current.resetAll());
    expect(result.current.isDirty(0)).toBe(false);
    expect(result.current.isDirty(1)).toBe(false);
  });
});
