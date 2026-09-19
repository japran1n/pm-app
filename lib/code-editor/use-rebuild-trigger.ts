// F066 (TH-160..TH-164) — JS rebuild path.
//
// JS blocks cannot be live-patched over postMessage the way CSS blocks
// are (F065/use-version-restore.ts): the previewed document is
// opaque-origin and script execution can't be hot-swapped in place, so any
// JS change or JS version restore requires a full document recompose and
// iframe re-render. This hook tracks a "needs rebuild" flag so the host
// component can debounce/gate that recompose (e.g. only on explicit
// save/reload, not on every keystroke) and notifies callers via
// `onNeedsRebuild` the moment the flag flips true.
import { useCallback, useState } from "react";

export interface UseRebuildTriggerOptions {
  /**
   * Invoked exactly when `needsRebuild` transitions from false to true.
   * Not invoked on repeated `triggerRebuild()` calls while already
   * pending, and not invoked by `clearRebuild()`.
   */
  onNeedsRebuild?: () => void;
}

export interface UseRebuildTriggerResult {
  needsRebuild: boolean;
  /** Marks a rebuild as required (JS block changed or was restored). */
  triggerRebuild: () => void;
  /** Clears the flag once the host has recomposed and re-rendered. */
  clearRebuild: () => void;
}

/**
 * Tracks whether the previewed document needs a full recompose (TH-160,
 * TH-163, TH-164). Purely in-memory — no persistence, no network calls.
 */
export function useRebuildTrigger(
  options: UseRebuildTriggerOptions = {},
): UseRebuildTriggerResult {
  const { onNeedsRebuild } = options;
  const [needsRebuild, setNeedsRebuild] = useState(false);

  const triggerRebuild = useCallback(() => {
    setNeedsRebuild((prev) => {
      if (prev) return prev;
      onNeedsRebuild?.();
      return true;
    });
  }, [onNeedsRebuild]);

  const clearRebuild = useCallback(() => {
    setNeedsRebuild(false);
  }, []);

  return { needsRebuild, triggerRebuild, clearRebuild };
}
