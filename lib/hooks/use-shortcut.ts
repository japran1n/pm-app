"use client";

// F244 (AS-467, AS-468, AS-470, AS-471): shared primitives for the global
// keyboard-shortcut provider (components/command/shortcut-provider.tsx)
// and the components that react to its shortcuts (CommandPalette for
// AS-468, NewTaskDialog for AS-467).
//
// Kept as a plain hooks/utilities module (no React context, no new
// dependency) rather than a second store: the shortcut provider owns the
// ONE global keydown listener and communicates outward via `window`
// CustomEvents + this file's escape-layer stack, which is the simplest
// option that doesn't create a second source of truth for "what's open"
// (each dialog/sheet still owns its own `open` state — this module only
// tells it WHEN to close, never holds that state itself).

import { useEffect, useRef } from "react";

// ---------------------------------------------------------------------
// AS-470: does this keydown target count as "the user is typing", so a
// single-key shortcut (n, /) must NOT fire?
// ---------------------------------------------------------------------

/**
 * True when `target` is an editable surface: a native input/textarea/
 * select, any element with `contentEditable`, or inside Tiptap's
 * `.ProseMirror` root (Tiptap's contentEditable div is NOT always the
 * exact `event.target` once nested marks/nodes are involved, so this
 * checks `closest()` rather than only the element itself).
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;

  if (target.isContentEditable) return true;

  if (target.closest('[contenteditable="true"], [contenteditable=""], .ProseMirror')) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------
// AS-471: Escape closes the topmost layer, one at a time.
// ---------------------------------------------------------------------
// A minimal module-level stack. Any overlay that wants Escape to close
// only itself (and only when it is the TOPMOST registered layer) pushes
// itself while open and pops on close/unmount via `useEscapeLayer`. The
// shortcut provider's document keydown handler calls `popTopEscapeLayer()`
// on Escape; it returns `true` only if a layer actually handled it, so the
// provider can decide whether to `preventDefault()`.

type EscapeLayer = { id: number; onClose: () => void };

let escapeLayers: EscapeLayer[] = [];
let nextEscapeLayerId = 0;

/** Push a new topmost layer; returns the function that pops it again. */
export function pushEscapeLayer(onClose: () => void): () => void {
  const id = ++nextEscapeLayerId;
  escapeLayers = [...escapeLayers, { id, onClose }];
  return () => {
    escapeLayers = escapeLayers.filter((layer) => layer.id !== id);
  };
}

/**
 * Closes only the CURRENT topmost layer (one at a time — pressing Escape
 * again closes the next one down, it never closes every open layer in one
 * keystroke). Returns `false` when the stack is empty so the caller knows
 * nothing was handled.
 */
export function popTopEscapeLayer(): boolean {
  if (escapeLayers.length === 0) return false;
  const top = escapeLayers[escapeLayers.length - 1];
  escapeLayers = escapeLayers.slice(0, -1);
  top.onClose();
  return true;
}

/** Test-only: reset the module-level stack between test files/cases. */
export function __resetEscapeLayersForTests(): void {
  escapeLayers = [];
  nextEscapeLayerId = 0;
}

/**
 * Registers `onClose` as the topmost escape layer for as long as `active`
 * is true. Safe under React StrictMode's mount -> cleanup -> mount replay:
 * each effect run pushes its own layer and the matching cleanup always
 * pops that exact layer (by id), so a double-invoked effect never leaves
 * a stale duplicate registered.
 */
export function useEscapeLayer(active: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!active) return undefined;
    return pushEscapeLayer(() => onCloseRef.current());
  }, [active]);
}

// ---------------------------------------------------------------------
// Cross-component shortcut events. The provider dispatches these on
// `window`; the owning component (which already knows its own context —
// e.g. NewTaskDialog knows its `projectId`) decides whether to act on it.
// ---------------------------------------------------------------------

export const SHORTCUT_EVENTS = {
  /** AS-467: `n` in a project context — detail carries which project. */
  newTask: "pm-app:shortcut:new-task",
  /** AS-468: `/` — focuses/opens the search surface (command palette). */
  openSearch: "pm-app:shortcut:open-search",
  /** AS-469: `?` — opens the shortcut reference dialog (F245). */
  openHelp: "pm-app:shortcut:open-help",
} as const;

export type NewTaskShortcutDetail = { projectId: string | null };

// ---------------------------------------------------------------------
// F245 (AS-469, AS-472): the ONE registry the help dialog renders from
// AND the provider below dispatches from. A hand-maintained second list
// in the dialog would drift the moment a shortcut changes here — so the
// dialog must import THIS array, never a copy of it.
// ---------------------------------------------------------------------

export type ShortcutRegistryEntry = {
  /** Stable id, also used as the React key in the help dialog. */
  id: string;
  /** The literal key this shortcut binds to (no modifier — see keys below). */
  key: string;
  /** Human label for the key, shown in the help dialog (e.g. "Esc", "?"). */
  keyLabel: string;
  /** One-line description of what the shortcut does. */
  description: string;
};

export const SHORTCUT_REGISTRY: readonly ShortcutRegistryEntry[] = [
  { id: "new-task", key: "n", keyLabel: "N", description: "Create a new task in the current project" },
  { id: "open-search", key: "/", keyLabel: "/", description: "Open search" },
  { id: "open-help", key: "?", keyLabel: "?", description: "Show keyboard shortcuts" },
  { id: "close", key: "Escape", keyLabel: "Esc", description: "Close the topmost dialog or panel" },
] as const;

// ---------------------------------------------------------------------
// Cross-platform key rendering: Cmd on macOS, Ctrl elsewhere. This is the
// ONE detection method in the codebase — F241/F244 do not yet have their
// own, so this is where it lives; anything needing it (e.g. the help
// dialog's Cmd+K row) should import `isMacPlatform`/`modifierKeyLabel`
// from here rather than re-deriving it.
// ---------------------------------------------------------------------

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
      ?.platform ?? navigator.platform ?? navigator.userAgent;
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

export function modifierKeyLabel(): string {
  return isMacPlatform() ? "⌘" : "Ctrl";
}
