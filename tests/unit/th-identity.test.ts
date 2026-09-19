// TH-120..TH-124 — block identity rebinding across same-host navigation.
// lib/code-editor/identity.ts

import { describe, it, expect } from "vitest";
import { hashContent, rebindBlocks, type IdentityBlock } from "@/lib/code-editor/identity";

describe("identity.ts", () => {
  it("test_TH_120_hashContent_is_deterministic_for_same_content", () => {
    expect(hashContent("body { color: red; }")).toBe(
      hashContent("body { color: red; }")
    );
  });

  it("test_TH_120_hashContent_differs_for_different_content", () => {
    expect(hashContent("a")).not.toBe(hashContent("b"));
  });

  it("test_TH_120_rebinds_block_by_content_hash_when_index_changes", () => {
    const oldBlocks: IdentityBlock[] = [
      { index: 0, content: "css-a", name: "a.css" },
      { index: 1, content: "css-b", name: "b.css" },
    ];
    // On the new page, the same content now appears at a different index.
    const newBlocks: IdentityBlock[] = [
      { index: 0, content: "css-b", name: "b.css" },
      { index: 1, content: "css-a", name: "a.css" },
    ];

    const result = rebindBlocks(oldBlocks, newBlocks);

    expect(result[0].previousIndex).toBe(1); // css-b was old index 1
    expect(result[1].previousIndex).toBe(0); // css-a was old index 0
  });

  it("test_TH_121_falls_back_to_document_index_when_no_content_match", () => {
    const oldBlocks: IdentityBlock[] = [
      { index: 0, content: "old-content-0", name: "a.css" },
    ];
    const newBlocks: IdentityBlock[] = [
      { index: 0, content: "totally-different-content", name: "a.css" },
    ];

    const result = rebindBlocks(oldBlocks, newBlocks);

    expect(result[0].previousIndex).toBe(0);
  });

  it("test_TH_122_new_block_with_no_content_or_index_match_is_unbound", () => {
    const oldBlocks: IdentityBlock[] = [
      { index: 0, content: "old-content", name: "a.css" },
    ];
    const newBlocks: IdentityBlock[] = [
      { index: 5, content: "brand-new-content", name: "new.css" },
    ];

    const result = rebindBlocks(oldBlocks, newBlocks);

    expect(result[0].previousIndex).toBeUndefined();
  });

  it("test_TH_124_each_old_block_is_consumed_at_most_once", () => {
    // Two old blocks share identical content; two new blocks also share
    // that content. Each new block should bind to a distinct old block,
    // not the same one twice.
    const oldBlocks: IdentityBlock[] = [
      { index: 0, content: "shared", name: "a.css" },
      { index: 1, content: "shared", name: "b.css" },
    ];
    const newBlocks: IdentityBlock[] = [
      { index: 0, content: "shared", name: "a.css" },
      { index: 1, content: "shared", name: "b.css" },
    ];

    const result = rebindBlocks(oldBlocks, newBlocks);

    const boundIndices = result.map((r) => r.previousIndex).sort();
    expect(boundIndices).toEqual([0, 1]);
  });

  it("test_TH_120_content_match_is_preferred_over_index_match", () => {
    const oldBlocks: IdentityBlock[] = [
      { index: 0, content: "content-A", name: "a.css" },
      { index: 1, content: "content-B", name: "b.css" },
    ];
    // New block at index 0 has content-B's original content — should match
    // by content (old index 1), not by index (old index 0).
    const newBlocks: IdentityBlock[] = [
      { index: 0, content: "content-B", name: "b.css" },
    ];

    const result = rebindBlocks(oldBlocks, newBlocks);

    expect(result[0].previousIndex).toBe(1);
  });

  it("test_TH_122_unmatched_old_blocks_can_be_derived_from_result", () => {
    const oldBlocks: IdentityBlock[] = [
      { index: 0, content: "kept", name: "a.css" },
      { index: 1, content: "removed-on-new-page", name: "b.css" },
    ];
    const newBlocks: IdentityBlock[] = [
      { index: 0, content: "kept", name: "a.css" },
    ];

    const result = rebindBlocks(oldBlocks, newBlocks);
    const matchedOldIndices = new Set(result.map((r) => r.previousIndex));

    // old index 1 ("removed-on-new-page") was not matched by any new block,
    // so callers can mark it absent from the current document (TH-122).
    expect(matchedOldIndices.has(1)).toBe(false);
    expect(matchedOldIndices.has(0)).toBe(true);
  });

  it("test_TH_121_rebindBlocks_returns_empty_array_for_empty_new_blocks", () => {
    const oldBlocks: IdentityBlock[] = [
      { index: 0, content: "x", name: "a.css" },
    ];
    expect(rebindBlocks(oldBlocks, [])).toEqual([]);
  });

  it("test_TH_121_rebindBlocks_with_no_old_blocks_returns_all_unmatched", () => {
    const newBlocks: IdentityBlock[] = [
      { index: 0, content: "x", name: "a.css" },
      { index: 1, content: "y", name: "b.css" },
    ];
    const result = rebindBlocks([], newBlocks);
    expect(result.every((r) => r.previousIndex === undefined)).toBe(true);
  });
});
