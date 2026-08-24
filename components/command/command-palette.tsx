"use client";

import * as React from "react";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandList,
} from "@/components/ui/command";

// F241 (AS-459, AS-463, AS-464): the global command palette shell —
// mounted ONCE in the workspace layout (see that file's own comment on why
// a single always-present instance beats one per page) so a single
// Cmd+K/Ctrl+K listener owns the shortcut rather than several palettes
// fighting over the same keydown.
//
// This feature intentionally owns ONLY the shell: the open/close
// lifecycle, the global shortcut, and the keyboard/focus contract
// (AS-463, AS-464). It renders an empty `CommandList` with a placeholder
// `CommandEmpty` state so the dialog is a complete, testable surface on
// its own; a sibling feature wires in real search results (F242,
// AS-460/461/466) and quick actions + recents (F243, AS-462/465) by
// rendering additional `CommandGroup`/`CommandItem` children inside the
// same `CommandList` — no changes to this file's shortcut/open-state logic
// should be needed for either of those to land.
export function CommandPalette() {
  const [open, setOpen] = React.useState(false);

  // AS-459: Cmd+K (Mac) / Ctrl+K (Windows/Linux) opens the palette from
  // anywhere in the app. AS-464: it must NOT open from an unrelated
  // keystroke while the user is typing in a text field/textarea/
  // contenteditable region — only this explicit chord opens it, even when
  // focus is inside a text input (browsers deliver "k" keydowns from a
  // focused <input> too, so we don't early-return on focused-element
  // checks the way a generic "ignore hotkeys while typing" guard would;
  // we only special-case the modifier chord itself).
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // event.repeat: ignore key-repeat while the chord is held down so
      // holding Cmd+K doesn't toggle the palette open/closed rapidly.
      if (event.repeat) return;

      const isModifierK =
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "k";

      if (!isModifierK) return;

      event.preventDefault();
      setOpen((current) => !current);
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command palette"
      description="Search or run a command"
    >
      <Command>
        <CommandInput placeholder="Type a command or search..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
