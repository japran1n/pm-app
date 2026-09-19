// TH-130..TH-140 — recompose an HTML document from edited style/script blocks.
//
// Pure string manipulation (no DOM), mirroring the extraction approach in
// extract.ts, so this is safe in the same runtimes.

import type { StyleBlock, ScriptBlock } from './extract';
import { injectStyleAgent } from '../site-preview/inject';

export type Block = StyleBlock | ScriptBlock;

const STYLE_TAG_SOURCE = "<style([^>]*)>([\\s\\S]*?)<\\/style>";
const SCRIPT_TAG_SOURCE = "<script([^>]*)>([\\s\\S]*?)<\\/script>";

function tagRegexFor(type: Block['type']): RegExp {
  return new RegExp(type === 'style' ? STYLE_TAG_SOURCE : SCRIPT_TAG_SOURCE, 'gi');
}

function openTagName(type: Block['type']): string {
  return type === 'style' ? '<style' : '<script';
}

function isBlank(value: string | undefined | null): boolean {
  return !value || value.trim().length === 0;
}

/**
 * Finds the tag (of `block.type`) whose inner content exactly matches
 * `block.originalContent`, searching `html` starting at `fromIndex`. Unlike
 * a naked string/regex search over the whole document, this only ever
 * matches genuine `<style>`/`<script>` tag bodies -- so a CSS/JS string that
 * happens to appear elsewhere in the markup (e.g. inside another tag's
 * content, or as literal text) can never be mistaken for the block's real
 * location (bug: first-occurrence-only corruption).
 *
 * Callers advance `fromIndex` past a block's replaced region before
 * locating the next block, so two blocks sharing identical content each
 * resolve to their own, distinct tag occurrence instead of both landing on
 * the first one (bug: duplicate-content corruption).
 */
function findBlockContentRange(
  html: string,
  type: Block['type'],
  originalContent: string,
  fromIndex: number
): { contentStart: number; contentEnd: number } | null {
  const re = tagRegexFor(type);
  re.lastIndex = fromIndex;
  let match: RegExpExecArray | null;

  while ((match = re.exec(html)) !== null) {
    const attrs = match[1] ?? '';
    const content = match[2] ?? '';

    if (content === originalContent) {
      const prefixLength = openTagName(type).length + attrs.length + 1; // +1 for '>'
      const contentStart = match.index + prefixLength;
      const contentEnd = contentStart + content.length;
      return { contentStart, contentEnd };
    }

    // Guard against zero-length matches causing an infinite loop (can't
    // actually happen with this pattern, but keep the scan well-behaved).
    if (match.index === re.lastIndex) {
      re.lastIndex += 1;
    }
  }

  return null;
}

/**
 * Recomposes `html` by substituting each block's edited `content` for its
 * `originalContent`. Blocks are applied in array order.
 *
 * Substitution is done by locating the actual `<style>`/`<script>` tag
 * whose inner text equals `originalContent` (not a naked string replace),
 * so content that also happens to appear elsewhere in the document is never
 * mistaken for the block's real location. When two blocks share identical
 * `originalContent`, each is matched to its own distinct tag occurrence in
 * document order.
 *
 * Blocks whose `originalContent` is empty or whitespace-only (e.g. newly
 * created, never-saved files) cannot be safely located in the document --
 * every position would match -- so they are never used to locate a
 * replacement; they always fall through to the "append as new tag" path
 * below.
 *
 * If a block's `originalContent` can no longer be found in the document
 * (e.g. it was already replaced, the source changed, or it's a new/empty
 * block), the block's current content is appended as a new
 * `<style>`/`<script>` tag immediately before `</body>` (or at the end of
 * the document if there is no closing body tag).
 *
 * When a block's `originalContent` was `<![CDATA[ ... ]]>`-wrapped in the
 * source document (`block.hasCdata`), the wrapper is restored around the
 * edited content on the way back out, so CDATA-wrapped script/style bodies
 * round-trip instead of losing their wrapper.
 *
 * When `opts.injectStyleAgent` is true, the style agent script (F038) is
 * injected into the result so live style patches keep working against the
 * recomposed document.
 */
export function composeDocument(
  html: string,
  blocks: Block[],
  opts?: { injectStyleAgent?: boolean }
): string {
  let result = html ?? '';

  // Per-type search cursor, so that once a block's tag occurrence has been
  // located and replaced, a subsequent block with identical originalContent
  // resolves to the *next* occurrence rather than the same one.
  const searchFrom: Record<Block['type'], number> = { style: 0, script: 0 };

  for (const block of blocks) {
    const newContent = block.hasCdata
      ? `<![CDATA[${block.content}]]>`
      : block.content;

    const range = isBlank(block.originalContent)
      ? null
      : findBlockContentRange(result, block.type, block.originalContent, searchFrom[block.type]);

    if (range) {
      result =
        result.slice(0, range.contentStart) +
        newContent +
        result.slice(range.contentEnd);
      searchFrom[block.type] = range.contentStart + newContent.length;
    } else {
      const tag =
        block.type === 'style'
          ? `<style>${newContent}</style>`
          : `<script>${newContent}</script>`;

      const bodyClose = /<\/body\s*>/i.exec(result);
      if (!bodyClose) {
        result = result + tag;
      } else {
        result =
          result.slice(0, bodyClose.index) + tag + result.slice(bodyClose.index);
      }
    }
  }

  if (opts?.injectStyleAgent) {
    result = injectStyleAgent(result);
  }

  return result;
}
