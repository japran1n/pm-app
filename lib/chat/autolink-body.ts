// F120 (AS-071): server-side bare-URL autolinker for chat message bodies.
//
// Root cause (confirmed against node_modules/@tiptap/extension-link@3.30.2
// dist/index.cjs's `autolink()` plugin): Tiptap's own client-side autolink
// only fires from a `appendTransaction` hook that requires the CHANGED
// range's trailing text to already be whitespace ("textBeforeWhitespace" /
// `UNICODE_WHITESPACE_REGEX_END.test(endText)` — see that file). A bare URL
// that is typed/pasted and then sent immediately (Enter, no trailing space)
// never satisfies that condition, so the composer's own editor state can
// carry a perfectly normal-looking but entirely unmarked URL. Once a `link`
// mark IS present, rendering already works correctly — components/chat/
// message-list.tsx's RichTextRenderer + rich-text-editor.tsx's
// ALLOWED_MARK_TYPES already allow and style `link` marks; this file exists
// only to guarantee that mark gets added at all, independent of whether the
// user happened to type a trailing space before hitting send.
//
// Applied server-side (lib/actions/chat-messages.ts's sendMessage/
// editMessage) rather than only client-side, so it also covers the
// composer's plain-`<textarea>` fallback path (before the rich editor
// module has lazy-loaded — see components/chat/message-composer.tsx's
// `useRichEditor` gate) and any other caller that hands sendMessage a
// plain-text doc built via lib/comments/rich-text.ts's `docFromPlainText`,
// which never carries any marks at all.
import type { JSONContent } from "@tiptap/react";

// http/https only, matching rich-text-editor.tsx's own
// ALLOWED_LINK_PROTOCOLS render-time allow-list — no bare `www.` heuristic
// (too many false positives on ordinary prose) and no `mailto:` autodetect
// (no reliable bare-text heuristic for an email address without a scheme).
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"')\]]+/gi;

/** Strips common trailing punctuation a URL picked up from being at the
 * end of a sentence ("check https://example.com." or "(https://x.com)")
 * off the linkified portion, so the period/closing paren renders as
 * ordinary text after the link rather than being swallowed into the href. */
function splitTrailingPunctuation(raw: string): { url: string; trail: string } {
  const match = raw.match(/^(.*[^.,!?:;)\]'"])([.,!?:;)\]'"]*)$/);
  if (!match) return { url: raw, trail: "" };
  return { url: match[1] ?? raw, trail: match[2] ?? "" };
}

/** A link mark only counts as "already linked" when it carries a usable
 * href (a non-empty string). F122: the client can emit `{"type":"link"}`
 * with no `attrs`/`href` at all (see autolinkBody's own doc comment
 * below); treating that href-less mark as already-linked was the bug —
 * it made this function skip exactly the nodes that most needed fixing,
 * leaving a mark with no destination for the renderer's sanitiser to
 * correctly strip. */
function hasUsableLinkHref(mark: { type?: unknown; attrs?: Record<string, unknown> }): boolean {
  const href = mark.attrs?.href;
  return typeof href === "string" && href.trim().length > 0;
}

function autolinkTextNode(node: JSONContent): JSONContent[] {
  if (node.type !== "text" || typeof node.text !== "string") return [node];
  // Already explicitly marked with a real destination (the toolbar's
  // manual Link button, or a previous pass of this same function) —
  // never re-wrap already-linked text. A link mark with no usable href
  // does NOT count as already-linked; fall through so it gets linkified
  // normally below.
  const existingLinkMark = node.marks?.find((m) => m.type === "link");
  if (existingLinkMark && hasUsableLinkHref(existingLinkMark)) return [node];

  // Strip a href-less link mark (if any) before matching/rewrapping, so
  // we repair the existing mark in place rather than ever ending up with
  // two link marks on one node.
  const baseMarks = existingLinkMark
    ? node.marks?.filter((m) => m !== existingLinkMark)
    : node.marks;

  const text = node.text;
  const matches = Array.from(text.matchAll(URL_PATTERN));
  // No URL found: if this node had a href-less link mark, still strip it
  // (there is nothing to linkify, and a mark with no destination must
  // never survive to the renderer's sanitiser).
  if (matches.length === 0) {
    return existingLinkMark ? [{ ...node, marks: baseMarks }] : [node];
  }

  const parts: JSONContent[] = [];
  let cursor = 0;
  for (const match of matches) {
    const start = match.index ?? 0;
    const raw = match[0];
    const { url, trail } = splitTrailingPunctuation(raw);
    if (!url) continue;
    if (start > cursor) {
      parts.push({ ...node, marks: baseMarks, text: text.slice(cursor, start) });
    }
    parts.push({
      ...node,
      text: url,
      marks: [...(baseMarks ?? []), { type: "link", attrs: { href: url } }],
    });
    if (trail) {
      parts.push({ ...node, marks: baseMarks, text: trail });
    }
    cursor = start + raw.length;
  }
  if (cursor < text.length) {
    parts.push({ ...node, marks: baseMarks, text: text.slice(cursor) });
  }
  return parts.length > 0 ? parts : [existingLinkMark ? { ...node, marks: baseMarks } : node];
}

function autolinkNode(node: JSONContent): JSONContent {
  if (Array.isArray(node.content)) {
    const content = node.content.flatMap((child) =>
      child.type === "text" ? autolinkTextNode(child) : [autolinkNode(child)],
    );
    return { ...node, content };
  }
  return node;
}

/** Marks every bare `http(s)://` URL found in `content`'s text runs with a
 * `link` mark. Idempotent (a URL that already carries a link mark is left
 * untouched) and non-destructive to any other node/mark. */
export function autolinkBody(content: JSONContent): JSONContent {
  if (!content || typeof content !== "object") return content;
  return autolinkNode(content);
}
