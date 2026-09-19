// F083, F087 (TH-207, TH-208, TH-123) — hook managing the blocks array for
// the multi-block code editor.
//
// User-created files can be deleted (with confirmation); files extracted
// from the source document cannot (TH-208) — the delete control is never
// even offered for them, and this hook refuses the operation defensively
// if it is attempted anyway. A block can also be marked "absent" so it is
// excluded from composeDocument (TH-123) while still being listed for the
// user, visibly distinguished.
import { useCallback, useState } from "react";
import type { Block } from "./compose";

export type EditableBlock = Block & {
  /** True for files the user created in the editor; false for files
   * extracted from the source document. Only user-created files may be
   * deleted (TH-207, TH-208). */
  isUserCreated: boolean;
  /** True when this file is not present in the current document (e.g. it
   * was extracted from a page the user has since navigated away from).
   * Absent blocks are excluded from composeDocument (TH-123). */
  isAbsent?: boolean;
};

export interface UseBlocksOptions {
  /** Called to confirm a deletion. Defaults to window.confirm when
   * available. Return true to proceed with deletion. */
  onConfirmDelete?: (block: EditableBlock, index: number) => boolean;
}

export interface UseBlocksResult {
  blocks: EditableBlock[];
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  addBlock: (block: EditableBlock) => void;
  deleteBlock: (index: number) => boolean;
  renameBlock: (index: number, name: string) => void;
  updateBlock: (index: number, content: string) => void;
  /** Blocks with isAbsent excluded — the set that should be passed to
   * composeDocument (TH-123). */
  composableBlocks: () => Block[];
}

function defaultConfirm(): boolean {
  if (typeof window !== "undefined" && typeof window.confirm === "function") {
    return window.confirm("Delete this file? This cannot be undone.");
  }
  // No confirm available (e.g. non-browser test environment without a
  // stub) — default to not deleting, since silent destructive action is
  // worse than a no-op.
  return false;
}

/**
 * Manages the array of editor blocks (files): add, delete (user-created
 * only), rename, update content, and active-file selection.
 */
export function useBlocks(
  initialBlocks: EditableBlock[],
  options?: UseBlocksOptions,
): UseBlocksResult {
  const [blocks, setBlocks] = useState<EditableBlock[]>(initialBlocks);
  const [activeIndex, setActiveIndex] = useState<number>(
    initialBlocks.length > 0 ? 0 : -1,
  );

  const addBlock = useCallback((block: EditableBlock) => {
    setBlocks((prev) => {
      const next = [...prev, block];
      setActiveIndex(next.length - 1);
      return next;
    });
  }, []);

  const deleteBlock = useCallback(
    (index: number): boolean => {
      const target = blocks[index];
      if (!target) return false;

      // TH-208: extracted (non-user-created) files can never be deleted.
      if (!target.isUserCreated) {
        return false;
      }

      const confirm = options?.onConfirmDelete ?? defaultConfirm;
      if (!confirm(target, index)) {
        return false;
      }

      setBlocks((prev) => {
        const next = prev.filter((_, i) => i !== index);
        setActiveIndex((prevActive) => {
          if (next.length === 0) return -1;
          if (index < prevActive) return prevActive - 1;
          if (index === prevActive) {
            // Move to nearest valid index: the block now at the same
            // position, or the last block if we deleted the tail.
            return Math.min(index, next.length - 1);
          }
          return prevActive;
        });
        return next;
      });

      return true;
    },
    [blocks, options],
  );

  const renameBlock = useCallback((index: number, name: string) => {
    setBlocks((prev) =>
      prev.map((b, i) => (i === index ? { ...b, name } : b)),
    );
  }, []);

  const updateBlock = useCallback((index: number, content: string) => {
    setBlocks((prev) =>
      prev.map((b, i) => (i === index ? { ...b, content } : b)),
    );
  }, []);

  const composableBlocks = useCallback((): Block[] => {
    return blocks.filter((b) => !b.isAbsent);
  }, [blocks]);

  return {
    blocks,
    activeIndex,
    setActiveIndex,
    addBlock,
    deleteBlock,
    renameBlock,
    updateBlock,
    composableBlocks,
  };
}
