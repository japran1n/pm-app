// TH-130..TH-140 — recompose an HTML document from edited style/script blocks.
//
// Pure string manipulation (no DOM), mirroring the extraction approach in
// extract.ts, so this is safe in the same runtimes.

import type { StyleBlock, ScriptBlock } from './extract';
import { injectStyleAgent } from '../site-preview/inject';

export type Block = StyleBlock | ScriptBlock;

/**
 * Recomposes `html` by substituting each block's edited `content` for its
 * `originalContent`. Blocks are applied in array order; each substitution
 * is a single-pass `String.prototype.replace` (never a regex), since
 * `originalContent` is unique per block and only the first occurrence
 * should be touched.
 *
 * If a block's `originalContent` can no longer be found in the document
 * (e.g. it was already replaced, or the source changed), the block's
 * current content is appended as a new `<style>`/`<script>` tag
 * immediately before `</body>` (or at the end of the document if there is
 * no closing body tag).
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

  for (const block of blocks) {
    if (result.includes(block.originalContent)) {
      result = result.replace(block.originalContent, block.content);
    } else {
      const tag =
        block.type === 'style'
          ? `<style>${block.content}</style>`
          : `<script>${block.content}</script>`;

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
