# Handoff: F043 — harden people param parser

## Status
COMPLETE

## Assertions covered
AS-004: PASS — `?people=all` (including ` all ` with whitespace and `all,` with a trailing comma) resolves to every active member, in `activeMemberIds` order.
AS-008: PASS — when every id is invalid, or the `all` path is given an empty roster, the parser falls back to `[selfId]` rather than an empty list.

## Files changed
lib/calendar/people-selection.ts
tests/unit/planner-people-selection.test.ts

## Commands run
`npx vitest run tests/unit/planner-people-selection.test.ts` (0) — 24 passed
`npx tsc --noEmit` (1, but only due to pre-existing unrelated uncommitted changes in lib/calendar/stacked-window.ts / tests/unit/planner-stacked-window.test.ts that were already present in the working tree before this feature started and are untouched by this feature — see Notes)

## Decisions made
- Trimmed and stripped a single trailing comma from the raw value before comparing to the `"me"`/`"all"` literals, per spec: `const trimmed = (raw ?? "").trim().replace(/,$/, "").trim()`. The comma-list parsing path still splits on the original `raw` string since trailing/empty segments are already dropped there via `if (!id) continue`.
- On the `"all"` path, if `activeMemberIds` is empty, return `[selfId]` instead of `[]`, matching the AS-008 "never returns an empty array" behaviour already documented for the id-list path.
- Added the required AS-004/AS-008 regression tests plus the specified AS-010 non-adjacent-duplicate test (this behaviour was already correctly implemented via the `seen` Set — the new test simply pins it down explicitly with the `a,b,a` case named in the spec).

## Out-of-scope work needed
None for this feature. Noting for the orchestrator: `lib/calendar/stacked-window.ts` and `tests/unit/planner-stacked-window.test.ts` have pre-existing uncommitted modifications in the working tree (present before this worker started, confirmed via `git stash`) that currently break `npx tsc --noEmit` with `TS2339` errors on `StackedBlockClipped[]`. This is unrelated to F043's scope (people-selection.ts) and was not touched by this worker. Orchestrator should track which feature owns those files and get them committed/fixed.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Verified via `git stash`/`git stash pop` that the pre-existing `npx tsc --noEmit` failures come entirely from already-modified, uncommitted files outside this feature's scope (lib/calendar/stacked-window.ts and its test), not from any change made in this feature. Proceeded to mark this feature COMPLETE since `lib/calendar/people-selection.ts` and its test file type-check and test clean in isolation, and the feature spec's "Touches" scope is limited to those two files.

## Notes for the next worker
Full-repo `npx tsc --noEmit` will show 4 errors from `tests/unit/planner-stacked-window.test.ts` (`Property 'starts_at'/'ends_at' does not exist on type 'StackedBlockClipped[]'`) until whichever feature owns `lib/calendar/stacked-window.ts` finishes and commits its work. Confirmed via `git stash` that these errors exist independent of this feature's changes.
