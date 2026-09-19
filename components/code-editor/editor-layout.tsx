"use client";

// F082b — main layout wiring for the multi-block code editor.
//
// Owns block state (`useBlocks`) on top of the fetched site (`useFetchSite`),
// and wires the sub-components together:
//   - FileList's onCreate(type) -> a new EditableBlock is created here with
//     a default name (`new-style.css` / `new-script.js`) and empty content
//     (F082, TH-205/TH-206).
//   - FileList's onRename(index, name) -> useBlocks.renameBlock.
//   - FileList's onSelect(index) -> useBlocks.setActiveIndex.
//   - EditorLazy's onChange(content) for the active block ->
//     useBlocks.updateBlock, plus useLiveCss for a debounced style-patch on
//     CSS edits.
//   - PreviewPane renders the composed document; patchStyle is invoked via
//     useLiveCss whenever a CSS block's content changes.

import { useCallback, useMemo, useRef } from "react";
import { FileList, type FileListEntry } from "@/components/code-editor/file-list";
import EditorLazy from "@/components/code-editor/editor-lazy";
import { PreviewPane, type PreviewPaneHandle } from "@/components/code-editor/preview-pane";
import { useBlocks, type EditableBlock } from "@/lib/code-editor/use-blocks";
import { useLiveCss } from "@/lib/code-editor/use-live-css";
import { useDirtyState } from "@/lib/code-editor/use-dirty-state";
import { composeDocument } from "@/lib/code-editor/compose";
import type { Corpus } from "@/lib/code-editor/corpus";

export interface EditorLayoutProps {
  /** Initial blocks, typically extracted from the fetched site (F102). */
  initialBlocks: EditableBlock[];
  /** Raw source HTML the blocks were extracted from. */
  html: string;
  corpus?: Corpus | null;
}

let creationCounter = 0;

function defaultNameFor(type: "css" | "js"): string {
  creationCounter += 1;
  const suffix = creationCounter > 1 ? `-${creationCounter}` : "";
  return type === "css" ? `new-style${suffix}.css` : `new-script${suffix}.js`;
}

function toFileListEntries(blocks: EditableBlock[]): FileListEntry[] {
  return blocks.map((block, index) => ({
    index,
    name: block.name ?? (block.type === "style" ? `style-${index}.css` : `script-${index}.js`),
    type: block.type === "style" ? "css" : "js",
  }));
}

export function EditorLayout({ initialBlocks, html, corpus }: EditorLayoutProps) {
  const {
    blocks,
    activeIndex,
    setActiveIndex,
    addBlock,
    renameBlock,
    updateBlock,
    composableBlocks,
  } = useBlocks(initialBlocks);

  const previewRef = useRef<PreviewPaneHandle | null>(null);

  // F055/F055b — dirty-state tracking is owned here (per block index)
  // rather than inside EditorPane, since it must survive across which
  // block is active/selected.
  const { isDirty, markDirty, markClean } = useDirtyState();

  const composedHtml = useMemo(
    () => composeDocument(html, composableBlocks(), { injectStyleAgent: true }),
    [html, composableBlocks],
  );

  const { onBlockChange } = useLiveCss(
    previewRef,
    blocks.map((b) => ({
      index: b.index,
      content: b.content,
      type: b.type === "style" ? "css" : "js",
    })),
  );

  const handleCreate = useCallback(
    (type: "css" | "js") => {
      const nextIndex = blocks.length;
      const name = defaultNameFor(type);
      const newBlock: EditableBlock =
        type === "css"
          ? {
              type: "style",
              index: nextIndex,
              name,
              content: "",
              originalContent: "",
              isUserCreated: true,
            }
          : {
              type: "script",
              index: nextIndex,
              name,
              content: "",
              originalContent: "",
              isUserCreated: true,
            };
      addBlock(newBlock);
    },
    [blocks.length, addBlock],
  );

  const handleRename = useCallback(
    (index: number, name: string) => {
      renameBlock(index, name);
    },
    [renameBlock],
  );

  const handleEditorChange = useCallback(
    (content: string) => {
      if (activeIndex < 0) return;
      updateBlock(activeIndex, content);
      onBlockChange(activeIndex, content);
      markDirty(activeIndex);
    },
    [activeIndex, updateBlock, onBlockChange, markDirty],
  );

  const handleEditorSave = useCallback(() => {
    if (activeIndex < 0) return;
    markClean(activeIndex);
  }, [activeIndex, markClean]);

  const activeBlock = activeIndex >= 0 ? blocks[activeIndex] : undefined;

  return (
    <div className="flex h-full w-full">
      <FileList
        blocks={toFileListEntries(blocks)}
        activeIndex={activeIndex}
        onSelect={setActiveIndex}
        onRename={handleRename}
        onCreate={handleCreate}
      />
      <div className="flex flex-1 flex-col">
        {activeBlock ? (
          <EditorLazy
            file={activeBlock}
            onChange={handleEditorChange}
            corpus={corpus ?? undefined}
            isDirty={isDirty(activeIndex)}
            onSave={handleEditorSave}
          />
        ) : null}
      </div>
      <PreviewPane ref={previewRef} composedHtml={composedHtml} />
    </div>
  );
}
