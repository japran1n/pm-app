// F093 (TH-270..TH-275) — Copy-out: copy the active block's content to the
// clipboard, wrapped in its original tag so the user can paste it directly
// back into Webflow's custom code panel.

import type { Block } from './compose';

/**
 * Wraps `content` in the opening/closing tag matching `block.type` so the
 * copied text pastes cleanly into a Webflow custom code panel. Style
 * blocks get `<style>...</style>`, script blocks get `<script>...</script>`.
 */
export function wrapForCopy(block: Pick<Block, 'type'>, content: string): string {
  return block.type === 'style'
    ? `<style>\n${content}\n</style>`
    : `<script>\n${content}\n</script>`;
}

/**
 * Writes `content` to the system clipboard via the Clipboard API. Never
 * throws: callers should treat a rejected promise as failure (e.g. show a
 * "copy failed" message) and a resolved promise as success (e.g. show a
 * brief confirmation).
 */
export async function copyToClipboard(content: string): Promise<void> {
  await navigator.clipboard.writeText(content);
}
