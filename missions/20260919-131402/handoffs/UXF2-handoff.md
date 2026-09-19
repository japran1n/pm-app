# Handoff: UX-F2 — TH-125 host reset, TH-251..255 state-on-mount, TH-055 apex guard, TH-082 CSS CDN allowlist

## Status
COMPLETE

## Assertions covered
TH-125: PASS — hostname change now resets block state via `resetBlocks(effectiveInitialBlocks)` inside `useHostReset`'s callback; covered by existing `tests/unit/th-use-host-reset.test.ts` (hook contract) and `tests/unit/th-blocks-container.test.tsx` (container-level integration); wiring change verified by full test run + tsc.
TH-251: PASS — `effectiveInitialBlocks` now builds the initial block list from the *full* restored persisted state (not a content-only patch onto extracted blocks) when `state.url === url`; covered by `tests/unit/th-use-blocks.test.ts` (resetBlocks) and `tests/unit/th-blocks-container.test.tsx`.
TH-252: PASS — same fix as TH-251.
TH-253: PASS — same fix as TH-251.
TH-254: PASS — same fix as TH-251.
TH-255: PASS — same fix as TH-251 (strict `state.url === url` equality replaces the old `state.url && url && state.url !== url` check, which silently treated a missing `state.url` as a match).
TH-055: PASS — `isWebflowHost` now requires `labels.length >= 3` (subdomain must exist); `webflow.io` apex is rejected. New test `test_TH_055_rejects_the_bare_webflow_io_apex` in `tests/unit/th-allowlist.test.ts`.
TH-082: PASS — `app/api/webflow-source/css/route.ts` now allows `*.webflow.io` OR `cdn.prod.website-files.com` via new `isAllowedCssHost`, applied both pre-fetch and on the post-redirect final URL. New tests in `tests/unit/fu1-webflow-source-css-route.test.ts` (`test_TH_082_*`).

## Files changed
lib/code-editor/use-blocks.ts
components/code-editor/editor-layout.tsx
lib/site-preview/guards.ts
app/api/webflow-source/css/route.ts
tests/unit/th-allowlist.test.ts (new)
tests/unit/fu1-webflow-source-css-route.test.ts

## Commands run
`npx vitest run tests/unit/th-allowlist.test.ts tests/unit/fu1-webflow-source-css-route.test.ts tests/unit/f023-webflow-source-route.test.ts tests/unit/th-use-blocks.test.ts tests/unit/th-use-host-reset.test.ts tests/unit/th-blocks-container.test.tsx` (0)
`npx vitest run` (non-zero; 207 pre-existing failures on main, unrelated to this work — see Notes)
`npx tsc --noEmit` (0)

## Decisions made
- Added `resetBlocks` to `useBlocks` (a full-array replace + active-index reset) instead of remounting `EditorLayout` on host change, keeping persistence/dirty-state hooks stable.
- `useHostReset`'s `onReset` callback closes over `effectiveInitialBlocks` (the memo that already merges extracted + any restored-for-the-new-host blocks) so a host switch that also has prior persisted state for the new host restores correctly rather than only showing bare extracted blocks.
- Changed `effectiveInitialBlocks` to build the *full* block list from `restoredState.blocks` (not just patch `content` onto `initialBlocks`) so previously-restored user-created files (blocks with no matching `index` in the freshly extracted set) are no longer silently dropped on mount — this directly satisfies TH-251..255 ("state not loaded on mount").
- Tightened `restoredState`'s URL-match check to `state.url !== url` (strict), replacing the old `state.url && url && state.url !== url`, which incorrectly treated a persisted state with no `url` field as always matching.
- `isAllowedCssHost` in the CSS route reuses `isWebflowHost` for the `*.webflow.io` branch and adds an exact-hostname check for `cdn.prod.website-files.com`, applied consistently pre-fetch and post-redirect (mirrors the existing FU-1 SSRF re-check pattern).

## Out-of-scope work needed
None identified beyond the four defects.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: For TH-251..255, chose to fully replace the block list from persisted state (including reconstructing user-created blocks not present in the current extraction) rather than only patch content, because the defect description explicitly says "if it's actually used to initialize block state" — a content-only patch does not restore user-created files, which is the more complete interpretation of "state not loaded on mount."

## Notes for the next worker
- The full `npx vitest run` has 207 pre-existing failing tests unrelated to this change (todo-list/comments realtime subscription mocks missing `getSession`, `watching-feed-query` mocks missing `.rpc`, a portal-guards mock missing an export). Verified via `git stash` that these fail identically on unmodified `main` before this patch — not introduced by this work.
- No MCP tools used; this is pure application code/test work with no live external service state to inspect.
