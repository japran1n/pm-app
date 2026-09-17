# Handoff: F072 — fu-k revert to shorthand denylist

## Status
COMPLETE

## Assertions covered
AS-069: PASS — expandDeclaration's default branch is simple pass-through again; width/height/min-width/max-width/min-height/max-height/box-shadow/text-shadow all pass through unchanged with no warning. marker and position-try are now caught by isShorthand() via EXTRA_SHORTHANDS and warned-and-dropped. Verified with `npx vitest run lib/webflow-converter/` (252 tests passed) plus the specific manual checks from the spec (parseCss width/height/max-width, box-shadow pass-through, marker/position-try warn-drop, color pass-through).

## Files changed
lib/webflow-converter/longhand.ts
lib/webflow-converter/longhand.test.ts
missions/20260917-170249/handoffs/F072-handoff.md

## Commands run
`npx vitest run lib/webflow-converter/` (0) — 4 test files, 252 tests passed
`npx tsc --noEmit` (0)
`npm run lint` (0)

## Decisions made
- Removed the `LONGHAND_ALLOW_LIST` Set entirely from longhand.ts (it was added by F071 and is the root cause of the regression).
- Reverted the default branch of `expandDeclaration` to unconditional pass-through: `return { decls: { [prop]: value } }` for anything not caught earlier by the shorthand checks (PASS_THROUGH, isShorthand, css-shorthand-properties vocab, EXTRA_SHORTHANDS, vendor-prefixed shorthand).
- Added `'marker'` and `'position-try'` to `EXTRA_SHORTHANDS` per spec, so they are caught by the existing `isShorthand()` check (SHORTHANDS ∪ EXTRA_SHORTHANDS) before reaching the pass-through default, and warn-and-dropped with a "shorthand ... is not supported" message rather than the old allow-list-specific "not a recognized Webflow property" message.
- Updated longhand.test.ts: replaced the F071 allow-list-specific tests (`test_AS_069_marker_is_not_in_the_allow_list...`, `test_AS_069_position_try_is_not_in_the_allow_list...`, `test_AS_069_made_up_property_is_warned_and_dropped`, `test_AS_069_css_shorthand_properties_vocab_sweep_never_emits_verbatim_or_leaks_unallowed_props`) with denylist-appropriate equivalents, and added a new regression-guard test `test_AS_069_known_longhands_pass_through_including_width_height_box_shadow` covering width/height/min-width/max-width/min-height/max-height/box-shadow/text-shadow per the spec's manual verification list. `some-made-up-property` now asserts pass-through (denylist model: unknown props are assumed valid longhands, not dropped).

## Out-of-scope work needed
None identified. This is a scoped revert of F071's default-branch model back to F057's denylist model per spec.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
(none — spec was fully prescriptive: exact code for the default branch, exact two properties to add to EXTRA_SHORTHANDS, exact verification list)

## Notes for the next worker
No MCP tools used — pure local TypeScript logic change, no external service touched. The `not a recognized Webflow property` warning message no longer exists anywhere in the codebase (confirmed via grep); any future feature referencing that string must be updated. isShorthand() is unchanged and still covers SHORTHANDS ∪ EXTRA_SHORTHANDS, so marker/position-try now correctly warn-drop with the generic "shorthand '...' is not supported — write longhands instead" message shared by other unimplemented shorthands (background, animation, grid, etc.).
