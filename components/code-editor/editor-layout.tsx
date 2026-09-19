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
import {
  initVersions,
  loadVersions,
  saveVersions,
  forkFromOriginal,
  renameVersion,
  duplicateVersion,
  deleteVersion,
  restoreVersion as restoreVersionContent,
  updateVersionContent,
  loadActiveVersionId,
  saveActiveVersionId,
  type Version,
} from "@/lib/code-editor/versions";

/** Per-block version state: the full named-version list plus which one is
 * currently active (TH-209..TH-219). */
type VersionEntry = { versions: Version[]; activeVersionId: string };

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
    deleteBlock,
    renameBlock,
    updateBlock,
    composableBlocks,
    resetBlocks,
  } = useBlocks(effectiveInitialBlocks, {
    // TH-252 — restore the previously-selected file (by persisted id) on
    // mount, falling back to the first block when there's no match.
    initialActiveIndex: (() => {
      if (!restoredState?.selectedBlockId) return undefined;
      const match = effectiveInitialBlocks.findIndex(
        (block) => String(block.index) === String(restoredState.selectedBlockId),
      );
      return match >= 0 ? match : undefined;
    })(),
  });

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

  // TH-209..TH-219 — per-block named version state. Initialized lazily (on
  // first access of a block) as a single read-only "Original" snapshot of
  // that block's initial content; the first edit forks a "Draft" off it.
  const [versionsByBlock, setVersionsByBlock] = useState<Record<number, VersionEntry>>({});

  const ensureVersionEntry = useCallback(
    (index: number): VersionEntry => {
      const existing = versionsByBlock[index];
      if (existing) return existing;
      const block = blocks[index];
      const initialContent = block ? (block.originalContent ?? block.content) : "";
      const versions = hostname
        ? loadVersions(hostname, index, initialContent)
        : initVersions(initialContent);
      // TH-253 — restore the previously-active version for this block from
      // its own persisted id rather than always defaulting to Original.
      // Fall back to the most recently created non-Original version (if
      // any) when nothing is persisted or the stored id no longer exists
      // (e.g. that version was deleted).
      const storedActiveId = hostname ? loadActiveVersionId(hostname, index) : null;
      let activeVersionId: string;
      if (storedActiveId && versions.some((v) => v.id === storedActiveId)) {
        activeVersionId = storedActiveId;
      } else {
        const nonOriginal = versions.filter((v) => !v.isOriginal);
        activeVersionId =
          nonOriginal.length > 0
            ? nonOriginal[nonOriginal.length - 1].id
            : (versions[0]?.id ?? "");
      }
      const entry: VersionEntry = { versions, activeVersionId };
      return entry;
    },
    [versionsByBlock, blocks, hostname],
  );

  // Lazily seed version state for the active block the first time it's
  // touched (selected or edited), without clobbering state that already
  // exists for it. This is done during render (the "adjusting state during
  // rendering" pattern -- see https://react.dev/learn/you-might-not-need-an-effect)
  // rather than in a useEffect. The `!versionsByBlock[activeIndex]` guard is
  // sufficient to prevent a re-render loop: once the state update below
  // lands, this branch is false on the next render for that block.
  if (activeIndex >= 0 && !versionsByBlock[activeIndex]) {
    const entry = ensureVersionEntry(activeIndex);
    setVersionsByBlock((prev) => (prev[activeIndex] ? prev : { ...prev, [activeIndex]: entry }));
  }

  // R4-3/TH-219 — tracks the most recent editor content for the active
  // block outside of React state. `handleEditorSave` (fired from the
  // Cmd+S command in EditorPane, synchronously right after `onChange`)
  // needs the just-formatted content to write it back into the active
  // version's snapshot, but the state updates queued by `handleEditorChange`
  // in the same tick aren't visible yet via closures/props at that point.
  const lastEditedContentRef = useRef<string>("");

  const handleEditorChange = useCallback(
    (content: string) => {
      if (activeIndex < 0) return;
      lastEditedContentRef.current = content;
      updateBlock(activeIndex, content);
      onBlockChange(activeIndex, content);
      markDirty(activeIndex);
      // TH-211 — the first edit against a read-only ("Original"-only)
      // version list forks a new, editable "Draft" version and makes it
      // active. Subsequent edits just keep the editor content ahead of the
      // active version's saved snapshot (surfaced as "(modified)").
      setVersionsByBlock((prev) => {
        const entry = prev[activeIndex] ?? ensureVersionEntry(activeIndex);
        const active = entry.versions.find((v) => v.id === entry.activeVersionId);
        if (!active?.isOriginal) {
          return prev[activeIndex] ? prev : { ...prev, [activeIndex]: entry };
        }
        // R4-3 — seed the forked Draft with the content the user is
        // actually editing (not Original's stale snapshot), so versions
        // diverge immediately instead of staying byte-identical until the
        // next explicit save.
        const forked = forkFromOriginal(entry.versions);
        const draftId = forked[forked.length - 1].id;
        const forkedWithContent = updateVersionContent(forked, draftId, content);
        const draft = forkedWithContent[forkedWithContent.length - 1];
        const nextEntry: VersionEntry = { versions: forkedWithContent, activeVersionId: draft.id };
        if (hostname) {
          saveVersions(hostname, activeIndex, forkedWithContent);
          saveActiveVersionId(hostname, activeIndex, draft.id);
        }
        return { ...prev, [activeIndex]: nextEntry };
      });
    },
    [activeIndex, updateBlock, onBlockChange, markDirty, hostname, ensureVersionEntry],
  );

  const handleEditorSave = useCallback(() => {
    if (activeIndex < 0) return;
    markClean(activeIndex);
    // R4-3/TH-219 — Cmd+S persists the current editor content back into the
    // active version's saved snapshot. Previously nothing ever wrote
    // content back into a version, so every version stayed byte-identical
    // to whatever it was forked/duplicated from, and restoring a version
    // never changed anything.
    const content = lastEditedContentRef.current;
    setVersionsByBlock((prev) => {
      const entry = prev[activeIndex] ?? ensureVersionEntry(activeIndex);
      if (!entry.activeVersionId) {
        return prev[activeIndex] ? prev : { ...prev, [activeIndex]: entry };
      }
      const versions = updateVersionContent(entry.versions, entry.activeVersionId, content);
      if (hostname) saveVersions(hostname, activeIndex, versions);
      return { ...prev, [activeIndex]: { ...entry, versions } };
    });
  }, [activeIndex, markClean, hostname, ensureVersionEntry]);

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
    (id: string) => {
      if (activeIndex < 0) return;
      const entry = versionsByBlock[activeIndex] ?? ensureVersionEntry(activeIndex);
      const content = restoreVersionContent(entry.versions, id);
      if (content === null) return;
      updateBlock(activeIndex, content);
      onBlockChange(activeIndex, content);
      markDirty(activeIndex);
      lastEditedContentRef.current = content;
      if (hostname) saveActiveVersionId(hostname, activeIndex, id);
      setVersionsByBlock((prev) => ({
        ...prev,
        [activeIndex]: { ...entry, activeVersionId: id },
      }));
    },
    [activeIndex, versionsByBlock, ensureVersionEntry, updateBlock, onBlockChange, markDirty, hostname],
  );

  const handleRenameVersion = useCallback(
    (id: string, name: string) => {
      if (activeIndex < 0) return;
      const entry = versionsByBlock[activeIndex] ?? ensureVersionEntry(activeIndex);
      const versions = renameVersion(entry.versions, id, name);
      if (hostname) saveVersions(hostname, activeIndex, versions);
      setVersionsByBlock((prev) => ({ ...prev, [activeIndex]: { ...entry, versions } }));
    },
    [activeIndex, versionsByBlock, ensureVersionEntry, hostname],
  );

  const handleDuplicateVersion = useCallback(
    (id: string) => {
      if (activeIndex < 0) return;
      const entry = versionsByBlock[activeIndex] ?? ensureVersionEntry(activeIndex);
      const versions = duplicateVersion(entry.versions, id);
      if (hostname) saveVersions(hostname, activeIndex, versions);
      setVersionsByBlock((prev) => ({ ...prev, [activeIndex]: { ...entry, versions } }));
    },
    [activeIndex, versionsByBlock, ensureVersionEntry, hostname],
  );

  const handleDeleteVersion = useCallback(
    (id: string) => {
      if (activeIndex < 0) return;
      const entry = versionsByBlock[activeIndex] ?? ensureVersionEntry(activeIndex);
      const versions = deleteVersion(entry.versions, id);
      if (versions === entry.versions) return; // no-op (Original or missing)
      if (hostname) saveVersions(hostname, activeIndex, versions);
      // TH-216 — deleting the active version makes "Original" active.
      let nextActiveId = entry.activeVersionId;
      if (entry.activeVersionId === id) {
        const original = versions.find((v) => v.isOriginal);
        nextActiveId = original ? original.id : (versions[0]?.id ?? "");
        if (original) {
          updateBlock(activeIndex, original.content);
          onBlockChange(activeIndex, original.content);
          markDirty(activeIndex);
          lastEditedContentRef.current = original.content;
        }
      }
      if (hostname) saveActiveVersionId(hostname, activeIndex, nextActiveId);
      setVersionsByBlock((prev) => ({
        ...prev,
        [activeIndex]: { versions, activeVersionId: nextActiveId },
      }));
    },
    [activeIndex, versionsByBlock, ensureVersionEntry, hostname, updateBlock, onBlockChange, markDirty],
  );

  const activeVersionEntry = activeIndex >= 0 ? versionsByBlock[activeIndex] : undefined;
  const activeVersions = activeVersionEntry?.versions ?? [];
  const activeVersionId = activeVersionEntry?.activeVersionId ?? null;

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
              onDelete={deleteBlock}
            />
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex shrink-0 items-center justify-end border-b border-border px-2 py-1">
                <VersionMenu
                  versions={activeVersions}
                  activeVersionId={activeVersionId}
                  currentContent={activeBlock?.content ?? ""}
                  onRestore={handleRestoreVersion}
                  onRename={handleRenameVersion}
                  onDuplicate={handleDuplicateVersion}
                  onDelete={handleDeleteVersion}
                />
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
