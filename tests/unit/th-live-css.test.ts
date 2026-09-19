// @vitest-environment jsdom
//
// F062/F063/F064 — live CSS update channel (debounced style patch, JS
// blocks excluded, new/deleted CSS blocks trigger full recompose).

import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLiveCss, type LiveCssBlock } from "@/lib/code-editor/use-live-css";
import type { PreviewPaneHandle } from "@/components/code-editor/preview-pane";

function makeRef(patchStyle = vi.fn()) {
  return { current: { patchStyle } as unknown as PreviewPaneHandle };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe("useLiveCss (F062 style update channel)", () => {
  it("test_TH_155_css_block_change_calls_patchStyle_after_debounce", () => {
    const ref = makeRef();
    const blocks: LiveCssBlock[] = [{ index: 0, content: ".a{}", type: "css" }];
    const { result } = renderHook(() => useLiveCss(ref, blocks));

    act(() => {
      result.current.onBlockChange(0, ".a{color:red}");
    });

    expect(ref.current.patchStyle).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(ref.current.patchStyle).toHaveBeenCalledWith(0, ".a{color:red}");
  });

  it("test_TH_156_js_block_change_does_not_trigger_patchStyle", () => {
    const ref = makeRef();
    const blocks: LiveCssBlock[] = [{ index: 0, content: "console.log(1)", type: "js" }];
    const { result } = renderHook(() => useLiveCss(ref, blocks));

    act(() => {
      result.current.onBlockChange(0, "console.log(2)");
      vi.advanceTimersByTime(500);
    });

    expect(ref.current.patchStyle).not.toHaveBeenCalled();
  });

  it("test_TH_157_unknown_block_index_is_a_no_op", () => {
    const ref = makeRef();
    const blocks: LiveCssBlock[] = [{ index: 0, content: ".a{}", type: "css" }];
    const { result } = renderHook(() => useLiveCss(ref, blocks));

    act(() => {
      result.current.onBlockChange(99, ".b{}");
      vi.advanceTimersByTime(500);
    });

    expect(ref.current.patchStyle).not.toHaveBeenCalled();
  });
});

describe("useLiveCss debounce behaviour (F063)", () => {
  it("test_TH_158_rapid_keystrokes_within_300ms_only_patch_once_with_latest_content", () => {
    const ref = makeRef();
    const blocks: LiveCssBlock[] = [{ index: 0, content: ".a{}", type: "css" }];
    const { result } = renderHook(() => useLiveCss(ref, blocks));

    act(() => {
      result.current.onBlockChange(0, ".a{color:red}");
      vi.advanceTimersByTime(100);
      result.current.onBlockChange(0, ".a{color:green}");
      vi.advanceTimersByTime(100);
      result.current.onBlockChange(0, ".a{color:blue}");
      vi.advanceTimersByTime(300);
    });

    expect(ref.current.patchStyle).toHaveBeenCalledTimes(1);
    expect(ref.current.patchStyle).toHaveBeenCalledWith(0, ".a{color:blue}");
  });

  it("test_TH_159_independent_blocks_debounce_independently", () => {
    const ref = makeRef();
    const blocks: LiveCssBlock[] = [
      { index: 0, content: ".a{}", type: "css" },
      { index: 1, content: ".b{}", type: "css" },
    ];
    const { result } = renderHook(() => useLiveCss(ref, blocks));

    act(() => {
      result.current.onBlockChange(0, ".a{color:red}");
      vi.advanceTimersByTime(150);
      result.current.onBlockChange(1, ".b{color:red}");
      vi.advanceTimersByTime(150);
    });

    // Block 0's timer fired at 300ms total elapsed, block 1's has 150ms left.
    expect(ref.current.patchStyle).toHaveBeenCalledWith(0, ".a{color:red}");
    expect(ref.current.patchStyle).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(ref.current.patchStyle).toHaveBeenCalledWith(1, ".b{color:red}");
    expect(ref.current.patchStyle).toHaveBeenCalledTimes(2);
  });

  it("test_TH_160_pending_debounce_is_cancelled_on_unmount", () => {
    const ref = makeRef();
    const blocks: LiveCssBlock[] = [{ index: 0, content: ".a{}", type: "css" }];
    const { result, unmount } = renderHook(() => useLiveCss(ref, blocks));

    act(() => {
      result.current.onBlockChange(0, ".a{color:red}");
    });

    unmount();

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(ref.current.patchStyle).not.toHaveBeenCalled();
  });
});

describe("useLiveCss new/deleted CSS blocks (F064)", () => {
  it("test_TH_161_adding_a_new_css_block_triggers_onNeedsRecompose", () => {
    const ref = makeRef();
    const onNeedsRecompose = vi.fn();
    let blocks: LiveCssBlock[] = [{ index: 0, content: ".a{}", type: "css" }];
    const { rerender } = renderHook(
      ({ blocks }) => useLiveCss(ref, blocks, { onNeedsRecompose }),
      { initialProps: { blocks } },
    );

    expect(onNeedsRecompose).not.toHaveBeenCalled();

    blocks = [
      { index: 0, content: ".a{}", type: "css" },
      { index: 1, content: ".b{}", type: "css" },
    ];
    rerender({ blocks });

    expect(onNeedsRecompose).toHaveBeenCalledTimes(1);
  });

  it("test_TH_162_deleting_a_css_block_triggers_onNeedsRecompose", () => {
    const ref = makeRef();
    const onNeedsRecompose = vi.fn();
    let blocks: LiveCssBlock[] = [
      { index: 0, content: ".a{}", type: "css" },
      { index: 1, content: ".b{}", type: "css" },
    ];
    const { rerender } = renderHook(
      ({ blocks }) => useLiveCss(ref, blocks, { onNeedsRecompose }),
      { initialProps: { blocks } },
    );

    blocks = [{ index: 0, content: ".a{}", type: "css" }];
    rerender({ blocks });

    expect(onNeedsRecompose).toHaveBeenCalledTimes(1);
  });

  it("test_TH_163_editing_an_existing_css_block_does_not_trigger_onNeedsRecompose", () => {
    const ref = makeRef();
    const onNeedsRecompose = vi.fn();
    let blocks: LiveCssBlock[] = [{ index: 0, content: ".a{}", type: "css" }];
    const { rerender } = renderHook(
      ({ blocks }) => useLiveCss(ref, blocks, { onNeedsRecompose }),
      { initialProps: { blocks } },
    );

    blocks = [{ index: 0, content: ".a{color:red}", type: "css" }];
    rerender({ blocks });

    expect(onNeedsRecompose).not.toHaveBeenCalled();
  });

  it("test_TH_164_adding_a_js_block_does_not_trigger_onNeedsRecompose", () => {
    const ref = makeRef();
    const onNeedsRecompose = vi.fn();
    let blocks: LiveCssBlock[] = [{ index: 0, content: ".a{}", type: "css" }];
    const { rerender } = renderHook(
      ({ blocks }) => useLiveCss(ref, blocks, { onNeedsRecompose }),
      { initialProps: { blocks } },
    );

    blocks = [
      { index: 0, content: ".a{}", type: "css" },
      { index: 1, content: "console.log(1)", type: "js" },
    ];
    rerender({ blocks });

    expect(onNeedsRecompose).not.toHaveBeenCalled();
  });
});
