# Handoff: F056 — FU-M2-6 value tokenisation hardening

## Status
COMPLETE

## Assertions covered
AS-055: PASS — `border: solid var(--accent) thin` and `border: solid var(--accent)` now put the bare `var()` token in the color slot (no unit suffix) and `thin` in the width slot; verified with `test_AS_055_color_style_width_in_declaration_order`, `test_AS_055_bare_var_token_goes_to_color_not_width`, `test_AS_055_bare_calc_token_goes_to_color_not_width`.
AS-061: PASS — dead `v === 'initial'` branch removed from `expandFlex`; `flex: initial` is still correctly caught and warn-dropped by the global-keyword guard in `expandDeclaration` before `expandFlex` ever runs, verified by `test_AS_061_initial_keyword_is_caught_by_global_keyword_guard`.
AS-065: PASS — font-weight regex now accepts any 1-3 digit numeric weight (100–999, including CSS4 values like 450/350/550), verified by `test_AS_065_css4_numeric_weight_450` and `test_AS_065_css4_numeric_weight_350_and_550`.
AS-067: PASS — same `isWidth` fix as AS-055 applies to `outline` (which shares `parseBorderParts`); verified by `test_AS_067_bare_var_token_goes_to_color_not_width`.

## Files changed
lib/webflow-converter/longhand.ts
lib/webflow-converter/longhand.test.ts

## Commands run
`npx vitest run lib/webflow-converter/longhand.test.ts` (0) — 116/116 passed

## Decisions made
- `isWidth()` now only matches `NAMED_WIDTHS` (thin/medium/thick) or a numeric token with an explicit CSS length unit suffix (px/em/rem/%/vw/vh/vmin/vmax/ch/ex/cm/mm/pt/pc/in/fr). Removed the `calc|var|min|max|clamp(` prefix match entirely per the spec's explicit instruction — a bare `var()`/`calc()` token without a unit now falls through to the color slot in `parseBorderParts` (used by both `border`/`border-*` and `outline`).
- Updated the pre-existing `test_AS_055_color_style_width_in_declaration_order` test, which had encoded the buggy behaviour (asserting `var(--accent)` landed in the width slot) — rewrote it to assert the corrected classification, and added two new regression tests (`AS-055`, `AS-067`) for the bare `var()`/`calc()` case.
- Font-weight regex changed to `/^(bold|bolder|lighter|normal|[1-9][0-9]{0,2})$/i` per spec, accepting any 1-3 digit weight starting 1-9 (so 100-999), not just multiples of 100.
- Removed the unreachable `v === 'initial'` branch in `expandFlex` with no behavioural change — the existing global-keyword guard at the top of `expandDeclaration` (`/^(inherit|initial|unset|revert|revert-layer)$/i` on shorthands) already intercepts `flex: initial` before `expandFlex` runs, matching AS-068's warn-and-drop contract.

## Out-of-scope work needed
None identified within this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: This repo's working tree was shared with a concurrent worker session also editing `lib/webflow-converter/longhand.ts` and `longhand.test.ts` (for AS-057/AS-069 work). By the time I ran `git status` to commit, the concurrent worker had already committed a full snapshot of the tree — including my edits — under commit `93e4b087` ("fix(AS-057): paren-aware border-radius split + non-recursive decl walk"). `git status` shows the working tree clean and all of my `isWidth`/font-weight/flex fixes and new regression tests are present and verified in that commit (confirmed via `git show`/grep against HEAD). There is nothing left to stage or commit separately for F056; I did not create a redundant commit since the content is already in history. No file changes were made outside `lib/webflow-converter/longhand.ts` and `lib/webflow-converter/longhand.test.ts`.

## Notes for the next worker
- All three M2-scrutiny bugs (AS-055/AS-067 var()-as-width misclassification, AS-065 CSS4 numeric font-weight, AS-061 dead flex `initial` branch) are fixed and covered by regression tests in `lib/webflow-converter/longhand.test.ts`.
- The fixes landed in commit `93e4b087` (not a dedicated F056 commit) due to a race with a concurrent worker session on the same shared working tree — if the orchestrator wants a dedicated, cleanly-attributed commit for F056's assertions specifically, it would need to be cherry-picked/re-committed from that commit's diff.
- Unrelated to this feature: a full `npm test` run was started but did not complete within the available time budget (large suite); the scoped test command specified in the feature spec (`npx vitest run lib/webflow-converter/longhand.test.ts`) was used for verification per the spec's explicit instruction and passes 116/116.
