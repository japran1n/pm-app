// F055 (TH-181..TH-183) — Dirty-state tracking for the multi-block editor.
//
// Save in the code editor is an explicit act (round 1 Q20(a)): live preview
// updates as the user types, but a block is only considered "saved" once
// the user triggers save (button or platform shortcut). This hook tracks
// which block indices have unsaved edits so tab/file headers can show a
// `•` prefix, independent of preview state.
import { useCallback, useState } from "react";

export interface UseDirtyStateResult {
  dirtyIndices: Set<number>;
  isDirty: (index: number) => boolean;
  markDirty: (index: number) => void;
  markClean: (index: number) => void;
  resetAll: () => void;
}

/**
 * Tracks which block indices (by position in the block list) currently
 * have unsaved edits. Purely in-memory React state -- no persistence, no
 * network calls.
 */
export function useDirtyState(): UseDirtyStateResult {
  const [dirtyIndices, setDirtyIndices] = useState<Set<number>>(() => new Set());

  const isDirty = useCallback(
    (index: number) => dirtyIndices.has(index),
    [dirtyIndices],
  );

  const markDirty = useCallback((index: number) => {
    setDirtyIndices((prev) => {
      if (prev.has(index)) return prev;
      const next = new Set(prev);
      next.add(index);
      return next;
    });
  }, []);

  const markClean = useCallback((index: number) => {
    setDirtyIndices((prev) => {
      if (!prev.has(index)) return prev;
      const next = new Set(prev);
      next.delete(index);
      return next;
    });
  }, []);

  const resetAll = useCallback(() => {
    setDirtyIndices(new Set());
  }, []);

  return { dirtyIndices, isDirty, markDirty, markClean, resetAll };
}

/** Prefixes a tab/file label with `•` when the block is dirty (TH-181). */
export function dirtyLabel(label: string, dirty: boolean): string {
  return dirty ? `• ${label}` : label;
}
