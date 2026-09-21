"use client";

import { useSyncExternalStore } from "react";

import { isMacPlatform, quickNoteShortcutLabel } from "@/lib/personal-todos/quick-note-shortcut";

const noopSubscribe = () => () => {};

export function useIsMacPlatform(): boolean | null {
  return useSyncExternalStore(noopSubscribe, isMacPlatform, () => null);
}

export function QuickNoteShortcutHint({ className }: { className?: string }) {
  const isMac = useIsMacPlatform();
  if (isMac === null) return null;
  return (
    <kbd
      title="Quick note"
      className={
        "rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground " +
        (className ?? "")
      }
    >
      {quickNoteShortcutLabel(isMac)}
    </kbd>
  );
}
