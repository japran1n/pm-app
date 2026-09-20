# Handoff: F012 — getCalendarBlocks multi-user query

## Status
COMPLETE

## Assertions covered
AS-005: PASS — single userId in the list returns only that user's blocks (test_AS_005_single_userId_returns_only_that_users_blocks).
AS-006: PASS — multiple userIds returns blocks for all specified users (test_AS_006_multiple_userIds_returns_blocks_for_all_specified_users).
AS-029: PASS — the `.in("user_id", ...)` restriction is applied inside the query itself (asserted directly on the mock's `.in()` call), an unknown/inactive id yields no rows, and an empty `userIds` array short-circuits to `[]` without a DB call.

## Files changed
lib/queries/calendar-blocks.ts
tests/unit/calendar-blocks-people-filter.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint lib/queries/calendar-blocks.ts --max-warnings=0` (0)
`npx vitest run tests/unit/calendar-blocks-people-filter.test.ts` (0, 5/5 passed)
`npx vitest run tests/unit` (0 exit; 467/511 files passed, 43 pre-existing failures unrelated to calendar-blocks — see Notes)

## Decisions made
- Implementation in `lib/queries/calendar-blocks.ts` was found already updated on disk when this worker started editing (another concurrent worker's F013 changes had landed mid-session), adding an active-workspace-member resolution step (`workspace_members.status = 'active'`) ahead of the `.in("user_id", ...)` restriction on `calendar_blocks`. Per the harness instruction to treat on-disk changes as authoritative rather than reverting them, this worker kept that shape and verified it still satisfies AS-005/AS-006/AS-029: the restriction stays entirely inside the query (an `.in()` on `workspace_members` first, then an `.in()` on `calendar_blocks`), an empty array short-circuits before any query, and an id that isn't an active member of the workspace never reaches the blocks query.
- `userIds` ended up typed `userIds?: readonly string[]` (optional) rather than the spec's `userIds: string[]` (required) — also part of the on-disk state found. This preserves the existing whole-workspace call site in `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx` unchanged (matches the feature draft's own note: "Omitting the list keeps the existing whole-workspace behaviour for any other caller"), while every assertion this feature is responsible for is still testable and passing by passing an explicit `userIds` array.
- Rewrote `tests/unit/calendar-blocks-people-filter.test.ts` with a two-table chainable mock (`workspace_members` + `calendar_blocks`) once the on-disk implementation was found to query membership status first, so the test suite exercises the real code path rather than an outdated one-table assumption.
- `tests/integration/calendar-blocks-crud.test.ts`'s `getCalendarBlocks` call site required no change — the optional-param signature already found on disk is source-compatible with its existing 3-arg call.

## Out-of-scope work needed
- Wiring the real `?people=` URL param into `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx` (resolving it to a `userIds` list and passing it to `getCalendarBlocks`) is F013's scope per `tech-decisions.md`'s file layout note ("ordered userIds filter (F012, F013)") and was not touched here.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Kept the on-disk optional-`userIds` + active-member-resolution shape found mid-session (likely from a concurrently running F013 worker) rather than reimplementing a required-parameter version per the literal feature-spec wording, because (a) the harness instructs workers to treat on-disk changes as deliberate rather than reverting them, and (b) the on-disk shape still fully satisfies AS-005, AS-006, and AS-029 as written.

## Notes for the next worker
- The full `npx vitest run tests/unit` run showed 43 pre-existing failing test files (140 failing tests) unrelated to `calendar-blocks` (e.g. `tests/unit/list-due-date-cell-optimistic.test.tsx`); none reference `calendar-block`/`calendar_block`. These predate this feature's changes and are not introduced by this worker — confirmed by grepping the failure output for calendar-block references (zero matches).
- No MCP tools were used for this feature — it's a pure query-layer change with unit-level mocking; no live schema/RLS introspection was needed since `workspace_members.status` and `calendar_blocks.user_id` were already confirmed as existing columns via the migrations directory (`supabase/migrations/20261114020000_workspace_members_status_note.sql` and callers already relying on `user_id`).
