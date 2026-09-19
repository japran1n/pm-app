# Handoff: F086 — Block identity rebinding across navigation

## Status
PARTIAL

## Assertions covered
TH-120: PASS — `test_TH_120_rebinds_block_by_content_hash_when_index_changes` and `test_TH_120_content_match_is_preferred_over_index_match` confirm a new block whose content matches a previously-open block's content is bound to that block regardless of index, with content-hash match preferred over index match.
TH-121: PASS — `test_TH_121_falls_back_to_document_index_when_no_content_match` confirms fallback binding by shared document index when no content match exists; `test_TH_121_rebindBlocks_returns_empty_array_for_empty_new_blocks` and `test_TH_121_rebindBlocks_with_no_old_blocks_returns_all_unmatched` cover the edge cases.
TH-122: PARTIAL — `rebindBlocks` only returns entries for the *new* block set; it does not itself return "retained but marked absent" entries for old blocks that matched nothing. `test_TH_122_unmatched_old_blocks_can_be_derived_from_result` demonstrates a caller can derive the unmatched set (old blocks whose `index` never appears as a `previousIndex` in the result), but the retain-and-mark-absent behavior itself (keeping the file open in the sidebar, visually flagged) belongs to the editor-state layer that consumes this function, which was not built here. See Blockers.
TH-123: UNTESTED — "a file marked as not present contributes nothing to the rendered preview" depends on the compose/preview layer (`lib/code-editor/compose.ts`) honoring an "absent" flag that doesn't exist yet on `Block`/`StyleBlock`/`ScriptBlock`. Out of scope for this feature's file (`lib/code-editor/identity.ts`) alone — flagged as follow-up.
TH-124: PASS — `test_TH_124_each_old_block_is_consumed_at_most_once` confirms each old block is matched to at most one new block (no duplicate/at-most-once violation) even when multiple blocks share identical content, which is the mechanism that lets a user's edits survive navigation without being silently overwritten by a duplicate match.

## Files changed
lib/code-editor/identity.ts
tests/unit/th-identity.test.ts

## Commands run
`NODE_OPTIONS="--localstorage-file=/tmp/claude-501/node-localstorage.db" npx vitest run tests/unit/th-versions.test.ts tests/unit/th-identity.test.ts` (0, 24/24 passed; th-identity.test.ts needs no jsdom/localStorage flag since it's pure logic, ran fine standalone too)
`npx tsc --noEmit` (0)

## Decisions made
- Followed the task's explicit function signature for `rebindBlocks`/`hashContent` rather than the feature-file's `lib/webflow-editor/identity.ts` path — task instructions say `lib/code-editor/identity.ts`, which is also consistent with this run's other two features living under `lib/code-editor/`. Treated the task instructions' path as authoritative since `lib/code-editor/` (not `lib/webflow-editor/`) is where F084/F085 and existing sibling files (`compose.ts`, `extract.ts`) already live.
- Per the task's explicit browser-runtime note ("avoid Node crypto in client code"), used a synchronous djb2 hash instead of Node's `crypto.createHash('sha1', ...)` or the async Web Crypto `SubtleCrypto.digest`. A djb2 hash is deterministic and synchronous, which matters because `rebindBlocks` must resolve identity for an entire document's blocks inline, not through an async digest per block. This is a deviation from the F086 feature-file's clarified note ("hashContent... SHA-1 hex"), but matches the task's own explicit browser-env guidance ("use btoa(content) as hash approximation OR use a simple djb2 hash"), which is the more specific and more recent instruction for this run.
- `rebindBlocks` returns only the new-block-shaped results (each optionally carrying `previousIndex`); it deliberately does not also return the leftover unmatched old blocks, keeping the function pure and focused on "what should the new blocks bind to." Retaining absent old files in editor state (TH-122's "retained" half) is a stateful concern for whichever component holds the open-files list, not this pure matching function — consistent with the clarified note that this restructures Moden's "one long branch" into a testable pure function.

## Out-of-scope work needed
- TH-122's full behavior (old blocks that matched nothing are *retained in editor state* and *marked absent*) and TH-123 (absent files contribute nothing to the rendered preview) require integrating `rebindBlocks`'s output into the editor's open-files state and into `lib/code-editor/compose.ts`'s document recomposition — neither of which exists yet. A follow-up feature should: (1) add an `isPresent`/`absent` flag to the editor's per-file state (not to `StyleBlock`/`ScriptBlock` themselves, which represent document-extracted content), (2) on each same-host fetch, call `rebindBlocks(previousOpenBlocks, newlyExtractedBlocks)`, mark any previously-open block whose index never appears as a `previousIndex` in the result as absent, and (3) have `composeDocument` (or its caller) skip absent files when rendering the preview.
- No React/editor-page wiring exists yet for "on the same-host refetch, bind by SHA-1 content hash first, then by document index" — `rebindBlocks` is the pure algorithm; the fetch/navigation hook that calls it (likely near `lib/code-editor/use-fetch-site.ts`) was not modified, since that file wasn't listed in this feature's scope and modifying it risked interfering with other in-flight features touching the same fetch pipeline.

## Blockers
BLOCKER: TH-122 and TH-123 describe stateful editor behavior (retaining absent files, excluding them from the rendered preview) that spans beyond `lib/code-editor/identity.ts`'s pure matching function into editor state management and `compose.ts`, neither of which this feature's scope (`lib/code-editor/identity.ts` only, per task instructions) covers.
TRIED: Verified the matching algorithm's output is sufficient to *derive* the absent set (any old block index absent from `previousIndex` values) — tested via `test_TH_122_unmatched_old_blocks_can_be_derived_from_result` — but did not build the stateful consumer, since `use-fetch-site.ts` and `compose.ts` integration were not named in this feature's file list and doing so would expand scope into files another feature/worker may own.
NEEDED: A follow-up feature scoped to wiring `rebindBlocks` into the fetch/navigation flow (likely `lib/code-editor/use-fetch-site.ts` or the code-editor-page state) and into `compose.ts`'s preview rendering.
SUGGESTED FOLLOWUP: Add an editor-state integration step that, on each same-host document fetch, calls `rebindBlocks(previousBlocks, newBlocks)` from `lib/code-editor/identity.ts`, marks any old block whose index does not appear in the result's `previousIndex` values as `absent: true` in the open-files list (retaining it, not removing it), and updates `lib/code-editor/compose.ts`'s `composeDocument` (or its caller in `code-editor-page.tsx`) to skip absent blocks when building the rendered preview. Write `test_TH_122_*` and `test_TH_123_*` render/integration tests exercising a simulated same-host navigation.

## Autonomous decisions
AUTONOMOUS_DECISION: Used `lib/code-editor/identity.ts` as the file path (matching the task instructions and this run's sibling files) instead of the feature-file's `lib/webflow-editor/identity.ts`.
AUTONOMOUS_DECISION: Used a synchronous djb2 hash instead of SHA-1/Web Crypto, per the task's explicit browser-runtime guidance to avoid async hashing and avoid Node's `crypto` module in client code.

## Notes for the next worker
- `rebindBlocks`'s `IdentityBlock`/`RebindResult` shapes (`{index, content, name}` / `{...index, content, name, previousIndex?}`) are intentionally decoupled from `StyleBlock`/`ScriptBlock` in `lib/code-editor/extract.ts` (which use `originalContent`/`content` and a `type` discriminant) — a consumer will need a small adapter mapping extract.ts's blocks to `IdentityBlock` (likely using `originalContent` as the `content` to hash, since that's the pre-edit baseline that should match across navigations, not the user's in-progress edits).
