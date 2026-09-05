# Handoff: F122 — Link marks are stored without an href, so every link is dropped on render

## Status
COMPLETE

## Assertions covered
AS-076: PASS — `tests/unit/f122-link-mark-without-href.test.tsx` (`test_AS_076_href_less_link_mark_is_not_treated_as_already_linked`, plus the end-to-end pipeline test). Verified live: `npx tsx` run of the fixed `autolinkBody` against the exact reported shape (`{"type":"link"}`, no attrs) now produces `{"type":"link","attrs":{"href":"https://www.youtube.com/watch?v=W4drPiXwlyc"}}`.
AS-077: PASS — 5 tests: repaired node carries exactly one link mark (no duplicate), a real already-linked mark is left alone, an empty-string href is also treated as unlinked, and a href-less mark around non-URL text is stripped rather than left dangling.
AS-078: PASS — `sanitiseDocument` (unchanged) still drops a href-less link mark and renders plain text with no anchor and no fabricated href; a real href still renders normally. Confirmed via a full jsdom render through `RichTextRenderer`.

## Files changed
lib/chat/autolink-body.ts
components/chat/message-composer.tsx
tests/unit/f122-link-mark-without-href.test.tsx (new)

## Commands run
`npx tsc --noEmit` (0)
`npx eslint lib/chat/autolink-body.ts components/chat/message-composer.tsx tests/unit/f122-link-mark-without-href.test.tsx` (0)
`npx vitest run tests/unit/f122-link-mark-without-href.test.tsx tests/unit/f120-chat-bugs.test.ts tests/unit/f121-links-inert-in-renderer.test.tsx tests/unit/rich-text-editor.test.tsx` (0 — 39/39 passed)
`npx vitest run tests/unit` (1 file / 2 tests failed — pre-existing, unrelated; see below) — 1935/1937 passed otherwise, and the 2 failures pass in isolation (`npx vitest run tests/unit/f005-task-detail-sheet-page-fields.test.tsx tests/unit/f006c-task-detail-sheet-page-fields-system-key-gate.test.tsx` → 9/9 passed). Confirmed pre-existing by `git stash`-ing my changes and re-running the same two files: identical `cookies() was called outside a request scope` unhandled-rejection noise from `lib/queries/page-links.ts`/`lib/supabase/server.ts`, nothing to do with chat/links. Not touched by this feature.
`node --env-file=.env` REST query against the live `messages` table (read-only, via Supabase REST API using `SUPABASE_SECRET_KEY`) — confirmed the exact reported bug shape was present in every real chat message containing a URL sent since F120 landed (5 rows checked, 100% href-less).
`npx tsx -e '...'` — ran the fixed `autolinkBody` directly against the exact reported JSON shape and confirmed the output now carries a correct href.

## Decisions made
- Fixed the guard in `lib/chat/autolink-body.ts` to check `hasUsableLinkHref(mark)` (a non-empty string `attrs.href`) instead of merely `mark.type === "link"`. When an existing link mark has no usable href, it is stripped from `baseMarks` before re-matching, so a subsequent match reuses that same mark "slot" rather than appending a second one — satisfies the spec's explicit "never end up with two link marks on one node."
- When a href-less mark's text has no URL to linkify at all (edge case, e.g. an existing link mark was left on plain prose by some other bug), the mark is still stripped rather than left in the document — a link mark with no href must never survive `autolinkBody`, matching AS-078's contract that the renderer correctly drops it, but the document itself should already be clean.
- Did NOT touch `sanitiseMark`/`sanitiseHref` in `components/editor/rich-text-editor.tsx` at all — per spec, dropping a href-less mark at render time is correct and stays exactly as F121 left it. Confirmed unchanged and still passing via the `f121-links-inert-in-renderer.test.tsx` suite.
- For item 2 (composer trace): fixed a genuine, independently-verifiable race in `components/chat/message-composer.tsx`. `submit()` read `richValue` (React state) directly. Tracing the actual event order: Tiptap/ProseMirror's own `keydown` listener is attached directly to the contenteditable DOM node (an "at target" listener), so on Enter it runs — and synchronously dispatches the transaction that splits the paragraph and applies the client-side `autolink()` mark (confirmed by an isolated `@tiptap/core` + `@tiptap/starter-kit` reproduction using the exact same `link: { openOnClick: false, autolink: true }` config as `sharedExtensions()`: pressing Enter after typing a bare URL produces a mark with a correct, fully-populated `href`) — *before* the same native event reaches React's root-delegated `onKeyDown` handler on the wrapping `<div>`, whose closure (`submit`) was captured at the *previous* render and therefore reads `richValue` as of one render behind. Fixed by mirroring every `onChange` into a `richValueRef` that `submit()` reads instead, so Enter always sends the just-updated document.

## Out-of-scope work needed
- I could NOT reproduce, via an isolated `@tiptap/core`/`@tiptap/starter-kit` harness (identical extension config to `sharedExtensions()`), a scenario where Tiptap's own mark-creation APIs (`autolink()`'s `appendTransaction`, or the paste-rule path) ever produce a `link` mark with a **missing** `attrs` object — every reproduction I ran (typing + Enter/splitBlock, typing + trailing space) produced a mark with a fully-populated `href`/`target`/`rel`/`class` attrs object, because ProseMirror's `Mark.create()` always fills schema-defined default attrs. I was unable to get a working jsdom `paste` event (jsdom has no `DataTransfer` implementation) to test the actual clipboard-paste code path specifically, which is the one client mechanism I could not rule out with the tooling available in this environment. The fix I shipped (item 2, the `richValueRef` race) is a real, independently-verified bug regardless of whether it is the *sole* origin, and is documented as such — if messages continue to reach the server pre-linked-but-href-less after this fix ships, the next step should be adding a `console.log(JSON.stringify(updatedEditor.getJSON()))` inside `RichTextEditor`'s `onUpdate` in a live browser session immediately before/after a paste of a bare URL followed by Enter, to capture the exact shape at the moment `onChange` fires for that specific input method (paste vs type-then-Enter vs type-then-space), since jsdom cannot exercise a real `ClipboardEvent`/`DataTransfer` paste.
- No backfill for messages already stored with href-less link marks (per spec, explicitly out of scope) — they will keep rendering as plain text until re-sent.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Named the new helper `hasUsableLinkHref` (spec didn't specify a name) to make the "must be present) and non-empty" contract self-documenting at the call site, since a future reader needs to know at a glance why `mark.attrs?.href` alone isn't the check.
AUTONOMOUS_DECISION: Applied the `richValueRef` fix as a genuinely independent, defensible fix for a real stale-closure race I found and verified by code-reading (event ordering between ProseMirror's DOM-attached listener and React's root-delegated synthetic handler), even though I could not conclusively prove it is the *only* origin of the href-less mark (see Out-of-scope above) — chosen because it is low-risk, in-scope per the spec's explicit instruction to trace and fix the composer path, and correct on its own merits regardless of whether it fully explains the reported symptom.

## Notes for the next worker
- The live DB check (via direct REST query using `SUPABASE_SECRET_KEY`, not the Supabase MCP — it wasn't authenticated in this environment, consistent with prior features' notes) showed **every** chat message containing a URL sent since F120 landed was href-less, with no exceptions across single-paragraph and double-paragraph (trailing empty paragraph from an Enter split) shapes. That the double-paragraph shape ALSO ends up href-less, despite my isolated repro showing Tiptap correctly links on Enter/splitBlock, is the strongest evidence that item 2's root cause is not fully pinned down by this feature — worth another look with real browser dev tools if the symptom recurs after this fix.
- `lib/chat/extract-links.ts`'s `extractLinkHrefs` already only reads marks with `typeof mark.attrs?.href === "string"` — reused directly in the new tests as the same "does this doc have a real link" check the rest of the codebase uses.
- No MCP tools used — Supabase MCP is unauthenticated in this environment (per this mission's established pattern); used a raw `node --env-file=.env` REST query against `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SECRET_KEY` instead, read-only, no credential values logged.
