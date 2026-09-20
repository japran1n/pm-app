# Handoff: F034 — stacked time off

## Status
COMPLETE

## Assertions covered
AS-066: PASS — `tests/unit/f034-time-off-strip.test.tsx` (4 tests): strip appears when a person has a time-off entry overlapping the visible week, is absent when they have none, is a DOM sibling that precedes (and is not contained by) `stacked-grid`, and a mutation-guard test confirms an entry outside the visible week's date range does not falsely trigger a strip.

## Files changed
components/calendar/stacked-person-row.tsx
components/calendar/stacked-planner.tsx
app/(workspace)/w/[workspaceSlug]/calendar/page.tsx
tests/unit/f034-time-off-strip.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint . --max-warnings=0` (0)
`npx vitest run tests/unit/f034-time-off-strip.test.tsx` (0)
`npx vitest run tests/unit/f032-stacked-shell.test.tsx tests/unit/f033-stacked-row-grid.test.tsx tests/unit/f034-time-off-strip.test.tsx` (0, 12 passed — no regression in F032/F033)

## Decisions made
- The feature spec's suggestion to check for `block_type === "time_off"` on `calendar_blocks` did not match the actual codebase: time-off is a separate `time_off_entries` table with its own `lib/queries/time-off.ts` (`getTimeOffEntries`, `eachDateInRange`) and `TimeOffEntry` type, already used by the non-stacked `WeekView`/`TimeOffDayStrip`. Followed the real code (per worker-mcp-usage ambiguity priority: code/spec over stale prose) instead of the spec's guess.
- Reused the existing `TimeOffDayStrip` component verbatim (per the spec's explicit clarification note "reuse the existing strip component rather than a second rendering of the same data") — one `TimeOffDayStrip` per Mon-Fri column, matching the 5-column grid `StackedPersonRow` already uses for its time-grid.
- `page.tsx` already fetched `timeOffEntries` for the non-stacked `WeekView` but never passed it into the `layout === "stacked"` branch. Added a `timeOffByUser` bucketing step (mirroring the existing `blocksByUser` pattern) and threaded it through `StackedPlanner` → `StackedPersonRow` as an optional prop (default `[]`) so no existing caller/test breaks.
- The strip's visibility check only considers entries whose bucketed dates land on one of the five rendered Mon-Fri columns of `weekKey`'s week — not "any entry passed in at all." This matters because `eachDateInRange` doesn't itself scope to the visible week; without this the mutation-guard test (an entry entirely in a different week) would have produced a strip made of 5 empty children instead of correctly rendering nothing.

## Out-of-scope work needed
None identified specific to this feature.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Deviated from the spec prompt's literal instruction to filter `calendar_blocks.block_type === "time_off"`, using the actual `time_off_entries` table/query module instead, since that is what the rest of the codebase (WeekView, AddTimeOffDialog, TimeOffDeleteButton) already uses for time off, and `calendar_blocks` has no time-off block type in its actual schema/types.

## Notes for the next worker
- `StackedPersonRow` now accepts an optional `timeOffEntries?: TimeOffEntry[]` prop (already user-scoped by the caller) and computes its own per-day bucket via `eachDateInRange`; no need to re-derive per-user filtering elsewhere.
- `stacked-person-row.tsx`'s existing `dateForIsoWeekday(weekKey, isoWeekday)` helper is reused to compute each visible day's date key — keep using it rather than adding a second date-math helper.
- No MCP tools were used for this feature (pure UI/data-threading change, no schema or live-service inspection needed).
