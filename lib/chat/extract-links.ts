// F120 (AS-072): finds link-marked URLs inside a message's Tiptap
// `body_json`, for the "fetch an OG preview for the message's link" flow.
// Deliberately reads off `link` marks (not a fresh regex scan of the raw
// text) so this only ever sees URLs that are ACTUALLY going to render as
// clickable per AS-071 -- i.e. it runs after lib/chat/autolink-body.ts's
// server-side pass has already turned every bare URL into a real mark, so
// there is exactly one source of truth for "what counts as a link in this
// message" shared by the anchor-rendering path and the preview-card path.
import type { JSONContent } from "@tiptap/react";

function collectLinkHrefs(node: JSONContent, out: string[]): void {
  if (Array.isArray(node.marks)) {
    for (const mark of node.marks) {
      if (mark.type === "link" && typeof mark.attrs?.href === "string") {
        out.push(mark.attrs.href);
      }
    }
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      collectLinkHrefs(child, out);
    }
  }
}

/** Returns every link-marked URL in a message body, in document order. */
export function extractLinkHrefs(content: JSONContent | null | undefined): string[] {
  if (!content || typeof content !== "object") return [];
  const out: string[] = [];
  collectLinkHrefs(content, out);
  return out;
}

/** The single URL a message's preview card (if any) should be fetched for
 * -- AS-072 only asks for "a preview card" (singular) per message, so this
 * picks the first link-marked URL and ignores any others in the same
 * message, same "first wins" convention chat clients typically use for
 * unfurls. `mailto:` links are excluded -- there is nothing to unfurl. */
export function firstPreviewableUrl(content: JSONContent | null | undefined): string | null {
  const hrefs = extractLinkHrefs(content);
  return hrefs.find((href) => /^https?:\/\//i.test(href)) ?? null;
}
