# Handoff: F044 — Fix AS-024: kill MUT-R with single-space input in test

## Status
COMPLETE

## Assertions covered
AS-024: PASS — `test_AS_024_quick_action_close_without_navigate_clears_the_tombstone_map` in `tests/unit/f038-as024-coverage.test.ts` now exercises the real vulnerable state (single-space query keeps the realtime subscription alive while quick actions are already visible) and fails when `resetPaletteState()` is removed from the quick-action close branch (command-palette.tsx:447), confirmed by manual mutation test (removed the call, reran, test failed; restored, reran, test passed).

## Files changed
tests/unit/f038-as024-coverage.test.ts

## Commands run
`npx vitest run tests/unit/f038-as024-coverage.test.ts` (0)
`npx vitest run tests/unit/f038-as024-coverage.test.ts tests/unit/palette-actions-recents.test.tsx` (0)
`npm run lint` (0 errors, pre-existing unrelated warnings only)
`npx tsc --noEmit` (0)

Mutation verification (not committed, reverted after confirming):
- Removed `resetPaletteState();` at command-palette.tsx:447 → `npx vitest run tests/unit/f038-as024-coverage.test.ts` → 1 failed / 3 passed (proves the test now kills this mutant)
- Restored the line → reran → 4 passed

## Decisions made
- Root-caused the exact bug the scrutiny validator described: `hasQuery` (consumer/quick-actions gate) uses `query.trim().length > 0`, but `usePaletteSearchRealtime`'s internal subscription-teardown gate (`lib/hooks/use-palette-search-realtime.ts:69`) uses raw `query.length === 0`. A single-space query (`" "`) is judged "empty" by the trimmed gate (so quick actions render) but "non-empty" by the untrimmed gate (so the realtime channel stays subscribed).
- Reordered the test: previously it fired the DELETE event, then changed the query to `""` to reveal quick actions (which cleared the patch map on the same "transition to empty" step that revealed the actions, making `resetPaletteState()` an equivalent mutant with respect to the patch map). Now it changes the query to `" "` FIRST (revealing quick actions while the subscription stays alive), THEN fires the DELETE event (which the subscription still processes, populating a tombstone in `realtimePatches` while quick actions are already showing). Only the quick action's own `resetPaletteState()` call can now clear that tombstone before the next search.
- Replaced the "equivalent mutant" comment with an accurate description of the trim/no-trim discrepancy and why the space-query ordering makes the assertion meaningful.
- Did not touch `components/command/command-palette.tsx` or `lib/hooks/use-palette-search-realtime.ts` — this feature is scoped to the test fix only, per the task description. The trim/no-trim gate discrepancy itself is a pre-existing, real (if narrow) inconsistency in the source, not something this task was scoped to change.

## Out-of-scope work needed
None identified beyond what's already covered — the underlying gate discrepancy (trimmed vs. untrimmed empty-query check) is real but is exactly the scenario AS-024's `resetPaletteState()` call was designed to guard against, and it's now correctly tested rather than being a source-code defect requiring its own fix. If the team later wants the two gates to be textually consistent (e.g. both trimmed), that would be a separate, explicitly-scoped refactor feature since it changes production behavior, not just test coverage.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
(none beyond what's documented above; task description was fully specific)

## Notes for the next worker
The key gotcha for anyone touching command palette realtime/query logic: there are two "is the query empty" checks in this feature that must stay in sync in spirit even though one is on the raw input string (subscription teardown) and one is on the trimmed string (UI gating). AS-024's regression test now pins this exact edge case (`" "` input) so any future change that further decouples these two checks should be caught here.
