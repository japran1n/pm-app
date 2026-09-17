import { describe, expect, it } from "vitest";
import { parse } from "node-html-parser";

// F001: infrastructure smoke check — confirms node-html-parser resolves
// correctly in a Node-runtime context (this file, vitest's node environment)
// and behaves as a DOM-like parser, matching the prototype's usage pattern.
// No conversion logic is implemented here — that is future work (F0xx).

describe("F001 node-html-parser dependency", () => {
  it("resolves and parses a basic HTML fragment", () => {
    const root = parse("<div class=\"box\"><span>hello</span></div>");
    const div = root.querySelector(".box");

    expect(div).not.toBeNull();
    expect(div?.tagName).toBe("DIV");
    expect(div?.querySelector("span")?.text).toBe("hello");
  });

  it("returns an empty-but-valid root for empty input", () => {
    const root = parse("");

    expect(root).toBeDefined();
    expect(root.childNodes).toEqual([]);
  });
});
