// F172: paste-time HTML degradation for the shared Tiptap editor
// (components/editor/rich-text-editor.tsx).
//
// This module is deliberately pure DOM-string-in/DOM-string-out logic with
// no dependency on `@tiptap/react` or a mounted editor instance, so AS-308
// ("pasted formatting is preserved where supported and dropped where not")
// can be verified with a plain unit test against representative HTML
// fragments (Word/Google Docs/browser clipboard exports all serialise to
// HTML on the clipboard) rather than requiring a real browser paste event.
//
// Two-layer relationship with F171's `sanitiseDocument` allow-list
// (components/editor/rich-text-editor.tsx): `sanitiseDocument` is the
// final, load-bearing security boundary for ANY JSONContent this app ever
// renders (typed, pasted, or loaded from storage) — it is not bypassed or
// duplicated here. `transformPastedHtml` below runs *earlier*, at paste
// time, purely so that ProseMirror's own HTML->schema parser (which,
// unassisted, would either drop an unrecognised element's text entirely in
// some browsers' clipboard markup, e.g. deeply nested Word/Google Docs
// wrapper spans, or in others silently keep unwanted structure) is fed
// markup that already matches the allow-listed tag set. The words a user
// pasted must always survive; only the *styling* for anything off the
// allow-list is dropped.

/** Tags that map 1:1 (or via a normalising alias) onto a node/mark already
 * on the shared allow-list in `rich-text-editor.tsx`
 * (ALLOWED_NODE_TYPES / ALLOWED_MARK_TYPES). Kept in sync manually since
 * this operates on HTML tag names, not Tiptap JSON node/mark type names. */
const INLINE_TAG_ALIASES: Record<string, string> = {
  b: "strong",
  strong: "strong",
  i: "em",
  em: "em",
  code: "code",
  a: "a",
};

const BLOCK_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "br",
  "hr",
]);

/** Elements whose entire subtree (including text) must never survive —
 * these never carry user-authored words, only executable/style payload. */
const DROP_ENTIRELY_TAGS = new Set([
  "script",
  "style",
  "head",
  "title",
  "meta",
  "link",
]);

const ALLOWED_LINK_PROTOCOLS = /^(https?|mailto):/i;

function sanitiseHref(href: string | null): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  const normalised = trimmed.replace(/[ -\s]/g, "");
  if (!ALLOWED_LINK_PROTOCOLS.test(normalised)) return null;
  return trimmed;
}

function escapeText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function walk(node: ChildNode, out: string[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    if (text) out.push(escapeText(text));
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  if (DROP_ENTIRELY_TAGS.has(tag)) return;

  // Images carry no allow-listed text node of their own — an alt
  // attribute is the only "words" an <img> can be said to hold, so that
  // (and only that) survives; the image itself never does.
  if (tag === "img") {
    const alt = el.getAttribute("alt");
    if (alt) out.push(escapeText(alt));
    return;
  }

  const isBlockAllowed = BLOCK_TAGS.has(tag);
  const isInlineAllowed = tag in INLINE_TAG_ALIASES;

  if (isBlockAllowed || isInlineAllowed) {
    const mappedTag = isInlineAllowed ? INLINE_TAG_ALIASES[tag] : tag;
    // Void elements: emit as-is, no children/closing tag.
    if (mappedTag === "br" || mappedTag === "hr") {
      out.push(`<${mappedTag}>`);
      return;
    }
    let openTag = `<${mappedTag}`;
    if (mappedTag === "a") {
      const href = sanitiseHref(el.getAttribute("href"));
      // No safe href survives -> degrade the anchor to plain inline text
      // (its children still render), matching the "words survive, styling
      // doesn't" rule instead of emitting a dangling/empty link.
      if (!href) {
        el.childNodes.forEach((child) => walk(child, out));
        return;
      }
      openTag += ` href="${href}"`;
    }
    openTag += ">";
    out.push(openTag);
    el.childNodes.forEach((child) => walk(child, out));
    out.push(`</${mappedTag}>`);
    return;
  }

  // Unsupported element (table/tr/td, div/span wrappers, images-in-figure,
  // font/style-carrying spans from Word/Google Docs, etc.): the element
  // itself has no counterpart in the allow-listed schema, but its text
  // content is NOT part of the discarded styling — it degrades to plain
  // text by unwrapping the element and keeping its children. A trailing
  // space is appended so cells/rows that used to be visually separated
  // (e.g. table cells) don't get jammed into one run-on word.
  const before = out.length;
  el.childNodes.forEach((child) => walk(child, out));
  if (out.length > before) out.push(" ");
}

/**
 * Transforms clipboard HTML (as ProseMirror hands it to
 * `editorProps.transformPastedHTML`) so that only markup already on the
 * shared render/edit allow-list (see `ALLOWED_NODE_TYPES` /
 * `ALLOWED_MARK_TYPES` in `components/editor/rich-text-editor.tsx`)
 * survives as formatting. Anything else degrades to its plain text content
 * — never silently dropped, only its styling is.
 */
export function transformPastedHtml(html: string): string {
  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    // No DOM available (e.g. non-browser SSR context) — fail safe by
    // handing the HTML through unchanged; ProseMirror's own parser (or,
    // ultimately, `sanitiseDocument`) still stands as the security
    // boundary further down the pipeline.
    return html;
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out: string[] = [];
  doc.body.childNodes.forEach((child) => walk(child, out));
  return out.join("");
}
