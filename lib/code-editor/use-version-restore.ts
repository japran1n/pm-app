// F065 (TH-159) — CSS version switch without reload.
//
// Restoring a previous version of a CSS block does not warrant a full
// document recompose: the same `patchStyle` postMessage path used for live
// edits (F060/F062) is reused so the preview updates immediately, without
// tearing down and re-mounting the sandboxed iframe.
import { useCallback } from "react";

import type { PreviewPaneHandle } from "@/components/code-editor/preview-pane";

export interface UseVersionRestoreResult {
  /**
   * Restores a CSS block to a previous version's content and immediately
   * patches the live preview via `PreviewPaneHandle.patchStyle`. No-op when
   * the preview ref isn't mounted yet — `patchStyle` itself already
   * tolerates a missing iframe/composedHtml (see preview-pane.tsx), and we
   * additionally guard against a null ref here so this hook never throws
   * before the preview has mounted.
   */
  restoreCssVersion: (index: number, content: string) => void;
}

/**
 * Hook wiring CSS version restore to the live preview patch path
 * (TH-159). CSS-only: JS version restores must go through the rebuild
 * path (F066/use-rebuild-trigger.ts) instead, since JS changes require a
 * full document recompose.
 */
export function useVersionRestore(
  previewRef: React.RefObject<PreviewPaneHandle | null>,
): UseVersionRestoreResult {
  const restoreCssVersion = useCallback(
    (index: number, content: string) => {
      const handle = previewRef.current;
      if (!handle) return;
      handle.patchStyle(index, content);
    },
    [previewRef],
  );

  return { restoreCssVersion };
}
