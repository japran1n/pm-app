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
    // Read back what was written -- some browsers (WebKit) silently sanitise
    // non-standard MIME types like application/json: setData "succeeds" but
    // nothing is actually written. Catch that silent rejection here.
    if (!threw) {
      for (const item of items) {
        const written = e.clipboardData!.getData(item.mimeType);
        if (!written) {
          threw = true;
          break;
        }
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
