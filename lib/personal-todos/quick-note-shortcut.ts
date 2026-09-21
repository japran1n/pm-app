// Quick-note capture shortcut: Ctrl+Shift+N on Mac (Cmd+Shift+N is the
// browser's incognito window), Alt+Shift+N on Windows/Linux (Ctrl+Shift+N
// is Chrome's incognito window there).

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? nav.platform ?? nav.userAgent;
  return /mac|iphone|ipad|ipod/i.test(platform);
}

export function isQuickNoteShortcut(e: KeyboardEvent, isMac: boolean): boolean {
  const isN = e.code === "KeyN" || e.key === "n" || e.key === "N";
  if (!isN || !e.shiftKey || e.metaKey) return false;
  return isMac ? e.ctrlKey && !e.altKey : e.altKey && !e.ctrlKey;
}

export function quickNoteShortcutLabel(isMac: boolean): string {
  return isMac ? "⌃⇧N" : "Alt+Shift+N";
}

/** Splits pasted/typed text into one trimmed, non-empty title per line. */
export function splitQuickNoteLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
