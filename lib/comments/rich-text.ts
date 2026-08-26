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

/**
 * F339 (M18 scrutiny BLOCKER-4, addComment 500ing on any comment containing
 * a real mention node): returns a structurally-independent deep clone of a
 * Tiptap JSONContent document, built from nothing but plain
 * strings/numbers/booleans/arrays/objects.
 *
 * Root cause (confirmed by live repro against the real dev server + a real
 * "Post" click, not just static reading): ProseMirror interns/structurally
 * shares `node.attrs` objects across a live document — a mention node's
 * `{ id, label, mentionSuggestionChar }` attrs object, as returned by
 * `editor.getJSON()`, can be the SAME object reference the live editor
 * instance's own document/decoration state is still holding onto at the
 * moment the comment composer calls this Server Action. React's Flight
 * client-argument encoder for Server Actions does not always plainly clone
 * a shared/reused object reference like that — it can instead encode it as
 * an opaque "temporary reference" (React's mechanism for round-tripping
 * live, non-serialisable values like functions/refs through a Server
 * Action call). On the server, a temporary reference throws "Cannot access
 * <prop> on the server. You cannot dot into a temporary client reference
 * from a server component" the moment ANY property (e.g. `.attrs.id`) is
 * read on it — exactly the crash this feature fixes, reproduced 3/3 by a
 * prior worker and confirmed again here by driving the real composer +
 * real "Post" button against a live dev server and capturing the exact
 * server-side stack trace (`collect` -> `extractPlainText` -> `addComment`,
 * throwing on `node.attrs?.id`).
 *
 * Deliberately NOT a change to how `resolveLabel`/labels are computed (the
 * server-side call sites in lib/actions/comments.ts never pass
 * `resolveLabel` and never needed to — that half of the scrutiny report's
 * hypothesis did not hold up under live reproduction). The actual fix is at
 * the client-to-server boundary itself: round-tripping the document through
 * `JSON.stringify`/`JSON.parse` immediately before the Server Action call
 * severs any lingering reference identity to the live ProseMirror document,
 * guaranteeing every value that crosses the wire is plain, freshly-allocated
 * JSON data with no possible temporary-reference encoding — confirmed live:
 * the exact same repro that reliably 500s with the raw `editor.getJSON()`
 * value succeeds (200, comment persisted, notification created) once the
 * composer sends `toPlainJson(draft)` instead of `draft`.
 */
export function toPlainJson<T>(value: T): T {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
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
