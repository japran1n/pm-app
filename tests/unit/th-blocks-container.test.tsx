// @vitest-environment jsdom
//
// F082b — blocks state container (follow-up from F082 PARTIAL).
//
// Exercises `useBlocks` (lib/code-editor/use-blocks.ts) as the stateful
// container the FileList component wires into: initial blocks are exposed
// as-is, adding a block (as triggered by FileList's onCreate) appends it
// with the requested type/name, renaming updates the displayed name, and
// updating a block's content is reflected without touching other blocks.

import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBlocks, type EditableBlock } from "@/lib/code-editor/use-blocks";

function styleBlock(index: number, name: string, content = ""): EditableBlock {
  return {
    type: "style",
    index,
    name,
    content,
    originalContent: content,
    isUserCreated: false,
  };
}

function scriptBlock(index: number, name: string, content = ""): EditableBlock {
  return {
    type: "script",
    index,
    name,
    content,
    originalContent: content,
    isUserCreated: true,
  };
}

describe("useBlocks state container (F082b)", () => {
  it("exposes the initial blocks passed in", () => {
    const initial = [styleBlock(0, "extracted.css", "body{}"), scriptBlock(1, "extracted.js", "1;")];
    const { result } = renderHook(() => useBlocks(initial));

    expect(result.current.blocks).toHaveLength(2);
    expect(result.current.blocks[0].name).toBe("extracted.css");
    expect(result.current.blocks[1].name).toBe("extracted.js");
  });

  it("addBlock creates a new block with the correct type and name (CSS)", () => {
    const { result } = renderHook(() => useBlocks([styleBlock(0, "existing.css")]));

    act(() => {
      result.current.addBlock(scriptBlockFactory());
    });

    function scriptBlockFactory(): EditableBlock {
      return {
        type: "style",
        index: 1,
        name: "new-style.css",
        content: "",
        originalContent: "",
        isUserCreated: true,
      };
    }

    expect(result.current.blocks).toHaveLength(2);
    expect(result.current.blocks[1].name).toBe("new-style.css");
    expect(result.current.blocks[1].type).toBe("style");
  });

  it("addBlock creates a new block with the correct type and name (JS)", () => {
    const { result } = renderHook(() => useBlocks([]));

    act(() => {
      result.current.addBlock({
        type: "script",
        index: 0,
        name: "new-script.js",
        content: "",
        originalContent: "",
        isUserCreated: true,
      });
    });

    expect(result.current.blocks).toHaveLength(1);
    expect(result.current.blocks[0].name).toBe("new-script.js");
    expect(result.current.blocks[0].type).toBe("script");
  });

  it("renameBlock updates the displayed name without touching other fields", () => {
    const { result } = renderHook(() =>
      useBlocks([styleBlock(0, "old-name.css", "body{color:red}")]),
    );

    act(() => {
      result.current.renameBlock(0, "renamed.css");
    });

    expect(result.current.blocks[0].name).toBe("renamed.css");
    expect(result.current.blocks[0].content).toBe("body{color:red}");
  });

  it("updateBlock updates content for the target index only", () => {
    const { result } = renderHook(() =>
      useBlocks([styleBlock(0, "a.css", "one"), styleBlock(1, "b.css", "two")]),
    );

    act(() => {
      result.current.updateBlock(1, "two-edited");
    });

    expect(result.current.blocks[0].content).toBe("one");
    expect(result.current.blocks[1].content).toBe("two-edited");
  });
});
