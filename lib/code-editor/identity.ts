// TH-120..TH-124 — block identity rebinding across same-host navigation.
//
// When the user navigates to a different page on the same host, the fetched
// document produces a new set of style/script blocks. To keep the user's
// open files (and their edits) stable across navigation, each new block is
// rebound to a previously-open block:
//
//   1. By content hash — identical original content means the same block,
//      regardless of where it now sits in the document.
//   2. Falling back to document index — if no content match exists, a block
//      at the same index as a previously-open block is treated as the same
//      block (best-effort continuity).
//
// This module runs in the browser (client-only editor, no DB — see
// tech-decisions.md), so it intentionally avoids Node's `crypto` module.
// `hashContent` uses a fast, dependency-free djb2 hash rather than the Web
// Crypto API's async `SubtleCrypto.digest`, because block identity matching
// must be synchronous (it runs inline while rebinding a whole document's
// worth of blocks).

/**
 * Deterministic, synchronous string hash (djb2 variant), returned as a hex
 * string. Not cryptographically secure — used only for content-equality
 * matching, not security.
 */
export function hashContent(content: string): string {
  const str = content ?? "";
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
    hash = hash >>> 0; // keep as unsigned 32-bit
  }
  return hash.toString(16);
}

export interface IdentityBlock {
  index: number;
  content: string;
  name: string;
}

export interface RebindResult extends IdentityBlock {
  previousIndex?: number;
}

/**
 * Rebinds a fresh set of blocks (from a newly-fetched page) onto the
 * identities of a previous set of blocks (currently open in the editor).
 *
 * Matching order per new block:
 *   1. Content hash match against any unmatched old block (TH-120).
 *   2. Fallback: an unmatched old block that shared the same document
 *      index (TH-121).
 *
 * Each old block is consumed at most once. New blocks that match get a
 * `previousIndex` pointing at the old block's index; new blocks with no
 * match are returned without `previousIndex` (treated as newly discovered).
 * Old blocks that match nothing are not present in the return value —
 * callers that need TH-122 (retain unmatched old blocks, marked absent)
 * do so by diffing the returned `previousIndex` set against their own
 * previous block list.
 */
export function rebindBlocks(
  oldBlocks: IdentityBlock[],
  newBlocks: IdentityBlock[]
): RebindResult[] {
  const unmatchedOld = new Map<number, IdentityBlock>();
  for (const old of oldBlocks) {
    unmatchedOld.set(old.index, old);
  }

  // Build a hash -> old block lookup for content matching. Multiple old
  // blocks can share a hash (duplicate content); consume in order.
  const byHash = new Map<string, IdentityBlock[]>();
  for (const old of oldBlocks) {
    const h = hashContent(old.content);
    const list = byHash.get(h) ?? [];
    list.push(old);
    byHash.set(h, list);
  }

  const results: RebindResult[] = [];

  for (const block of newBlocks) {
    let matched: IdentityBlock | undefined;

    // 1. Content hash match against a still-unmatched old block.
    const h = hashContent(block.content);
    const candidates = byHash.get(h) ?? [];
    for (const candidate of candidates) {
      if (unmatchedOld.has(candidate.index)) {
        matched = candidate;
        break;
      }
    }

    // 2. Fallback: same document index, if still unmatched.
    if (!matched) {
      const sameIndex = unmatchedOld.get(block.index);
      if (sameIndex) {
        matched = sameIndex;
      }
    }

    if (matched) {
      unmatchedOld.delete(matched.index);
      results.push({ ...block, previousIndex: matched.index });
    } else {
      results.push({ ...block });
    }
  }

  return results;
}
