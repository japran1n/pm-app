"use client";

export function writeToClipboard(
  items: { mimeType: string; data: string }[]
): boolean {
  const handler = (e: ClipboardEvent) => {
    e.preventDefault();
    for (const { mimeType, data } of items) {
      e.clipboardData?.setData(mimeType, data);
    }
  };
  document.addEventListener("copy", handler, { once: true });
  const success = document.execCommand("copy");
  if (!success) document.removeEventListener("copy", handler);
  return success;
}
