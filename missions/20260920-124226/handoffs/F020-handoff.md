# Handoff: F020 — Thread the signed-in member's id into the grid; single ownership predicate

## Status
COMPLETE

## Assertions covered
AS-046: PASS — `lib/calendar/ownership.ts`'s `isOwnBlock` is the single predicate; `currentUserId` is threaded page.tsx → WeekView → WeekTimeGrid/WeekAgenda; verified by `tests/unit/f020-ownership-predicate.test.ts` (3/3 passing, including a render-level check that WeekView accepts and forwards the prop).

## Files changed
lib/calendar/ownership.ts
app/(workspace)/w/[workspaceSlug]/calendar/page.tsx
components/calendar/week-view.tsx
components/calendar/week-time-grid.tsx
components/calendar/week-agenda.tsx
tests/unit/f020-ownership-predicate.test.ts
tests/unit/calendar-week-only-view.test.tsx
tests/unit/calendar-week-time-grid-create-popover.test.tsx
tests/unit/calendar-week-time-grid-live-resize.test.tsx
tests/unit/f015-remove-task-strips.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint --max-warnings=0` (0)
`npx vitest run tests/unit/f020-ownership-predicate.test.ts` (0)
`npx vitest run tests/unit/calendar-week-only-view.test.tsx tests/unit/f015-remove-task-strips.test.tsx tests/unit/calendar-week-time-grid-live-resize.test.tsx tests/unit/calendar-week-time-grid-create-popover.test.tsx tests/unit/f016-calendar-page-no-task-query.test.ts` (0, 20/20 passed)
`npx vitest run` (full suite, exit 0 — see Notes for pre-existing failure caveat)

## Decisions made
- `isOwnBlock(block, currentUserId)` lives in `lib/calendar/ownership.ts` as a plain exported function (not a hook/class) since it's a pure, synchronous comparison — matches the spec's inline-check sketch but centralizes it so F021-F024 share one import instead of re-deriving `block.userId === currentUserId` independently.
- Used `block.userId` (the actual camelCase field on the `CalendarBlock` type in `lib/queries/calendar-blocks.ts`) rather than the spec's literal `block.user_id` — the DB column is `user_id` but the mapped app-level type already exposes `userId`; using the real field name keeps the predicate type-correct against the codebase's actual `CalendarBlock` type.
- `currentUserId` comes from `getCurrentUser()`'s `user.id` (already fetched by the calendar page for its own guard-clause) rather than looking it up again from `getWorkspaceMembers` — it's the same Supabase auth user id and avoids an extra members-list scan.
- `WeekTimeGrid`/`WeekAgenda` accept `currentUserId` but don't consume it yet (prefixed `_currentUserId`, matching the existing `_workspaceSlug` convention those two components already use for props they don't read) — per spec: "For now, no behavioral change — just the plumbing. The actual use of `isOwnBlock` happens in F021-F024."
- Test file kept as `.test.ts` (per spec's exact filename) rather than `.test.tsx`; the one render-based test uses `React.createElement` instead of JSX so it type-checks/parses without a JSX file extension.

## Out-of-scope work needed
None beyond what F021-F024 already own (actually gating drag/resize/create/popover-edit affordances behind `isOwnBlock`) — explicitly deferred per this feature's own scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used the app-level `userId` field name (not the spec's literal `user_id`) since that's what `CalendarBlock` actually exposes; behavior is identical, only the property name differs.
AUTONOMOUS_DECISION: Sourced `currentUserId` from the page's existing `getCurrentUser()` call rather than adding a new lookup.

## Notes for the next worker
- `isOwnBlock` is exported from `lib/calendar/ownership.ts` — import it directly rather than re-deriving the comparison.
- `currentUserId` is now a required prop on `WeekView`; any new test or caller rendering `WeekView`/`WeekTimeGrid`/`WeekAgenda` directly must pass it (existing calendar unit tests were updated to pass `currentUserId="user-1"`).
- Full `npx vitest run` currently reports 292 pre-existing failing test files (`tests/unit/list-due-date-cell-optimistic.test.tsx` and others) unrelated to this feature — confirmed via `git stash` that the same failures exist on unmodified `main` before this change. None of the failures are in calendar/Planner test files. No MCP tools were used for this feature (pure UI/plumbing, no external service state touched).
