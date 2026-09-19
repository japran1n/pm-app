export interface StyleBlock {
  index: number; // 0-based position in document
  type: 'style';
  originalContent: string; // content as found in HTML
  content: string; // same as originalContent initially (edited by user later)
  name?: string; // filled by name heuristic (F033)
}

const STYLE_TAG_RE = /<style([^>]*)>([\s\S]*?)<\/style>/gi;
const SRC_ATTR_RE = /\bsrc\s*=/i;
const NONCE_ATTR_RE = /\bnonce\s*=/i;

export interface ScriptBlock {
  index: number; // 0-based position in document (among script blocks)
  type: 'script';
  originalContent: string; // content as found in HTML
  content: string; // same as originalContent initially (edited by user later)
  name?: string; // filled by name heuristic (F033)
}

const SCRIPT_TAG_RE = /<script([^>]*)>([\s\S]*?)<\/script>/gi;

const FIRST_LINE_COMMENT_RE = /^\s*\/\/(.*)$/;
const DECLARATION_RE = /\b(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/;
const MAX_NAME_LENGTH = 60;

function truncateName(name: string): string {
  if (name.length <= MAX_NAME_LENGTH) {
    return name;
  }
  return `${name.slice(0, MAX_NAME_LENGTH)}…`;
}

/**
 * Derives a human-readable name for a JS script block.
 *
 * 1. If the first line of content is a `//` comment, use its text.
 * 2. Otherwise use the name from the first const/let/var/function declaration.
 * 3. Otherwise fall back to `script-${index + 1}.js`.
 *
 * Result is truncated to 60 chars (with a trailing … if truncated).
 */
export function deriveJsName(content: string, index: number): string {
  const firstLine = (content ?? '').split('\n')[0] ?? '';
  const commentMatch = firstLine.match(FIRST_LINE_COMMENT_RE);
  if (commentMatch) {
    const commentText = commentMatch[1].trim();
    if (commentText) {
      return truncateName(commentText);
    }
  }

  const declMatch = (content ?? '').match(DECLARATION_RE);
  if (declMatch) {
    return truncateName(declMatch[1]);
  }

  return `script-${index + 1}.js`;
}

/**
 * Extracts all inline <style>...</style> blocks from an HTML document string
 * in document order. Pure string/regex implementation (no DOM, no jsdom/cheerio)
 * so it is safe to run in the Next.js edge runtime.
 *
 * Never throws: malformed/unclosed tags simply are not matched (the regex
 * requires a closing tag), and any unexpected error while scanning results in
 * returning whatever blocks were found up to that point.
 */
export function extractStyleBlocks(html: string): StyleBlock[] {
  const blocks: StyleBlock[] = [];

  if (!html || typeof html !== 'string') {
    return blocks;
  }

  try {
    let index = 0;
    STYLE_TAG_RE.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = STYLE_TAG_RE.exec(html)) !== null) {
      const attrs = match[1] ?? '';
      const content = match[2] ?? '';

      // Defensive: skip <style src="..."> tags (not valid HTML but be safe)
      if (SRC_ATTR_RE.test(attrs)) {
        continue;
      }

      blocks.push({
        index,
        type: 'style',
        originalContent: content,
        content,
      });
      index += 1;
    }
  } catch {
    // Malformed HTML must never throw; return whatever was found so far.
    return blocks;
  }

  return blocks;
}

/**
 * Extracts all inline <script>...</script> blocks from an HTML document
 * string in document order. Excludes external scripts (<script src="...">)
 * and nonce-bearing scripts injected by the proxy (<script nonce="...">).
 * Pure string/regex implementation (no DOM, no jsdom/cheerio) so it is safe
 * to run in the Next.js edge runtime. Never throws.
 */
export function extractScriptBlocks(html: string): ScriptBlock[] {
  const blocks: ScriptBlock[] = [];

  if (!html || typeof html !== 'string') {
    return blocks;
  }

  try {
    let index = 0;
    SCRIPT_TAG_RE.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = SCRIPT_TAG_RE.exec(html)) !== null) {
      const attrs = match[1] ?? '';
      const content = match[2] ?? '';

      // Exclude external scripts.
      if (SRC_ATTR_RE.test(attrs)) {
        continue;
      }

      // Exclude nonce-bearing scripts injected by our proxy.
      if (NONCE_ATTR_RE.test(attrs)) {
        continue;
      }

      blocks.push({
        index,
        type: 'script',
        originalContent: content,
        content,
        name: deriveJsName(content, index),
      });
      index += 1;
    }
  } catch {
    // Malformed HTML must never throw; return whatever was found so far.
    return blocks;
  }

  return blocks;
}
