# Handoff: F101 — Fix AS-064 drag-listeners test (mocked-away DndContext)

## Status
COMPLETE

## Assertions covered
AS-064: PASS — new test `test_AS_064_drag_listeners_wired_to_handle` in `tests/unit/f035-stacked-reorder.test.tsx` reads the raw source of `components/calendar/stacked-planner.tsx` and asserts `{...listeners}` is spread onto a JSX element. Verified the mutation (deleting `{...listeners}` at line 76 of stacked-planner.tsx) makes this new test fail while all other tests in the file still pass — confirms it's the guard that was missing.

## Files changed
tests/unit/f035-stacked-reorder.test.tsx

## Commands run
`npx vitest run tests/unit/f035-stacked-reorder.test.tsx` (0) — 6/6 passed
`npx tsc --noEmit` (0)
`npx eslint . --max-warnings=0` (0)
mutation check: temporarily deleted `{...listeners}` from stacked-planner.tsx line 76, re-ran the target test file — 1 failed / 5 passed (the new AS-064 test failed as required), then restored the file via `git diff --stat` verification (clean, no diff) before committing.

## Decisions made
- Followed spec's Option A exactly: added a source-text regex test rather than rewriting the dnd-kit mock (Option B), since Option A is called out in the spec as the primary fix and is simpler/lower-risk — it doesn't touch the existing mock behavior that other tests in the file rely on.
- Placed the new test in its own `describe` block ("F035 stacked planner wires listeners, not just attributes") right before the existing SortableContext source-check describe block, keeping source-text checks grouped together.

## Out-of-scope work needed
None identified beyond this fix.

## Blockers
None.

## Autonomous decisions
None — spec's Option A test code was used near-verbatim with added comments explaining the gap it closes.

## Notes for the next worker
- No MCP usage — this is a pure test-file change with no external service touched.
- Verified `components/calendar/stacked-planner.tsx` was left byte-identical (no diff) after the mutation experiment before committing only the test file.
