"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import {
  isEditableTarget,
  popTopEscapeLayer,
  SHORTCUT_EVENTS,
  type NewTaskShortcutDetail,
} from "@/lib/hooks/use-shortcut";

// F244 (AS-467, AS-468, AS-470, AS-471): the single global keydown
// listener for bare, non-modifier single-key shortcuts (`n`, `/`) plus
// the app-wide Escape-closes-topmost-layer behaviour.
//
// Coexistence with F241's CommandPalette listener (AS-459/463/464)
// -----------------------------------------------------------------
// AUTONOMOUS_DECISION: this provider does NOT subsume CommandPalette's
// existing `document.addEventListener("keydown", ...)` for Cmd+K/Ctrl+K.
// The two listeners are kept SEPARATE rather than merged into one,
// because:
//   1. They key off disjoint input: CommandPalette only ever acts on the
//      metaKey/ctrlKey+"k" chord (a MODIFIED key); this provider only
//      ever acts on bare, non-modifier single keys ("n", "/", "Escape").
//      `if (event.metaKey || event.ctrlKey || event.altKey) return;` at
//      the top of this handler guarantees the two can never both react to
//      the same keydown, so there is no "two listeners fighting over the
//      same key" scenario despite both living on `document`.
//   2. CommandPalette's Cmd+K listener is already shipped, unit-tested
//      (AS-459/463/464), and mounted in the exact same layout — merging
//      it into this new file would mean re-deriving and re-testing
//      already-correct, already-covered logic purely for the sake of
//      having one listener object, at real regression risk for zero
//      behavioural gain.
//   3. Where this feature DOES need to talk to CommandPalette (AS-468,
//      "/" opens search) it uses a `window` CustomEvent
//      (`SHORTCUT_EVENTS.openSearch`) rather than reaching into
//      CommandPalette's state directly — the same "communicate via a
//      narrow event, not a shared listener" seam used for AS-467's
//      new-task shortcut talking to NewTaskDialog.
// Two `document`-level keydown listeners existing side by side is safe in
// the DOM (every listener runs; neither can "consume" the event from the
// other short of calling `stopImmediatePropagation`, which neither does)
// as long as their trigger conditions never overlap — which is guaranteed
// here as described above.
export function ShortcutProvider() {
  const pathname = usePathname();
  const pathnameRef = React.useRef(pathname);
  React.useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Key-repeat (a held-down key) must never re-fire a one-shot
      // shortcut — same convention F241 already established for Cmd+K.
      if (event.repeat) return;

      // AS-471: Escape closes only the CURRENT topmost registered layer,
      // one at a time. Deliberately NOT gated by isEditableTarget below —
      // dismissing an open overlay via Escape must keep working even when
      // focus happens to be inside a field within that overlay (the
      // standard "Escape always closes the dialog you're in" behaviour).
      if (event.key === "Escape") {
        if (popTopEscapeLayer()) {
          event.preventDefault();
        }
        return;
      }

      // Modified keystrokes are never single-key shortcuts here — Cmd/
      // Ctrl+K is CommandPalette's own listener (see file header), and
      // this guards against e.g. Cmd+N (new browser window) or Alt+/ from
      // ever being misread as this feature's bare "n"/"/".
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      // AS-470: never fire a single-key shortcut while the user is typing
      // in an input, textarea, contenteditable, or the Tiptap editor.
      if (isEditableTarget(event.target)) return;

      // AS-467: `n` creates a task in the CURRENT context — the project
      // the caller is currently looking at (board or list route). Outside
      // a project context there is nothing to create a task "in", so the
      // shortcut is a deliberate no-op rather than guessing a target.
      if (event.key === "n") {
        const match = pathnameRef.current?.match(/\/projects\/([^/]+)/);
        const projectId = match ? match[1] : null;
        if (!projectId) return;

        event.preventDefault();
        window.dispatchEvent(
          new CustomEvent<NewTaskShortcutDetail>(SHORTCUT_EVENTS.newTask, {
            detail: { projectId },
          }),
        );
        return;
      }

      // AS-468: `/` focuses search — the command palette IS this app's
      // search surface (F241/F242), so "/" opens it rather than a second,
      // parallel search UI; CommandPalette autofocuses its own
      // `CommandInput` the moment it opens, satisfying "focuses search"
      // without this provider reaching into CommandPalette's state.
      if (event.key === "/") {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent(SHORTCUT_EVENTS.openSearch));
        return;
      }

      // AS-469 (F245): `?` opens the shortcut reference dialog. `?` is
      // Shift+/ on a US keyboard layout, so this deliberately reads
      // `event.key === "?"` (the produced character) rather than
      // requiring `event.shiftKey`, which keeps it layout-agnostic.
      if (event.key === "?") {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent(SHORTCUT_EVENTS.openHelp));
        return;
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return null;
}
