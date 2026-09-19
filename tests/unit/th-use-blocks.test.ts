// @vitest-environment jsdom
// F083, F087, F088 (TH-207, TH-208, TH-123, TH-125)
import { afterEach, describe, expect, test, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useBlocks, type EditableBlock } from "@/lib/code-editor/use-blocks";
import { useHostReset } from "@/lib/code-editor/use-host-reset";
import { composeDocument } from "@/lib/code-editor/compose";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeBlock(overrides: Partial<EditableBlock> = {}): EditableBlock {
  return {
    index: 0,
    type: "style",
    originalContent: ".a { color: red; }",
    content: ".a { color: red; }",
    name: "styles-0.css",
    isUserCreated: false,
    ...overrides,
  };
}

describe("useBlocks", () => {
  // TH-207
  test("TH_207_user_created_file_can_be_deleted", () => {
    const block = makeBlock({ isUserCreated: true, name: "new.css" });
    const { result } = renderHook(() =>
      useBlocks([block], { onConfirmDelete: () => true }),
    );

    let deleted = false;
    act(() => {
      deleted = result.current.deleteBlock(0);
    });

    expect(deleted).toBe(true);
    expect(result.current.blocks).toHaveLength(0);
  });

  // TH-208
  test("TH_208_extracted_file_cannot_be_deleted", () => {
    const block = makeBlock({ isUserCreated: false, name: "extracted.css" });
    const confirmSpy = vi.fn(() => true);
    const { result } = renderHook(() =>
      useBlocks([block], { onConfirmDelete: confirmSpy }),
    );

    let deleted = false;
    act(() => {
      deleted = result.current.deleteBlock(0);
    });

    expect(deleted).toBe(false);
    expect(result.current.blocks).toHaveLength(1);
    // Confirmation should never even be prompted for a protected file.
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  test("deletion is skipped when the user cancels the confirmation", () => {
    const block = makeBlock({ isUserCreated: true });
    const { result } = renderHook(() =>
      useBlocks([block], { onConfirmDelete: () => false }),
    );

    let deleted = false;
    act(() => {
      deleted = result.current.deleteBlock(0);
    });

    expect(deleted).toBe(false);
    expect(result.current.blocks).toHaveLength(1);
  });

  test("activeIndex adjusts to nearest valid index after deletion", () => {
    const blocks = [
      makeBlock({ index: 0, name: "a.css", isUserCreated: true }),
      makeBlock({ index: 1, name: "b.css", isUserCreated: true }),
      makeBlock({ index: 2, name: "c.css", isUserCreated: true }),
    ];
    const { result } = renderHook(() =>
      useBlocks(blocks, { onConfirmDelete: () => true }),
    );

    act(() => {
      result.current.setActiveIndex(2);
    });
    expect(result.current.activeIndex).toBe(2);

    // Delete the last block; active index should clamp to new last index.
    act(() => {
      result.current.deleteBlock(2);
    });
    expect(result.current.activeIndex).toBe(1);
    expect(result.current.blocks).toHaveLength(2);
  });

  test("addBlock appends and rename/update mutate the right block", () => {
    const { result } = renderHook(() => useBlocks([]));

    act(() => {
      result.current.addBlock(
        makeBlock({ isUserCreated: true, name: "new.css" }),
      );
    });
    expect(result.current.blocks).toHaveLength(1);
    expect(result.current.activeIndex).toBe(0);

    act(() => {
      result.current.renameBlock(0, "renamed.css");
    });
    expect(result.current.blocks[0].name).toBe("renamed.css");

    act(() => {
      result.current.updateBlock(0, ".a { color: blue; }");
    });
    expect(result.current.blocks[0].content).toBe(".a { color: blue; }");
  });

  // TH-123
  test("TH_123_absent_block_excluded_from_composable_blocks", () => {
    const present = makeBlock({
      index: 0,
      name: "present.css",
      originalContent: ".present {}",
      content: ".present { color: green; }",
    });
    const absent = makeBlock({
      index: 1,
      name: "absent.css",
      originalContent: ".absent {}",
      content: ".absent { color: purple; }",
      isAbsent: true,
    });

    const { result } = renderHook(() => useBlocks([present, absent]));

    // File list still contains the absent block (visibly distinguished by
    // isAbsent) — it is not deleted, only excluded from composition.
    expect(result.current.blocks).toHaveLength(2);

    const composable = result.current.composableBlocks();
    expect(composable).toHaveLength(1);
    expect(composable[0].originalContent).toBe(".present {}");
  });

  // TH-123 — verify composeDocument itself never leaks an excluded block's
  // content into the recomposed document.
  test("TH_123_composeDocument_never_receives_absent_block_content", () => {
    const html = "<html><head><style>.present {}</style></head><body></body></html>";
    const present = makeBlock({
      index: 0,
      originalContent: ".present {}",
      content: ".present { color: green; }",
    });
    const absent = makeBlock({
      index: 1,
      originalContent: ".absent {}",
      content: ".absent { color: purple; }",
      isAbsent: true,
    });

    const { result } = renderHook(() => useBlocks([present, absent]));

    const output = composeDocument(html, result.current.composableBlocks());

    expect(output).toContain("color: green");
    expect(output).not.toContain("color: purple");
    expect(output).not.toContain(".absent {}");
  });
});

describe("useHostReset", () => {
  // TH-125
  test("TH_125_fires_onReset_when_hostname_changes", () => {
    const onReset = vi.fn();
    const { rerender } = renderHook(
      ({ host }: { host: string }) => useHostReset(host, onReset),
      { initialProps: { host: "site-a.webflow.io" } },
    );

    expect(onReset).not.toHaveBeenCalled();

    rerender({ host: "site-a.webflow.io" });
    expect(onReset).not.toHaveBeenCalled();

    rerender({ host: "site-b.webflow.io" });
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  test("does not fire on initial mount", () => {
    const onReset = vi.fn();
    renderHook(() => useHostReset("first-host.com", onReset));
    expect(onReset).not.toHaveBeenCalled();
  });

  test("does not fire when hostname is empty", () => {
    const onReset = vi.fn();
    const { rerender } = renderHook(
      ({ host }: { host: string }) => useHostReset(host, onReset),
      { initialProps: { host: "" } },
    );
    rerender({ host: "" });
    expect(onReset).not.toHaveBeenCalled();
  });

  test("full reset flow: hook resets blocks to newly extracted set on host change", () => {
    const oldBlocks: EditableBlock[] = [
      makeBlock({ index: 0, name: "old.css", isUserCreated: true }),
    ];
    const newBlocks: EditableBlock[] = [
      makeBlock({ index: 0, name: "new.css", isUserCreated: false }),
    ];

    let currentBlocks = oldBlocks;
    const onReset = vi.fn(() => {
      currentBlocks = newBlocks;
    });

    const { rerender } = renderHook(
      ({ host }: { host: string }) => useHostReset(host, onReset),
      { initialProps: { host: "site-a.webflow.io" } },
    );

    rerender({ host: "site-b.webflow.io" });

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(currentBlocks).toBe(newBlocks);
  });

  // TH-252
  test("TH_252_initialActiveIndex_restores_persisted_selection", () => {
    const blocks: EditableBlock[] = [
      makeBlock({ index: 0, name: "a.css" }),
      makeBlock({ index: 1, name: "b.js", type: "script" }),
      makeBlock({ index: 2, name: "c.css" }),
    ];
    const { result } = renderHook(() =>
      useBlocks(blocks, { initialActiveIndex: 2 }),
    );
    expect(result.current.activeIndex).toBe(2);
  });

  test("TH_252_initialActiveIndex_out_of_range_falls_back_to_first_block", () => {
    const blocks: EditableBlock[] = [
      makeBlock({ index: 0, name: "a.css" }),
      makeBlock({ index: 1, name: "b.js", type: "script" }),
    ];
    const { result } = renderHook(() =>
      useBlocks(blocks, { initialActiveIndex: 99 }),
    );
    expect(result.current.activeIndex).toBe(0);
  });

  test("TH_252_omitted_initialActiveIndex_defaults_to_first_block", () => {
    const blocks: EditableBlock[] = [
      makeBlock({ index: 0, name: "a.css" }),
      makeBlock({ index: 1, name: "b.js", type: "script" }),
    ];
    const { result } = renderHook(() => useBlocks(blocks));
    expect(result.current.activeIndex).toBe(0);
  });
});
