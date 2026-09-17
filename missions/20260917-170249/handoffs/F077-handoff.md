# Handoff: F077 — carry external scripts into custom code output

## Status
COMPLETE

## Assertions covered
AS-101: PASS — `extractScripts` collects both inline bodies and external `<script src>` tag markup into the `scripts` array; verified by "extracts inline script content" and the new interleaved-order test.
AS-103: PASS — external `<script src="...">` tags are now carried into `scripts` as their original `outerHTML` unchanged, with no allowlist restriction and no stripping; verified by "carries the original tag markup for an external script src, alongside an advisory warning".
AS-110: PASS — order of multiple `<script>` blocks (inline and external mixed) in the output matches source order; verified by "carries interleaved inline and external scripts in source order, with exactly one advisory warning".

## Files changed
lib/webflow-converter/js-extract.ts
lib/webflow-converter/js-extract.test.ts

## Commands run
`npx vitest run lib/webflow-converter/` (0) — 9 test files, 331 tests passed
`npx tsc --noEmit` (0)
`npm run lint` (0)

## Decisions made
- Used `el.outerHTml` (node-html-parser) to capture the original tag markup verbatim for external `<script src>` tags, satisfying AS-103's "unchanged, no allowlist, no stripping" requirement.
- Kept the loop appending to a single `scripts` array in DOM traversal order (querySelectorAll already yields document order), so inline and external scripts interleave correctly at source position without extra bookkeeping — satisfies AS-110.
- Changed the warning message from "not included — add manually" to "included in custom code — verify it loads correctly in Webflow" since the script is now carried, not skipped; the warning is now purely advisory per the spec's "alongside, not instead of" requirement.
- Replaced the two existing tests that asserted external scripts were excluded (previously testing the wrong behavior per AS-103) with corrected versions, and added the three new tests called out in the spec (interleaved order, warnings count, inline-only zero-warnings case).

## Out-of-scope work needed
- Noticed pre-existing uncommitted changes in `lib/webflow-converter/convert.ts` and `lib/webflow-converter/emit.ts` (removal of `styles` from `ConvertResult.customCode`, merging inline `<style>` into CSS parsing, new unused-CSS-class warning). These are unrelated to F077 and were left untouched — appear to belong to a different in-flight feature (possibly AS-089/AS-051 related). Not committed or modified by this worker.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Kept the doc comment at the top of js-extract.ts updated to reflect the new carry-through behavior for external scripts, since the old comment ("External scripts ... are never fetched or included") was now factually wrong and would mislead future readers. This is a comment-only change within the same file already in scope.

## Notes for the next worker
- `node-html-parser`'s `outerHTML` reproduces the tag with its original attributes as parsed; for self-closing-looking `<script src="...">` tags it renders as `<script src="...">​</script>` (explicit close tag), which is valid and matches the spec's example.
- The pre-existing dirty state in `convert.ts`/`emit.ts`/`validator.ts`/`convert.test.ts`/`emit.test.ts` (unrelated to this feature, likely from a concurrent worker in the same repo working tree) was left as-is and NOT committed by this worker. It currently causes 13 test failures in `convert.test.ts`/`emit.test.ts` when running the full suite — those failures are unrelated to F077. My commit (`a424bfcf`) touches only `js-extract.ts`/`js-extract.test.ts`, and `npx vitest run lib/webflow-converter/js-extract.test.ts` passes 11/11 in isolation. Flagging for the orchestrator in case that concurrent work needs separate attribution/commit or investigation.
