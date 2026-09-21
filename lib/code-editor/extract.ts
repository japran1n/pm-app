/** Where a block lives in the published page: `<head>` custom code, an
 * Embed element (`.w-embed` / code component / rich-text embed) in the
 * body, or body-level custom code before `</body>` ("Footer"). */
export type BlockOrigin = 'head' | 'embed' | 'footer';

export const ORIGIN_LABELS: Record<BlockOrigin, string> = {
  head: 'Head',
  embed: 'Embed',
  footer: 'Footer',
};

/** Provenance fields shared by style and script blocks. All optional for
 * backwards compatibility with older persisted / hand-built blocks. */
interface BlockProvenance {
  /** Where the block was found (see BlockOrigin). */
  origin?: BlockOrigin;
  /** Raw `originalContent` of every *other* tag this block stands in for
   * after `deduplicateBlocks` collapsed repeated (e.g. CMS-item) embeds.
   * composeDocument applies an edit to all of them. */
  duplicates?: string[];
  /** Total number of tags this block represents (1 + duplicates.length). */
  occurrences?: number;
}

export interface StyleBlock extends BlockProvenance {
  index: number; // 0-based position in document
  type: 'style';
  originalContent: string; // content as found in HTML (concatenated for grouped blocks)
  content: string; // same as originalContent initially (edited by user later)
  name?: string; // filled by name heuristic (F033)
  hasCdata?: boolean; // true when originalContent was wrapped in <![CDATA[ ... ]]> (F036 round-trip)
  /** For grouped blocks: the original per-tag contents in document order.
   * compose.ts uses these to locate and replace/delete the individual tags.
   * Absent on single-tag blocks and on old persisted data (treated as single-tag). */
  segments?: string[];
}

const STYLE_TAG_RE = /<style([^>]*)>([\s\S]*?)<\/style>/gi;
const SRC_ATTR_RE = /\bsrc\s*=/i;
const NONCE_ATTR_RE = /\bnonce\s*=/i;
const CDATA_WRAPPER_RE = /^\s*(?:\/\/\s*)?<!\[CDATA\[([\s\S]*?)(?:\/\/\s*)?\]\]>\s*$/;
// Distinguishes the JS-comment CDATA form (`// <![CDATA[ ... // ]]>`, used
// inside <script> so the markers don't break JS parsing) from the bare XML
// form (`<![CDATA[ ... ]]>`) so compose.ts can restore the exact original
// form on round-trip (F036 follow-up).
const CDATA_COMMENT_WRAPPER_RE = /^\s*\/\/\s*<!\[CDATA\[[\s\S]*?\/\/\s*\]\]>\s*$/;

/**
 * Strips a `<![CDATA[ ... ]]>` wrapper (with or without the `//` JS-comment
 * style markers sometimes used inside `<script>`) around block content, so
 * downstream name-derivation and editing see the real code/CSS, not the
 * XML escaping wrapper (F036).
 */
export function stripCdata(content: string): string {
  const match = (content ?? '').match(CDATA_WRAPPER_RE);
  if (match) {
    return match[1];
  }
  return content;
}

export interface ScriptBlock extends BlockProvenance {
  index: number; // 0-based position in document (among script blocks)
  type: 'script';
  originalContent: string; // content as found in HTML (concatenated for grouped blocks)
  content: string; // same as originalContent initially (edited by user later)
  name?: string; // filled by name heuristic (F033)
  hasCdata?: boolean; // true when originalContent was wrapped in <![CDATA[ ... ]]> (F036 round-trip)
  /** Which CDATA wrapper form was used in the source, when hasCdata is true:
   * 'bare' for `<![CDATA[...]]>`, 'comment' for the JS-comment form
   * `// <![CDATA[\n...\n// ]]>`. Only meaningful for script blocks -- style
   * blocks never use the comment form (CSS has no `//` line comments), so
   * StyleBlock omits this field. Lets compose.ts restore the exact original
   * form instead of always emitting the bare form (F036 follow-up fix). */
  cdataStyle?: 'bare' | 'comment';
  /** For grouped blocks: the original per-tag contents in document order.
   * compose.ts uses these to locate and replace/delete the individual tags.
   * Absent on single-tag blocks and on old persisted data (treated as single-tag). */
  segments?: string[];
}

const SCRIPT_TAG_RE = /<script([^>]*)>([\s\S]*?)<\/script>/gi;

const MAX_NAME_LENGTH = 60;
const MAX_COMMENT_TITLE_LENGTH = 40;
const DECLARATION_RE = /\b(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/;
// First class or ID selector in a selector position (followed by a `{`
// before any `;`/`}` -- so hex colours and ids inside values never match).
const CSS_CLASS_OR_ID_RE = /(?:^|[\s,>+~{}(])[.#](-?[A-Za-z_][\w-]*)(?=[^{};]*\{)/;
// data-* attribute used inside a selector string literal in JS.
const JS_DATA_ATTR_RE = /['"`][^'"`\n]*\[\s*(data-[\w-]+)[^'"`\n]*['"`]/;
const JS_SELECTOR_LITERAL_RE =
  /(?:querySelector(?:All)?|getElementById|getElementsByClassName|\$)\(\s*['"`]\s*([.#]?)(-?[A-Za-z_][\w-]*)/;

function truncateName(name: string): string {
  if (name.length <= MAX_NAME_LENGTH) {
    return name;
  }
  return name.slice(0, MAX_NAME_LENGTH);
}

/** Makes `raw` safe to use as a file name: keeps letters, digits, `_`, `-`
 * and `.`, turns whitespace/other runs into single dashes, and trims stray
 * dashes/dots at the ends. Case is preserved. */
export function sanitizeFileName(raw: string): string {
  return (raw ?? '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
}

/** Turns a leading comment into a short title, or null when it is not a
 * usable title: decorative separator runs (`=====`, `-----`, `*****`) are
 * stripped, and anything longer than 40 chars or not alphanumeric-ish is
 * rejected. */
function commentTitle(raw: string): string | null {
  const text = (raw ?? '')
    .replace(/[=\-*#~_/]{3,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || text.length > MAX_COMMENT_TITLE_LENGTH) return null;
  if (!/^[\w\s.\-:()&/']+$/.test(text)) return null;
  const safe = sanitizeFileName(text);
  return safe || null;
}

function withExt(name: string, ext: '.css' | '.js'): string {
  const base = truncateName(sanitizeFileName(name).replace(/\.(css|js)$/i, ''));
  return base ? `${base}${ext}` : '';
}

function stripJsComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

/**
 * Derives a file name for a CSS style block, moden-style: `<name>.css`.
 *
 * 1. A short (<= 40 chars) title-like leading comment. Separator comments
 *    such as `/* ===== *\/` are ignored.
 * 2. The first class or ID selector, without its `.`/`#`
 *    (`.hero_stats-list {` -> `hero_stats-list.css`).
 * 3. Otherwise (element-only selectors such as `html`/`body`)
 *    `style-${index + 1}.css`.
 */
export function deriveCssName(content: string, index: number): string {
  const src = content ?? '';
  const trimmed = src.replace(/^\s+/, '');

  const commentMatch = trimmed.match(/^\/\*([\s\S]*?)\*\//);
  if (commentMatch) {
    const title = commentTitle(commentMatch[1]);
    if (title) return withExt(title, '.css');
  }

  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const selectorMatch = code.match(CSS_CLASS_OR_ID_RE);
  if (selectorMatch) {
    const name = withExt(selectorMatch[1], '.css');
    if (name) return name;
  }

  return `style-${index + 1}.css`;
}

/**
 * Derives a file name for a JS script block, moden-style: `<name>.js`.
 *
 * 1. A short (<= 40 chars) title-like leading `//` or block comment.
 *    Separator comments are ignored.
 * 2. A `data-*` attribute used in a selector string literal
 *    (`'[data-category-cursor]'` -> `data-category-cursor.js`).
 * 3. The first declared const/let/var/function/class name.
 * 4. A class/ID passed to querySelector/getElementById/etc.
 * 5. Otherwise `script-${index + 1}.js`.
 */
export function deriveJsName(content: string, index: number): string {
  const src = content ?? '';
  const trimmed = src.replace(/^\s+/, '');

  const lineComment = trimmed.match(/^\/\/(.*)/);
  const blockComment = trimmed.match(/^\/\*([\s\S]*?)\*\//);
  const rawComment = lineComment?.[1] ?? blockComment?.[1];
  if (rawComment !== undefined) {
    const title = commentTitle(rawComment);
    if (title) return withExt(title, '.js');
  }

  const code = stripJsComments(src);

  const dataAttr = code.match(JS_DATA_ATTR_RE);
  if (dataAttr) {
    const name = withExt(dataAttr[1], '.js');
    if (name) return name;
  }

  const declMatch = code.match(DECLARATION_RE);
  if (declMatch) {
    const name = withExt(declMatch[1], '.js');
    if (name) return name;
  }

  const selector = code.match(JS_SELECTOR_LITERAL_RE);
  if (selector) {
    const name = withExt(selector[2], '.js');
    if (name) return name;
  }

  return `script-${index + 1}.js`;
}

/**
 * Normalized signature used to collapse repeated embeds (e.g. one Embed
 * per CMS item). Per-item variance is erased: comments, string/template
 * literals (URLs, slugs, text), numbers, Webflow item IDs (24 hex chars),
 * hex colours, unquoted `url(...)` values, and all whitespace.
 */
export function blockSignature(content: string): string {
  return stripJsComments(content ?? '')
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, 'S')
    .replace(/url\(\s*[^)]*\)/gi, 'url()')
    .replace(/\b[0-9a-f]{24}\b/gi, 'ID')
    .replace(/#[0-9a-f]{3,8}\b/gi, '#H')
    .replace(/-?\b\d+(?:\.\d+)?/g, '0')
    .replace(/\s+/g, '');
}

export type DedupedBlock<T> = T & { duplicates?: string[]; occurrences?: number };

/**
 * Collapses repeated blocks into one. Blocks are grouped by `type` (when
 * present) and `blockSignature(originalContent)`, so byte-identical blocks
 * AND CMS-repeated embeds that differ only in bound values (strings,
 * numbers, URLs, item IDs, whitespace) become ONE block. The first
 * occurrence (in array order) is kept with its original `index`; the other
 * occurrences' raw contents are recorded on it as `duplicates` (so
 * composeDocument can apply an edit to all of them) and `occurrences`
 * holds the total count. Input blocks are not mutated.
 */
export function deduplicateBlocks<T extends { originalContent: string; index: number; type?: string }>(
  blocks: T[]
): DedupedBlock<T>[] {
  const byKey = new Map<string, DedupedBlock<T>>();
  const result: DedupedBlock<T>[] = [];

  for (const block of blocks) {
    const trimmed = (block.originalContent ?? '').trim();
    const sig = blockSignature(trimmed);
    // When almost nothing survives normalization (e.g. a lone string),
    // fall back to exact content so unrelated blocks never merge.
    const identity = sig.length > 3 ? `sig:${sig}` : `raw:${trimmed}`;
    const key = `${block.type ?? ''}|${identity}`;
    const kept = byKey.get(key);
    if (kept) {
      kept.duplicates = [...(kept.duplicates ?? []), block.originalContent];
      kept.occurrences = (kept.occurrences ?? 1) + 1;
      continue;
    }
    const copy: DedupedBlock<T> = { ...block };
    byKey.set(key, copy);
    result.push(copy);
  }

  return result;
}

const EMBED_OPEN_RE =
  /<([a-z][\w-]*)\b[^>]*\bclass\s*=\s*["'][^"']*\b(?:w-embed|w-code-component|w-richtext)\b[^"']*["'][^>]*>/gi;

/**
 * Classifies where a tag starting at `pos` sits in `html`:
 * - before `</head>` (or before `<body` when there is no `</head>`) -> head
 * - inside an element carrying `w-embed` / `w-code-component` /
 *   `w-richtext` -> embed
 * - any other body-level position -> footer (footer custom code)
 */
export function detectOrigin(html: string, pos: number): BlockOrigin {
  const lower = html.toLowerCase();
  const headClose = lower.indexOf('</head');
  const bodyOpen = lower.search(/<body[\s>]/);
  const headEnd = headClose >= 0 ? headClose : bodyOpen;
  if (headEnd >= 0 && pos < headEnd) return 'head';

  EMBED_OPEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let last: { tag: string; end: number } | null = null;
  while ((match = EMBED_OPEN_RE.exec(html)) !== null) {
    if (match.index >= pos) break;
    last = { tag: match[1].toLowerCase(), end: match.index + match[0].length };
  }
  if (last) {
    // Still inside that element? Count same-name opens/closes between its
    // opening tag and `pos`, ignoring the bodies of style/script tags.
    const between = html
      .slice(last.end, pos)
      .replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
    const opens = (between.match(new RegExp(`<${last.tag}\\b`, 'gi')) ?? []).length;
    const closes = (between.match(new RegExp(`</${last.tag}\\s*>`, 'gi')) ?? []).length;
    if (closes <= opens) return 'embed';
  }

  return 'footer';
}

/**
 * Like `detectOrigin` but returns a unique key per location group:
 * - `'head'` for head custom code
 * - `'embed:N'` for the Nth embed element (0-based, in document order)
 * - `'footer'` for body-level custom code outside any embed
 *
 * Used by `extractStyleBlocks`/`extractScriptBlocks` to group tags that
 * should be merged into a single editable block.
 */
export function detectLocationKey(html: string, pos: number): string {
  const origin = detectOrigin(html, pos);
  if (origin !== 'embed') return origin;

  // Walk embed openings in document order to find which one (by index) contains pos.
  EMBED_OPEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let embedIdx = 0;
  let lastContainingIdx = -1;

  while ((match = EMBED_OPEN_RE.exec(html)) !== null) {
    if (match.index >= pos) break;
    const tag = match[1].toLowerCase();
    const tagEnd = match.index + match[0].length;
    const between = html
      .slice(tagEnd, pos)
      .replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
    const opens = (between.match(new RegExp(`<${tag}\\b`, 'gi')) ?? []).length;
    const closes = (between.match(new RegExp(`</${tag}\\s*>`, 'gi')) ?? []).length;
    if (closes <= opens) {
      lastContainingIdx = embedIdx;
    }
    embedIdx += 1;
  }

  return lastContainingIdx >= 0 ? `embed:${lastContainingIdx}` : 'footer';
}

/**
 * Extracts all inline <style>...</style> blocks from an HTML document string
 * in document order. Pure string/regex implementation (no DOM, no jsdom/cheerio)
 * so it is safe to run in the Next.js edge runtime.
 *
 * Never throws: malformed/unclosed tags simply are not matched (the regex
 * requires a closing tag), and any unexpected error while scanning results in
 * returning whatever blocks were found up to that point.
 *
 * **Grouping:** instead of one block per `<style>` tag, the function produces
 * one block per *location group* — head, each embed element, and footer.
 * Multiple `<style>` tags in the same group are concatenated (joined with
 * `\n`) into a single editable block. The individual tag contents are
 * preserved in the `segments` field so compose.ts can split them back.
 * Empty groups are omitted.
 */
export function extractStyleBlocks(html: string): StyleBlock[] {
  if (!html || typeof html !== 'string') return [];

  // --- First pass: collect raw tags with their location keys ---
  interface RawStyleTag {
    locationKey: string;
    origin: BlockOrigin;
    rawContent: string; // original inner text (may have CDATA)
    hasCdata: boolean;
  }

  const rawTags: RawStyleTag[] = [];

  try {
    STYLE_TAG_RE.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = STYLE_TAG_RE.exec(html)) !== null) {
      const attrs = match[1] ?? '';
      const content = match[2] ?? '';

      if (SRC_ATTR_RE.test(attrs)) continue;

      rawTags.push({
        locationKey: detectLocationKey(html, match.index),
        origin: detectOrigin(html, match.index),
        rawContent: content,
        hasCdata: CDATA_WRAPPER_RE.test(content),
      });
    }
  } catch {
    return [];
  }

  // --- Second pass: group by locationKey, preserving first-seen order ---
  const groupOrder: string[] = [];
  const groupOrigin = new Map<string, BlockOrigin>();
  const groupTags = new Map<string, RawStyleTag[]>();

  for (const tag of rawTags) {
    if (!groupTags.has(tag.locationKey)) {
      groupOrder.push(tag.locationKey);
      groupOrigin.set(tag.locationKey, tag.origin);
      groupTags.set(tag.locationKey, []);
    }
    groupTags.get(tag.locationKey)!.push(tag);
  }

  // --- Third pass: build one StyleBlock per group ---
  const blocks: StyleBlock[] = [];

  for (let i = 0; i < groupOrder.length; i++) {
    const key = groupOrder[i];
    const tags = groupTags.get(key)!;
    const segments = tags.map((t) => t.rawContent);
    const stripped = segments.map((s) => stripCdata(s));
    const combinedContent = stripped.join('\n');

    if (!combinedContent.trim()) continue; // skip empty groups

    blocks.push({
      index: i,
      type: 'style',
      originalContent: combinedContent,
      content: combinedContent,
      name: deriveCssName(combinedContent, i),
      origin: groupOrigin.get(key),
      // hasCdata only makes sense for single-tag groups; multi-tag groups
      // are stored without wrapping so the user sees clean CSS.
      hasCdata: segments.length === 1 ? tags[0].hasCdata : false,
      // segments is omitted for single-tag groups (backwards-compatible with
      // old persisted data that doesn't have this field).
      ...(segments.length > 1 ? { segments } : {}),
    });
  }

  return blocks;
}

/**
 * Extracts all inline <script>...</script> blocks from an HTML document
 * string in document order. Excludes external scripts (<script src="...">)
 * and nonce-bearing scripts injected by the proxy (<script nonce="...">).
 * Pure string/regex implementation (no DOM, no jsdom/cheerio) so it is safe
 * to run in the Next.js edge runtime. Never throws.
 *
 * **Grouping:** same as `extractStyleBlocks` — one block per location group
 * (head, each embed element, footer). Multiple `<script>` tags in the same
 * group are concatenated into one block; originals are in `segments`.
 */
export function extractScriptBlocks(html: string): ScriptBlock[] {
  if (!html || typeof html !== 'string') return [];

  interface RawScriptTag {
    locationKey: string;
    origin: BlockOrigin;
    rawContent: string;
    hasCdata: boolean;
    cdataStyle: 'bare' | 'comment';
  }

  const rawTags: RawScriptTag[] = [];

  try {
    SCRIPT_TAG_RE.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = SCRIPT_TAG_RE.exec(html)) !== null) {
      const attrs = match[1] ?? '';
      const content = match[2] ?? '';

      if (SRC_ATTR_RE.test(attrs)) continue;
      if (NONCE_ATTR_RE.test(attrs)) continue;

      rawTags.push({
        locationKey: detectLocationKey(html, match.index),
        origin: detectOrigin(html, match.index),
        rawContent: content,
        hasCdata: CDATA_WRAPPER_RE.test(content),
        cdataStyle: CDATA_COMMENT_WRAPPER_RE.test(content) ? 'comment' : 'bare',
      });
    }
  } catch {
    return [];
  }

  const groupOrder: string[] = [];
  const groupOrigin = new Map<string, BlockOrigin>();
  const groupTags = new Map<string, RawScriptTag[]>();

  for (const tag of rawTags) {
    if (!groupTags.has(tag.locationKey)) {
      groupOrder.push(tag.locationKey);
      groupOrigin.set(tag.locationKey, tag.origin);
      groupTags.set(tag.locationKey, []);
    }
    groupTags.get(tag.locationKey)!.push(tag);
  }

  const blocks: ScriptBlock[] = [];

  for (let i = 0; i < groupOrder.length; i++) {
    const key = groupOrder[i];
    const tags = groupTags.get(key)!;
    const segments = tags.map((t) => t.rawContent);
    const stripped = segments.map((s) => stripCdata(s));
    const combinedContent = stripped.join('\n');

    if (!combinedContent.trim()) continue;

    const singleTag = segments.length === 1;

    blocks.push({
      index: i,
      type: 'script',
      originalContent: combinedContent,
      content: combinedContent,
      name: deriveJsName(combinedContent, i),
      origin: groupOrigin.get(key),
      hasCdata: singleTag ? tags[0].hasCdata : false,
      cdataStyle: singleTag ? tags[0].cdataStyle : 'bare',
      ...(segments.length > 1 ? { segments } : {}),
    });
  }

  return blocks;
}
