// F062/F063/F064 (TH-155..TH-170 range: TH-150..TH-158, TH-151, TH-152,
// TH-154, TH-155) — host-side live CSS update channel for the code editor.
//
// Bridges Monaco block edits to `PreviewPane.patchStyle` (F060) without a
// full iframe reload:
//   - CSS block edits are debounced 300ms and sent as a style-patch
//     postMessage via the preview ref (F062, F063).
//   - JS block edits never trigger a live patch — they need a full
//     recompose, which is out of scope for this hook (F062).
//   - Blocks that appear or disappear between renders (new/deleted CSS
//     block) cannot be safely patched in place — the block index space
//     changed — so those trigger `onNeedsRecompose` instead (F064).
//
// Purely in-memory: a ref tracks the previous block index set for
// added/removed detection, and a ref tracks the pending debounce timers.
import { useCallback, useEffect, useRef } from "react";

import type { PreviewPaneHandle } from "@/components/code-editor/preview-pane";

export type LiveCssBlockType = "css" | "js";

export interface LiveCssBlock {
  index: number;
  content: string;
  type: LiveCssBlockType;
}

const DEBOUNCE_MS = 300;

export interface UseLiveCssOptions {
  /**
   * Called when a block's mere existence changed shape in a way that a
   * single style-patch cannot represent: a new CSS block was added, or an
   * existing CSS block was deleted. The caller is expected to fully
   * recompose `composedHtml` and re-render the iframe (F064).
   */
  onNeedsRecompose?: () => void;
}

export interface UseLiveCssResult {
  /**
   * Call with the new content whenever a block's Monaco model changes.
   * No-ops for non-CSS blocks (F062).
   */
  onBlockChange: (index: number, newContent: string) => void;
}

/**
 * React import type only — avoids a hard dependency on the `React`
 * namespace import style used elsewhere in the editor.
 */
type PreviewRef = { current: PreviewPaneHandle | null };

export function useLiveCss(
  previewRef: PreviewRef,
  blocks: LiveCssBlock[],
  options: UseLiveCssOptions = {},
): UseLiveCssResult {
  const { onNeedsRecompose } = options;

  // Debounce timers keyed by block index (F063).
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  // Snapshot of the block-type-by-index map as of the last render, used to
  // detect additions/removals of CSS blocks between renders (F064).
  const prevCssIndicesRef = useRef<Set<number>>(
    new Set(blocks.filter((b) => b.type === "css").map((b) => b.index)),
  );

  useEffect(() => {
    const currentCssIndices = new Set(
      blocks.filter((b) => b.type === "css").map((b) => b.index),
    );
    const prevCssIndices = prevCssIndicesRef.current;

    let changed = false;
    for (const index of currentCssIndices) {
      if (!prevCssIndices.has(index)) {
        changed = true;
        break;
      }
    }
    if (!changed) {
      for (const index of prevCssIndices) {
        if (!currentCssIndices.has(index)) {
          changed = true;
          break;
        }
      }
    }

    prevCssIndicesRef.current = currentCssIndices;

    if (changed) {
      onNeedsRecompose?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks]);

  // Cancel all pending debounce timers on unmount (F063).
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  const onBlockChange = useCallback(
    (index: number, newContent: string) => {
      const block = blocks.find((b) => b.index === index);
      // JS block edits never live-patch — full recompose is required and is
      // out of scope for this hook (F062).
      if (!block || block.type !== "css") return;

      const timers = timersRef.current;
      const existing = timers.get(index);
      if (existing) {
        clearTimeout(existing);
      }

      const timer = setTimeout(() => {
        timers.delete(index);
        previewRef.current?.patchStyle(index, newContent);
      }, DEBOUNCE_MS);

      timers.set(index, timer);
    },
    [blocks, previewRef],
  );

  return { onBlockChange };
}
