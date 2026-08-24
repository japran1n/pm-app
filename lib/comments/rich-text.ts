// F174 (AS-312): plain-text <-> Tiptap-JSONContent helpers shared by the
// comment composer (client) and lib/actions/comments.ts (server).
//
// Deliberately does NOT import components/editor/rich-text-editor.tsx (a
// "use client" module that pulls in @tiptap/react's useEditor/DOM-touching
// code) — a Server Action importing that module would drag client-only
// code into the server bundle. This file only needs the plain JSONContent
// *data shape*, not the editor/renderer components, so it imports the type
// only (erased at compile time) and re-implements the same tiny
// single-paragraph wrap shape F170's SQL helper
// `public.tiptap_doc_from_text` already defines — kept in sync with that
// function's shape deliberately (see supabase/migrations/
// 20260822100000_comment_body_json.sql's backfill, which calls the SQL
// version of this exact same wrap for existing rows).
//
// Security note: this module does NOT sanitise (strip disallowed
// node/mark types or unsafe link hrefs) — that allow-list is owned by
// components/editor/rich-text-editor.tsx's sanitiseDocument, and is
// re-applied on every render by RichTextRenderer regardless of what was
// persisted, per that file's own doc comment ("never rendered as raw
// HTML, never trusted just because it came from our own database"). This
// keeps there being exactly one place the security-relevant allow-list is
// defined, rather than a second, possibly-drifting copy in a
// server-importable module.

import type { JSONContent } from "@tiptap/react";

/** Wraps plain text into the canonical empty/single-paragraph Tiptap doc
 * shape. Mirrors `public.tiptap_doc_from_text` in
 * supabase/migrations/20260822090000_task_description_json.sql exactly:
 * empty/whitespace text -> `{ type: "doc", content: [] }`; non-empty text
 * -> a single paragraph containing a single text node. */
export function docFromPlainText(text: string): JSONContent {
  if (!text) {
    return { type: "doc", content: [] };
  }
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text }],
      },
    ],
  };
}

/** Extracts the plain-text projection of a Tiptap JSONContent document —
 * every text node's `.text`, concatenated within a block and joined
 * across top-level blocks with a blank line. Used both for the legacy
 * `comments.text` / `body_text` columns (defense-in-depth server-side
 * recomputation, never trusts a client-supplied plain-text value alone)
 * and for the composer's submit-button-enabled / empty-comment check.
 *
 * F308 (FU-12 item 3, AS-373): a `mention` node (F203's
 * mention-extension.ts — id-only attrs, `{ id: string }`, deliberately no
 * stored label to avoid a stale display name) now also contributes text
 * here, so a comment consisting ONLY of a mention (e.g. "@Alice", no
 * other words) projects to non-empty plain text instead of "" — before
 * this fix, such a comment silently disabled the composer's Post button
 * (the same empty-comment guard `comments_text_not_empty` enforces
 * server-side) even though it's a perfectly valid comment. `resolveLabel`
 * lets a caller that has live member data (comment-list.tsx's
 * `mentionSuggestions`) project the mention's real current display name;
 * omitted (e.g. this module's other caller, lib/actions/comments.ts's
 * server-side recompute, which has no member list in scope at that call
 * site) falls back to "@<id>" — still guaranteed non-empty, which is the
 * only thing that call site's fallback-to-client-text logic actually
 * depends on. */
/** F261 (AS-508): appends a plain-text reference paragraph — e.g.
 * "📎 pasted-image.png" — to the end of a comment draft after an image
 * pasted from the clipboard has finished uploading as a real `attachments`
 * row (via lib/actions/attachments.ts's uploadAttachment, the exact same
 * action the drag-drop/file-picker paths use, per F258/F259/F260). This
 * deliberately does NOT insert an `<img>` node: F171's shared allow-list
 * (ALLOWED_NODE_TYPES in components/editor/rich-text-editor.tsx) has no
 * `image` entry, and extending it to allow inline images would create a
 * second sanitisation surface across editor/renderer/server projection —
 * the clarified spec's own "simpler option, no new dependency, no second
 * source of truth" resolution rule picks this plain-text-reference shape
 * instead. The uploaded image is already visible in the task's attachment
 * list (same as any dropped/picked file), so the comment body only needs
 * to note that a file was attached, not re-render it. */
export function appendAttachmentReference(
  content: JSONContent | null | undefined,
  fileName: string,
): JSONContent {
  const base: JSONContent =
    content && typeof content === "object" ? content : { type: "doc", content: [] };
  const existing = Array.isArray(base.content) ? base.content : [];
  return {
    ...base,
    type: "doc",
    content: [
      ...existing,
      {
        type: "paragraph",
        content: [{ type: "text", text: `📎 ${fileName}` }],
      },
    ],
  };
}

export function extractPlainText(
  content: JSONContent | null | undefined,
  resolveLabel?: (userId: string) => string | null,
): string {
  if (!content || typeof content !== "object") return "";

  function collect(node: JSONContent): string {
    if (!node || typeof node !== "object") return "";
    if (node.type === "text") {
      return typeof node.text === "string" ? node.text : "";
    }
    if (node.type === "mention") {
      const id =
        typeof node.attrs?.id === "string" ? (node.attrs.id as string) : null;
      if (!id) return "";
      const label = resolveLabel?.(id) ?? id;
      return `@${label}`;
    }
    if (Array.isArray(node.content)) {
      return node.content.map(collect).join("");
    }
    return "";
  }

  const topLevel = Array.isArray(content.content) ? content.content : [];
  return topLevel
    .map(collect)
    .join("\n\n")
    .trim();
}
