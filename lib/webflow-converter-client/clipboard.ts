"use client";

export function writeToClipboard(
  items: { mimeType: string; data: string }[]
): boolean {
  let fired = false;
  let threw = false;

  const handler = (e: ClipboardEvent) => {
    fired = true;
    e.preventDefault();
    for (const { mimeType, data } of items) {
      try {
        e.clipboardData?.setData(mimeType, data);
      } catch {
        threw = true;
        break;
      }
    }
  };
  document.addEventListener("copy", handler, { once: true });

  let result: boolean;
  try {
    // execCommand is deprecated but is the only cross-browser way to write
    // application/json MIME type to the clipboard — the async Clipboard API
    // refuses non-standard MIME types
    result = document.execCommand("copy");
  } finally {
    document.removeEventListener("copy", handler);
  }

  return result && fired && !threw;
}
