// @vitest-environment jsdom
//
// F065 (TH-159): CSS version switch reuses the live patch path instead of
// forcing a full recompose/reload.

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useVersionRestore } from "@/lib/code-editor/use-version-restore";
import type { PreviewPaneHandle } from "@/components/code-editor/preview-pane";

function makeRef(handle: PreviewPaneHandle | null): { current: PreviewPaneHandle | null } {
  return { current: handle };
}

describe("useVersionRestore (F065 / TH-159)", () => {
  it("test_TH_159_restore_calls_patchStyle_with_index_and_content", () => {
    const patchStyle = vi.fn();
    const ref = makeRef({ patchStyle });

    const { result } = renderHook(() => useVersionRestore(ref));
    result.current.restoreCssVersion(2, ".foo { color: red; }");

    expect(patchStyle).toHaveBeenCalledTimes(1);
    expect(patchStyle).toHaveBeenCalledWith(2, ".foo { color: red; }");
  });

  it("test_TH_159_restore_no_reload_no_full_recompose_side_effect", () => {
    // The hook's only side effect is the postMessage-backed patchStyle
    // call — no other method on the handle (e.g. a reload/recompose) is
    // ever invoked, confirming version switch does not force a reload.
    const patchStyle = vi.fn();
    const reload = vi.fn();
    const handle = { patchStyle, reload } as unknown as PreviewPaneHandle & { reload: () => void };
    const ref = makeRef(handle);

    const { result } = renderHook(() => useVersionRestore(ref));
    result.current.restoreCssVersion(0, "body { margin: 0; }");

    expect(patchStyle).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it("test_TH_159_restore_is_noop_when_preview_ref_not_mounted", () => {
    const ref = makeRef(null);
    const { result } = renderHook(() => useVersionRestore(ref));

    expect(() => result.current.restoreCssVersion(0, ".x{}")).not.toThrow();
  });
});
