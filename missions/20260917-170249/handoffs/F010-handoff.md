# Handoff: F010 — longhand font list outline

## Status
COMPLETE

## Assertions covered
AS-065: PASS — font shorthand expands to font-style/font-weight/font-size/line-height/font-family across style+weight+size/line-height+family, size+family only, numeric weight, and unparseable-input warning cases.
AS-066: PASS — list-style shorthand expands to list-style-type/list-style-position/list-style-image (type only, type+position, type+position+url() image, bare keyword as type).
AS-067: PASS — outline shorthand expands to outline-width/outline-style/outline-color (width+style+color, style only, named width+style, style+color).

## Files changed
lib/webflow-converter/longhand.ts
lib/webflow-converter/longhand.test.ts

## Commands run
`npx vitest run lib/webflow-converter/longhand.test.ts` (0) — 95 passed, 0 failed
`npx tsc --noEmit -p tsconfig.json` (checked for longhand-specific errors: none found)

## Decisions made
- Ported `expandFont`, and the `list-style`/`outline` switch cases byte-for-byte from `~/Desktop/html-to-webflow/src/longhand.mjs`, matching the clarified "port fidelity: byte-for-byte logic port" answer.
- Reused the existing `parseBorderParts`/`isWidth`/`BORDER_STYLES`/`NAMED_WIDTHS` helpers (already present in `longhand.ts` from sibling feature F006/border work) for `outline`, since outline and border share the same width/style/color parsing grammar in the reference implementation — this avoids duplicating logic and matches the prototype's own reuse pattern.
- This module (`lib/webflow-converter/longhand.ts`) is shared with sibling features F006 (border), F007 (gap/overflow/place), F008/F009 (transition/flex) which were being implemented concurrently by other workers in the same run. I read/wrote the file multiple times to merge cleanly with their in-flight edits rather than overwrite their work. The final committed file (commit 7ae82c6f, authored by the border/radius worker) contains all of font/list-style/outline (my scope) plus border/border-radius/gap/overflow/place/transition/flex (sibling scope), and all 95 tests including mine pass.
- No separate commit was made under this feature's own commit message because by the time I went to commit, a concurrent worker had already committed the shared file (with my changes included, verified via `git show HEAD:lib/webflow-converter/longhand.ts`). Re-committing would have been a no-op / risked reverting sibling work.

## Out-of-scope work needed
None identified beyond what sibling features F006/F007/F008/F009 already cover (border, gap/overflow/place, transition, flex) — those are outside this feature's file/assertion scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Did not create a standalone git commit for F010 because the working tree showed no uncommitted diff for `lib/webflow-converter/longhand.ts` / `longhand.test.ts` by the time I finished — a concurrent sibling worker (F006, border/border-radius) committed the shared file first and it already contained my font/list-style/outline additions plus tests. Verified via `git show HEAD:...` that all AS-065/066/067 code and tests are present in commit `7ae82c6f feat(longhand-border-and-radius): port border and border-radius expansion`. If the orchestrator wants a dedicated commit message referencing F010's assertions, it can be added as an empty/doc-only follow-up, but the code itself is already on `main`.

## Notes for the next worker
- `lib/webflow-converter/longhand.ts` and its test file are a shared hot file across F005-F010 (all longhand/shorthand porting features). Expect concurrent-edit merge conflicts if more features touch it; always re-Read immediately before Edit/Write.
- Full test suite for this file: `cd /Users/sasajapranin/Desktop/pm-app && npx vitest run lib/webflow-converter/longhand.test.ts` — 95/95 passing as of this handoff, covering AS-053 through AS-068 (margin/padding/inset, global keyword guard, gap/overflow/place-*, transition, flex, border/border-radius, font, list-style, outline).
- Reference prototype used: `~/Desktop/html-to-webflow/src/longhand.mjs` (`expandFont`, `list-style` and `outline` switch cases).
