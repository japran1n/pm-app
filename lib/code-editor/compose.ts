// TH-130..TH-140 — recompose an HTML document from edited style/script blocks.
//
// Pure string manipulation (no DOM), mirroring the extraction approach in
// extract.ts, so this is safe in the same runtimes.

import { stripCdata, type StyleBlock, type ScriptBlock } from './extract';
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

interface TagSlot {
  contentStart: number;
  contentEnd: number;
  /** Start of the full opening tag (`<style` / `<script`) in the source. */
  tagStart: number;
  /** End of the full closing tag (`</style>` / `</script>`) in the source. */
  tagEnd: number;
  content: string;
  used: boolean;
}

/** Every genuine `<style>`/`<script>` tag body of `type` in `html`, in
 * document order. Only real tag bodies are considered, so CSS/JS text that
 * happens to appear elsewhere in the markup is never mistaken for a
 * block's location. */
function scanTags(html: string, type: Block['type']): TagSlot[] {
  const re = tagRegexFor(type);
  const slots: TagSlot[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const attrs = match[1] ?? '';
    const content = match[2] ?? '';
    const contentStart = match.index + openTagName(type).length + attrs.length + 1; // +1 for '>'
    slots.push({
      contentStart,
      contentEnd: contentStart + content.length,
      tagStart: match.index,
      tagEnd: match.index + match[0].length,
      content,
      used: false,
    });
    if (match.index === re.lastIndex) re.lastIndex += 1;
  }
  return slots;
}

function wrapContent(block: Block): string {
  if (!block.hasCdata) return block.content;
  return block.type === 'script' && block.cdataStyle === 'comment'
    ? `// <![CDATA[\n${block.content}\n// ]]>`
    : `<![CDATA[${block.content}]]>`;
}

/** True when the user changed a block away from what was extracted. */
function isEdited(block: Block): boolean {
  const pristine = block.hasCdata ? stripCdata(block.originalContent) : block.originalContent;
  return block.content !== pristine && block.content !== block.originalContent;
}

/**
 * Recomposes `html` by substituting each block's edited `content` for its
 * `originalContent`. Blocks are applied in array order.
 *
 * Substitution locates the actual `<style>`/`<script>` tag whose inner text
 * equals `originalContent` (not a naked string replace). A per-type cursor
 * means two blocks sharing identical `originalContent` each resolve to their
 * own, distinct tag occurrence in document order.
 *
 * Deduplicated blocks (see `deduplicateBlocks`) carry `duplicates`: the raw
 * contents of the other tags they stand in for (e.g. one Embed per CMS
 * item). Once the block has been edited, its new content is written into
 * every one of those tags too; an unedited block leaves them untouched, so
 * per-item values survive until the user actually changes the file.
 * Duplicates are resolved after all primary blocks, against tags no
 * primary claimed, so they never steal another block's tag.
 *
 * Blocks whose `originalContent` is empty or whitespace-only (e.g. newly
 * created files) or can no longer be found are appended as a new
 * `<style>`/`<script>` tag immediately before `</body>` (or at the end of
 * the document if there is no closing body tag).
 *
 * CDATA wrappers are restored on the way out (`hasCdata` / `cdataStyle`).
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
  const source = html ?? '';
  const slots: Record<Block['type'], TagSlot[]> = {
    style: scanTags(source, 'style'),
    script: scanTags(source, 'script'),
  };
  const cursor: Record<Block['type'], number> = { style: 0, script: 0 };
  const replacements: { start: number; end: number; text: string }[] = [];
  const appended: string[] = [];
  const duplicateJobs: { type: Block['type']; originals: string[]; text: string }[] = [];

  for (const block of blocks) {
    const newContent = wrapContent(block);
    const list = slots[block.type];

    if (block.segments && block.segments.length > 1) {
      // Grouped block: replace first segment's tag content; delete the rest.
      const primaryOriginal = block.segments[0];
      let primaryFound = -1;
      if (!isBlank(primaryOriginal)) {
        for (let i = cursor[block.type]; i < list.length; i += 1) {
          if (!list[i].used && list[i].content === primaryOriginal) {
            primaryFound = i;
            break;
          }
        }
      }

      if (primaryFound >= 0) {
        const slot = list[primaryFound];
        slot.used = true;
        cursor[block.type] = primaryFound + 1;
        replacements.push({ start: slot.contentStart, end: slot.contentEnd, text: newContent });

        // Delete the remaining segment tags (replace entire <tag>...</tag> with '').
        for (let s = 1; s < block.segments.length; s += 1) {
          const segContent = block.segments[s];
          if (isBlank(segContent)) continue;
          for (let i = cursor[block.type]; i < list.length; i += 1) {
            if (!list[i].used && list[i].content === segContent) {
              list[i].used = true;
              replacements.push({ start: list[i].tagStart, end: list[i].tagEnd, text: '' });
              break;
            }
          }
        }
      } else {
        appended.push(
          block.type === 'style' ? `<style>${newContent}</style>` : `<script>${newContent}</script>`
        );
      }

      if (block.duplicates && block.duplicates.length > 0 && isEdited(block)) {
        duplicateJobs.push({ type: block.type, originals: block.duplicates, text: newContent });
      }
      continue;
    }

    // Single-tag block (no segments, or segments.length === 1): original path.
    let found = -1;
    if (!isBlank(block.originalContent)) {
      for (let i = cursor[block.type]; i < list.length; i += 1) {
        if (!list[i].used && list[i].content === block.originalContent) {
          found = i;
          break;
        }
      }
    }

    if (found >= 0) {
      const slot = list[found];
      slot.used = true;
      cursor[block.type] = found + 1;
      replacements.push({ start: slot.contentStart, end: slot.contentEnd, text: newContent });
    } else {
      appended.push(
        block.type === 'style' ? `<style>${newContent}</style>` : `<script>${newContent}</script>`
      );
    }

    if (block.duplicates && block.duplicates.length > 0 && isEdited(block)) {
      duplicateJobs.push({ type: block.type, originals: block.duplicates, text: newContent });
    }
  }

  for (const job of duplicateJobs) {
    const list = slots[job.type];
    for (const original of job.originals) {
      if (isBlank(original)) continue;
      const slot = list.find((s) => !s.used && s.content === original);
      if (!slot) continue;
      slot.used = true;
      replacements.push({ start: slot.contentStart, end: slot.contentEnd, text: job.text });
    }
  }

  // Apply back-to-front so earlier offsets stay valid.
  replacements.sort((a, b) => b.start - a.start);
  let result = source;
  for (const r of replacements) {
    result = result.slice(0, r.start) + r.text + result.slice(r.end);
  }

  if (appended.length > 0) {
    const tags = appended.join('');
    const bodyClose = /<\/body\s*>/i.exec(result);
    result = bodyClose
      ? result.slice(0, bodyClose.index) + tags + result.slice(bodyClose.index)
      : result + tags;
  }

  if (opts?.injectStyleAgent) {
    result = injectStyleAgent(result);
  }

  return result;
}
