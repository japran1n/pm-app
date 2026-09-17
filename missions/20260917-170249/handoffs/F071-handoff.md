# Handoff: F071 — FU-J longhand allowlist inversion

## Status
COMPLETE

## Assertions covered
AS-069: PASS — `expandDeclaration`'s default branch now inverts to a `LONGHAND_ALLOW_LIST` allow-list (built from `PASS_THROUGH` + every key emitted by the expander functions + the common CSS longhand vocabulary given in the spec). Unknown/unrecognized properties — including the round-6 regressions `marker` and `position-try` — are now warned-and-dropped instead of passed through verbatim. Verified with `npx vitest run lib/webflow-converter/` (251/251 passing, including new tests `test_AS_069_marker_is_not_in_the_allow_list_and_is_warned_and_dropped`, `test_AS_069_position_try_is_not_in_the_allow_list_and_is_warned_and_dropped`, `test_AS_069_color_is_on_the_allow_list_and_passes_through`, `test_AS_069_display_is_on_the_allow_list_and_passes_through`, `test_AS_069_made_up_property_is_warned_and_dropped`, and a full sweep test `test_AS_069_css_shorthand_properties_vocab_sweep_never_emits_verbatim_or_leaks_unallowed_props` covering the independent `css-shorthand-properties` vocab plus `marker`/`position-try`).

## Files changed
lib/webflow-converter/longhand.ts
lib/webflow-converter/longhand.test.ts

## Commands run
`npx vitest run lib/webflow-converter/` (0) — 251/251 passing
`npx tsc --noEmit` (0)
`npm run lint` (0)
`npx vitest run` (background, full repo) — 173 unrelated pre-existing failures, all in `tests/integration/*` requiring live Supabase network access (`TypeError: fetch failed`), unrelated to this feature's scope (`lib/webflow-converter/`)

## Decisions made
- Built `LONGHAND_ALLOW_LIST` exactly as specified: `PASS_THROUGH` ∪ all keys emitted by the expander functions (margin/padding/inset sides, border-*-width/style/color, border-radius corners, row-gap/column-gap, overflow-x/y, align-*/justify-*, transition-*, flex-*, outline-*, list-style-*, font-*) ∪ the given common-CSS-longhand vocabulary list.
- Default branch order is: global-keyword guard → explicit `switch` cases (box rule, border family, gap/overflow/place-*, transition, flex/flex-flow, outline, list-style, font, unsupported named shorthands) → `default` branch, which now checks `PASS_THROUGH` → known-shorthand/vocab/extra-shorthand/vendor-shorthand checks (unchanged, still warn-and-drop) → `LONGHAND_ALLOW_LIST` (new: allow verbatim) → final fallback: warn-and-drop with message `'<prop>' is not a recognized Webflow property — declaration dropped`.
- Fixed one of my added tests (`test_AS_069_css_shorthand_properties_vocab_sweep_...`) mid-implementation: it originally asserted `decls` must be `{}` for every property in the `css-shorthand-properties` vocab, but properties with a dedicated expander (e.g. `list-style` → `list-style-type`) legitimately produce non-empty `decls` with real longhand keys. Corrected the assertion to check only that the shorthand's own key is never leaked verbatim, matching the pattern already used by the pre-existing `test_AS_069_default_branch_never_emits_a_shorthand_key_verbatim` test.

## Out-of-scope work needed
None additional beyond what's already tracked — this feature's fix is self-contained to `expandDeclaration`'s default branch.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: While reading the file, I discovered `lib/webflow-converter/longhand.ts` and `longhand.test.ts` were being concurrently modified on disk by another parallel worker in this shared multi-agent run (working on `isColor`/`isWidth` fixes for AS-055/AS-056/AS-067 — e.g. adding an explicit `NAMED_COLORS` set and widening `isWidth`'s unit regex). My `LONGHAND_ALLOW_LIST` edit was clobbered once mid-task by that concurrent write and had to be reapplied. When I ran `git commit`, the other worker's process had already committed the shared working tree (including my `LONGHAND_ALLOW_LIST` changes) under commit `5221dcf0` ("fix(AS-055,AS-056,AS-067): explicit color classifier, widen isWidth to modern CSS units"), so my own `git commit` found nothing left to stage. I verified via `git show HEAD -- lib/webflow-converter/longhand.ts` that the `LONGHAND_ALLOW_LIST` constant and the inverted default branch (with the exact warning text `'${p}' is not a recognized Webflow property — declaration dropped`) are present at `HEAD` (commit `5221dcf0`), and reran the full scoped test/typecheck/lint suite against that HEAD to confirm everything is green. I did not attempt to force a separate commit or rewrite history, since the code is correctly present and tested at HEAD and creating a duplicate/empty commit would be destructive busywork in a shared, actively-changing working tree.

## Notes for the next worker
- The fix for AS-069 (the `LONGHAND_ALLOW_LIST` inversion) landed in git history at commit `5221dcf0`, not under a commit with "AS-069" in the message — the commit message reflects concurrent work from another worker (AS-055/AS-056/AS-067) that raced ahead and captured the shared working tree at commit time. If a validator greps commit messages for `AS-069`, it should also check the actual diff at `5221dcf0` (and the surrounding history) rather than relying solely on message text.
- This repo/mission run appears to have multiple worker subagents operating against the same working directory concurrently (visible via the many `agent-*.jsonl` symlinks in the scratchpad tasks directory and the live on-disk file changes observed mid-task). Future workers on files under active parallel edit should expect edits to be clobbered and should re-verify file state with `grep`/`git show HEAD` before assuming their `Edit` calls are the final state, and should not be surprised if `git commit` reports "nothing to commit" after another worker's concurrent commit already captured their changes.
- The pre-existing test `test_AS_055_unrecognized_token_drops_whole_declaration` (border `'slid'` treated as an unrecognized token) was failing at one point during this session due to `isColor`'s old blanket `/^[a-z]+$/` named-color check; this was fixed by the concurrent AS-055/AS-056/AS-067 worker (added `NAMED_COLORS` set) and is unrelated to F071/AS-069.
