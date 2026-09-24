// Open Graph / <title> extraction for chat link previews. Kept out of the
// "use server" module so it can be unit-tested directly (a "use server" file
// may only export async functions).
//
// Linear by construction: input is cut at `</head>` or MAX_PARSE_CHARS
// before node-html-parser sees it, and there are no hand-written regexes
// over attacker HTML. The previous `<meta[^>]+…[^>]*content=…` patterns
// backtracked quadratically on unterminated tags (seconds per property on a
// 128KB page).

import { parse } from "node-html-parser";

export const MAX_PARSE_CHARS = 64 * 1024;

const MAX_TITLE = 300;
const MAX_DESCRIPTION = 500;
const MAX_SITE_NAME = 120;
const MAX_URL = 2048;

export type ParsedLinkPreview = {
  title: string;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
};

/** Index just past `</head`, searched case-insensitively, or -1. */
export function headEndIndex(html: string, from = 0): number {
  const i = html.slice(from).toLowerCase().indexOf("</head");
  return i === -1 ? -1 : from + i + "</head".length;
}

export function truncateToHead(html: string): string {
  const capped = html.length > MAX_PARSE_CHARS ? html.slice(0, MAX_PARSE_CHARS) : html;
  const end = headEndIndex(capped);
  return end === -1 ? capped : capped.slice(0, end) + ">";
}

function clean(value: string | undefined | null, max: number): string | null {
  if (!value) return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > max ? text.slice(0, max) : text;
}

function safeHttpUrl(value: string | null, base: URL): string | null {
  if (!value || value.length > MAX_URL) return null;
  try {
    const url = new URL(value, base);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function extractLinkPreviewMeta(html: string, pageUrl: URL): ParsedLinkPreview | null {
  const root = parse(truncateToHead(html), {
    comment: false,
    blockTextElements: { script: false, noscript: false, style: false },
  });

  const meta = new Map<string, string>();
  for (const el of root.querySelectorAll("meta")) {
    const key = (el.getAttribute("property") ?? el.getAttribute("name"))?.trim().toLowerCase();
    const content = el.getAttribute("content");
    if (key && content !== undefined && !meta.has(key)) meta.set(key, content);
  }

  const title =
    clean(meta.get("og:title"), MAX_TITLE) ??
    clean(meta.get("twitter:title"), MAX_TITLE) ??
    clean(root.querySelector("title")?.text, MAX_TITLE);
  if (!title) return null;

  return {
    title,
    description:
      clean(meta.get("og:description"), MAX_DESCRIPTION) ??
      clean(meta.get("twitter:description"), MAX_DESCRIPTION),
    imageUrl: safeHttpUrl(
      clean(meta.get("og:image"), MAX_URL) ?? clean(meta.get("twitter:image"), MAX_URL),
      pageUrl,
    ),
    siteName: clean(meta.get("og:site_name"), MAX_SITE_NAME),
  };
}
