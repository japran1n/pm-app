// @vitest-environment jsdom
//
// F066 (TH-160..TH-164): JS block changes/restores require a full document
// recompose rather than a live postMessage patch. This hook tracks the
// "needs rebuild" flag and notifies via onNeedsRebuild.

import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useRebuildTrigger } from "@/lib/code-editor/use-rebuild-trigger";

describe("useRebuildTrigger (F066 / TH-160..TH-164)", () => {
  it("test_TH_160_starts_with_needsRebuild_false", () => {
    const { result } = renderHook(() => useRebuildTrigger());
    expect(result.current.needsRebuild).toBe(false);
  });

  it("test_TH_161_triggerRebuild_sets_needsRebuild_true", () => {
    const { result } = renderHook(() => useRebuildTrigger());
    act(() => {
      result.current.triggerRebuild();
    });
    expect(result.current.needsRebuild).toBe(true);
  });

  it("test_TH_162_clearRebuild_resets_flag_after_recompose", () => {
    const { result } = renderHook(() => useRebuildTrigger());
    act(() => {
      result.current.triggerRebuild();
    });
    expect(result.current.needsRebuild).toBe(true);
    act(() => {
      result.current.clearRebuild();
    });
    expect(result.current.needsRebuild).toBe(false);
  });

  it("test_TH_163_onNeedsRebuild_called_on_transition_to_true_only_once", () => {
    const onNeedsRebuild = vi.fn();
    const { result } = renderHook(() => useRebuildTrigger({ onNeedsRebuild }));

    act(() => {
      result.current.triggerRebuild();
    });
    act(() => {
      result.current.triggerRebuild();
    });

    expect(onNeedsRebuild).toHaveBeenCalledTimes(1);
  });

  it("test_TH_164_clearRebuild_does_not_invoke_onNeedsRebuild", () => {
    const onNeedsRebuild = vi.fn();
    const { result } = renderHook(() => useRebuildTrigger({ onNeedsRebuild }));

    act(() => {
      result.current.triggerRebuild();
    });
    onNeedsRebuild.mockClear();

    act(() => {
      result.current.clearRebuild();
    });

    expect(onNeedsRebuild).not.toHaveBeenCalled();
  });
});
