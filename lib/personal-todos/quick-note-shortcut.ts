// Quick-note capture shortcut: Alt/Option+Shift+N on every platform.
// Cmd+Shift+N and Ctrl+Shift+N both open incognito windows in browsers, so
// neither is usable. Matched on e.code because Option on Mac changes e.key.

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? nav.platform ?? nav.userAgent;
  return /mac|iphone|ipad|ipod/i.test(platform);
}

export function isQuickNoteShortcut(e: KeyboardEvent): boolean {
  return e.code === "KeyN" && e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey;
}

export function quickNoteShortcutLabel(isMac: boolean): string {
  return isMac ? "⌥⇧N" : "Alt+Shift+N";
}

/** Splits pasted/typed text into one trimmed, non-empty title per line. */
export function splitQuickNoteLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
