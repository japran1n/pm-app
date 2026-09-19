// F032 (TH-107, TH-108, TH-109) — deduplicateBlocks() collapses identical
// content into a single kept occurrence.

import { describe, expect, it } from "vitest";
import {
  deduplicateBlocks,
  extractStyleBlocks,
  type StyleBlock,
} from "@/lib/code-editor/extract";

function styleBlock(overrides: Partial<StyleBlock> = {}): StyleBlock {
  return {
    index: 0,
    type: "style",
    originalContent: "a{color:red;}",
    content: "a{color:red;}",
    ...overrides,
  };
}

describe("deduplicateBlocks", () => {
  // TH-107: identical content collapses to one entry
  it("TH-107: collapses two blocks with identical trimmed content to one", () => {
    const blocks = [
      styleBlock({ index: 0, originalContent: "a{color:red;}" }),
      styleBlock({ index: 1, originalContent: "a{color:red;}" }),
    ];
    const result = deduplicateBlocks(blocks);
    expect(result).toHaveLength(1);
    expect(result[0].index).toBe(0);
  });

  it("TH-107: content differing only by surrounding whitespace still collapses", () => {
    const blocks = [
      styleBlock({ index: 0, originalContent: "a{color:red;}" }),
      styleBlock({ index: 1, originalContent: "\n  a{color:red;}\n  " }),
    ];
    const result = deduplicateBlocks(blocks);
    expect(result).toHaveLength(1);
  });

  // TH-108: kept entry retains its original index
  it("TH-108: kept block retains its original index value (not renumbered)", () => {
    const blocks = [
      styleBlock({ index: 2, originalContent: "unique-one{}" }),
      styleBlock({ index: 5, originalContent: "unique-two{}" }),
    ];
    const result = deduplicateBlocks(blocks);
    expect(result.map((b) => b.index)).toEqual([2, 5]);
  });

  // TH-109: only the first occurrence is kept; distinct content is untouched
  it("TH-109: keeps first occurrence in array order and preserves distinct blocks", () => {
    const blocks = [
      styleBlock({ index: 0, originalContent: "shared{}", content: "shared{}" }),
      styleBlock({ index: 1, originalContent: "distinct{}", content: "distinct{}" }),
      styleBlock({ index: 2, originalContent: "shared{}", content: "shared{}" }),
    ];
    const result = deduplicateBlocks(blocks);
    expect(result).toHaveLength(2);
    expect(result.map((b) => b.index)).toEqual([0, 1]);
  });

  it("returns an empty array for an empty input", () => {
    expect(deduplicateBlocks([])).toEqual([]);
  });

  it("works end-to-end with extractStyleBlocks() output", () => {
    const html =
      "<style>.a{color:red;}</style><style>.a{color:red;}</style><style>.b{color:blue;}</style>";
    const blocks = extractStyleBlocks(html);
    expect(blocks).toHaveLength(3);
    const deduped = deduplicateBlocks(blocks);
    expect(deduped).toHaveLength(2);
    expect(deduped.map((b) => b.index)).toEqual([0, 2]);
  });
});
