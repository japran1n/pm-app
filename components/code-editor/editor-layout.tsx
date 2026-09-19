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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileList, type FileListEntry } from "@/components/code-editor/file-list";
import EditorLazy from "@/components/code-editor/editor-lazy";
import { type PreviewPaneHandle } from "@/components/code-editor/preview-pane";
import { PreviewChrome } from "@/components/code-editor/preview-chrome";
import { SplitLayout } from "@/components/code-editor/split-layout";
import { VersionMenu } from "@/components/code-editor/version-menu";
import { useBlocks, type EditableBlock } from "@/lib/code-editor/use-blocks";
import { useHostReset } from "@/lib/code-editor/use-host-reset";
import { useLiveCss } from "@/lib/code-editor/use-live-css";
import { useDirtyState } from "@/lib/code-editor/use-dirty-state";
import { composeDocument } from "@/lib/code-editor/compose";
import type { Corpus } from "@/lib/code-editor/corpus";
import { saveEditorState, loadEditorState, type EditorState } from "@/lib/webflow-editor/storage";
import { saveVersion, getVersions } from "@/lib/code-editor/versions";

export interface EditorLayoutProps {
  /** Initial blocks, typically extracted from the fetched site (F102). */
  initialBlocks: EditableBlock[];
  /** Raw source HTML the blocks were extracted from. */
  html: string;
  corpus?: Corpus | null;
  /** Hostname used as the persistence key (F089). Undefined/empty disables
   * persistence entirely (e.g. tests exercising the layout in isolation). */
  hostname?: string | null;
  /** URL of the currently loaded page -- used to avoid restoring stale
   * content saved against a different page under the same hostname. */
  url?: string | null;
}

/** Extra fields this component stacks onto the `StoredBlock` shape declared
 * in lib/webflow-editor/storage.ts so a page refresh can restore full block
 * *content*, not just metadata. `saveEditorState`/`loadEditorState` only
 * validate the fields they declare, so these extra fields round-trip
 * through JSON untouched. */
type PersistedBlock = {
  id: string;
  index: number;
  type: "style" | "script";
  name?: string;
  activeVersionId: string;
  content: string;
};

type PersistedState = {
  blocks: PersistedBlock[];
  versions: EditorState["versions"];
  selectedBlockId?: string | null;
  url?: string;
  activeIndex?: number;
};

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

export function EditorLayout({ initialBlocks, html, corpus, hostname, url }: EditorLayoutProps) {
  // F089/F090/F091 — restore previously-saved block content for this host
  // on initial load, but only when the saved state was captured against the
  // same page URL (a different URL under the same hostname means the user
  // navigated to a different page; its blocks aren't relevant here).
  const restoredState = useMemo<PersistedState | null>(() => {
    if (!hostname) return null;
    const state = loadEditorState(hostname) as unknown as PersistedState | null;
    if (!state) return null;
    // TH-251..255 — only restore when the saved state was captured against
    // this exact page URL. A missing `state.url` (older/partial persisted
    // state) is treated as "not safe to restore", not as an automatic
    // match — restoring against the wrong page silently loses the user's
    // actual current-page files.
    if (state.url !== url) return null;
    return state;
    // Only recompute if the hostname changes (a fresh site load) -- not on
    // every render, so the user's own edits are never clobbered by a stale
    // read of their own just-written state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostname]);

  const effectiveInitialBlocks = useMemo<EditableBlock[]>(() => {
    if (!restoredState || restoredState.blocks.length === 0) return initialBlocks;
    // TH-251..255 — the persisted state is the full working set (it may
    // include user-created files that aren't part of the freshly extracted
    // `initialBlocks`, and edited content for files that are). Use it as
    // the source of truth for the initial block list rather than only
    // patching content onto the extracted blocks, so a mount with a valid
    // restored state actually reflects what the user had open.
    const extractedByIndex = new Map(initialBlocks.map((b) => [b.index, b]));
    return restoredState.blocks.map((stored): EditableBlock => {
      const extracted = extractedByIndex.get(stored.index);
      if (extracted) {
        return {
          ...extracted,
          content: typeof stored.content === "string" ? stored.content : extracted.content,
          name: stored.name ?? extracted.name,
        };
      }
      // No matching extracted block at this index -- this was a
      // user-created file that only exists in the persisted state.
      return {
        type: stored.type,
        index: stored.index,
        name: stored.name,
        content: stored.content,
        originalContent: "",
        hasCdata: false,
        isUserCreated: true,
      };
    });
  }, [initialBlocks, restoredState]);

  const {
    blocks,
    activeIndex,
    setActiveIndex,
    addBlock,
    renameBlock,
    updateBlock,
    composableBlocks,
    resetBlocks,
  } = useBlocks(effectiveInitialBlocks);

  // TH-125 — a hostname change means the user fetched a different site;
  // discard whatever files are currently open and replace them with the
  // newly extracted (or restored, if any) blocks for the new host. Uses a
  // ref-backed callback (see useHostReset) so the reset always sees the
  // latest effectiveInitialBlocks for the new host, not a stale closure.
  useHostReset(hostname ?? "", () => {
    resetBlocks(effectiveInitialBlocks);
  });

  // F089/F090 — persist the working set (blocks + content + which file is
  // selected) whenever it changes, so a page refresh doesn't lose edits.
  // Every localStorage access inside saveEditorState is already
  // try/catch-guarded (TH-258/TH-259) -- failures degrade silently.
  useEffect(() => {
    if (!hostname) return;
    const persisted: PersistedState = {
      blocks: blocks.map((b) => ({
        id: String(b.index),
        index: b.index,
        type: b.type,
        name: b.name,
        activeVersionId: "current",
        content: b.content,
      })),
      versions: {},
      selectedBlockId: activeIndex >= 0 ? String(activeIndex) : null,
      url: url ?? undefined,
      activeIndex,
    };
    saveEditorState(hostname, persisted as unknown as EditorState);
  }, [blocks, activeIndex, hostname, url]);

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
              hasCdata: false,
              isUserCreated: true,
            }
          : {
              type: "script",
              index: nextIndex,
              name,
              content: "",
              originalContent: "",
              hasCdata: false,
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
      // TH-209..TH-219 — record a version snapshot per edit so the user can
      // recover an earlier revision of this block later (F091).
      if (hostname) {
        saveVersion(hostname, activeIndex, content);
      }
    },
    [activeIndex, updateBlock, onBlockChange, markDirty, hostname],
  );

  const handleEditorSave = useCallback(() => {
    if (activeIndex < 0) return;
    markClean(activeIndex);
  }, [activeIndex, markClean]);

  const activeBlock = activeIndex >= 0 ? blocks[activeIndex] : undefined;

  const [lastLinkHref, setLastLinkHref] = useState<string | null>(null);
  const handleLinkClick = useCallback((href: string) => {
    setLastLinkHref(href);
  }, []);

  const handleReload = useCallback(() => {
    // Force a recompose by re-reading the current composedHtml into the
    // iframe. PreviewPane keys off `composedHtml` content changes, so
    // nudging the ref's own patch machinery isn't needed here -- a simple
    // re-render is sufficient since composedHtml is already memoized off
    // the latest block content.
    previewRef.current?.patchStyle(activeIndex, activeBlock?.content ?? "");
  }, [activeIndex, activeBlock]);

  const handleRestoreVersion = useCallback(
    (content: string) => {
      if (activeIndex < 0) return;
      updateBlock(activeIndex, content);
      onBlockChange(activeIndex, content);
      markDirty(activeIndex);
      if (hostname) {
        saveVersion(hostname, activeIndex, content);
      }
    },
    [activeIndex, updateBlock, onBlockChange, markDirty, hostname],
  );

  const activeVersions = hostname && activeIndex >= 0 ? getVersions(hostname, activeIndex) : [];

  return (
    <div className="flex h-full w-full">
      <SplitLayout
        left={
          <div className="flex h-full w-full">
            <FileList
              blocks={toFileListEntries(blocks)}
              activeIndex={activeIndex}
              onSelect={setActiveIndex}
              onRename={handleRename}
              onCreate={handleCreate}
            />
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex shrink-0 items-center justify-end border-b border-border px-2 py-1">
                <VersionMenu versions={activeVersions} onRestore={handleRestoreVersion} />
              </div>
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
          </div>
        }
        right={
          <PreviewChrome
            ref={previewRef}
            url={url ?? ""}
            composedHtml={composedHtml}
            onLinkClick={handleLinkClick}
            lastLinkHref={lastLinkHref}
            onReload={handleReload}
          />
        }
      />
    </div>
  );
}
