"use client";

// F016: the narrow bridge between the docs assistant sidebar (a sibling
// panel, not a descendant of the editor — see components/ai/
// assistant-sidebar.tsx's own file header on why it mounts as a peer of
// the content panel) and the currently-open MarkdownEditor instance.
//
// Same "leaf announces itself upward" shape components/docs/
// markdown-editor.tsx already uses for the breadcrumb title
// (useSetBreadcrumb) — the editor registers a small imperative handle on
// mount/unmount, keyed by docId, and ProposalCard (components/ai/
// proposal-card.tsx) looks it up by the proposal's own docId when the
// user clicks Accept. No React context/provider tree needed: the sidebar
// and the editor page are siblings under the workspace layout, not
// ancestor/descendant, so a context would have to be hoisted awkwardly
// high for a single narrow need.
//
// This module holds NO document content and performs NO writes itself —
// it is pure wiring. The actual write happens in
// lib/actions/ai-proposals.ts's `applyDocEditProposal`, called from
// ProposalCard; this bridge only lets that call site (a) read the
// editor's true live markdown for the staleness check, (b) stop the
// editor's own pending autosave from racing that write, and (c) push the
// newly-persisted markdown back into the editor's own state afterward so
// the two never disagree.

export type DocEditorHandle = {
  /** The editor's current, un-persisted-if-pending, live markdown. */
  getCurrentMarkdown: () => string;
  /**
   * Cancels (does not fire) the editor's pending debounced autosave, if
   * one is scheduled. Idempotent — safe to call when nothing is pending.
   */
  cancelPendingSave: () => void;
  /**
   * Pushes already-persisted markdown into the editor's own state (after
   * a successful `applyDocEditProposal` write) without re-triggering the
   * editor's own autosave — the write already happened once; this only
   * keeps the editor's in-memory state in sync with it.
   */
  applyAcceptedMarkdown: (markdown: string) => void;
};

const handles = new Map<string, DocEditorHandle>();

/**
 * Registers the live editor handle for a doc. Returns an unregister
 * function for the caller's cleanup effect. A later registration for the
 * same docId (e.g. a fast remount) replaces the earlier one; unregistering
 * an already-replaced handle is a no-op (guards against an unmount
 * cleanup from a stale instance clobbering a newer one's registration).
 */
export function registerDocEditorHandle(docId: string, handle: DocEditorHandle): () => void {
  handles.set(docId, handle);
  return () => {
    if (handles.get(docId) === handle) {
      handles.delete(docId);
    }
  };
}

/** Returns the live handle for a doc, or null if no editor for it is mounted. */
export function getDocEditorHandle(docId: string): DocEditorHandle | null {
  return handles.get(docId) ?? null;
}
