"use client";

import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  isMacPlatform,
  SHORTCUT_EVENTS,
  SHORTCUT_REGISTRY,
  useEscapeLayer,
} from "@/lib/hooks/use-shortcut";

// F245 (AS-469, AS-472): the shortcut reference dialog. Renders directly
// from `SHORTCUT_REGISTRY` (lib/hooks/use-shortcut.ts) — the SAME array
// `ShortcutProvider` dispatches from — rather than a hand-maintained
// second list, so this dialog cannot silently drift out of sync with what
// actually fires (AS-472: "every documented shortcut actually works").
//
// The Cmd+K row below is the one exception: it documents CommandPalette's
// own shortcut (F241, AS-459), which lives in a modified-key branch that
// isn't part of the single-key `SHORTCUT_REGISTRY` (that registry only
// covers bare, non-modifier keys — see use-shortcut.ts). It is composed
// from the same `modifierKeyLabel()` platform helper used everywhere else
// in this file, not a second detection method.
export function ShortcutHelpDialog() {
  const [open, setOpen] = React.useState(false);
  // Lazy initializer: reads `navigator` on the client's first render pass
  // (not inside an effect, avoiding a cascading re-render) and is `false`
  // during SSR, matching the pre-hydration DOM.
  const [mac] = React.useState(() => isMacPlatform());

  React.useEffect(() => {
    function onOpenHelp() {
      setOpen(true);
    }
    window.addEventListener(SHORTCUT_EVENTS.openHelp, onOpenHelp);
    return () => window.removeEventListener(SHORTCUT_EVENTS.openHelp, onOpenHelp);
  }, []);

  // AS-471 (F244): participate in the topmost-only Escape-layer stack so
  // Escape closes THIS dialog (and only this one) while it's open, the
  // same pattern NewTaskDialog already uses. Base-ui's Dialog primitive
  // also closes itself on Escape natively (via `onOpenChange`) — both
  // mechanisms agreeing to close the same dialog is harmless, matching
  // NewTaskDialog's existing wiring exactly.
  useEscapeLayer(open, () => setOpen(false));

  const mod = mac ? "⌘" : "Ctrl";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Shortcuts available anywhere in the app (not while typing in a field).
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-2 text-mini">
          <li className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Open the command palette</span>
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-micro">
              {mod}K
            </kbd>
          </li>
          {/* Follow-up (Cmd+P project switcher): same "modified-key chord,
              documented as its own row rather than in SHORTCUT_REGISTRY"
              convention as the Cmd+K row above — see that component's
              own file-header comment. */}
          <li className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Switch project</span>
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-micro">
              {mod}P
            </kbd>
          </li>
          {SHORTCUT_REGISTRY.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">{entry.description}</span>
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-micro">
                {entry.keyLabel}
              </kbd>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
