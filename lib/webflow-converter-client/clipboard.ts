"use client";

export function writeToClipboard(
  items: { mimeType: string; data: string }[]
): boolean {
  if (items.length === 0) return false;

  let fired = false;
  let threw = false;

  const handler = (e: ClipboardEvent) => {
    fired = true;
    if (!e.clipboardData) {
      threw = true;
      return;
    }
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

  let result = false;
  try {
    // execCommand is deprecated but is the only cross-browser way to write
    // application/json MIME type to the clipboard — the async Clipboard API
    // refuses non-standard MIME types
    result = document.execCommand("copy");
  } catch {
    threw = true;
    result = false;
  } finally {
    document.removeEventListener("copy", handler);
  }

  return result && fired && !threw;
}
