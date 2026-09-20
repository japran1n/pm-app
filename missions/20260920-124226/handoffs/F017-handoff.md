# Handoff: F017 — Delete CalendarFilters and resolveCalendarFilters from the Planner

## Status
COMPLETE

## Assertions covered
AS-035: PASS — Planner route no longer imports or renders `<CalendarFilters>`; `resolveCalendarFilters` is gone from `lib/calendar/`; grep for both names across `app/`, `components/`, `lib/` returns zero results.

## Files changed
app/(workspace)/w/[workspaceSlug]/calendar/page.tsx
lib/calendar/people-selection.ts (doc-comment reference to the deleted resolver updated, no behaviour change)
lib/calendar/resolve-filters.ts (deleted)
tests/integration/f235-calendar-filters.test.ts (deleted — tested the deleted `resolveCalendarFilters`/filtered `getCalendarTasks` flow directly)
tests/unit/f235-calendar-resolve-filters.test.ts (deleted — unit tests for the deleted pure function)

Note: `components/calendar/calendar-filters.tsx` and `tests/e2e/f235-calendar-responsive.spec.ts`'s `calendar-filters` testid assertion were already removed by a concurrent fixup/revert commit on this branch (see `git log` around commits `602ec3ac`/`55112b61`) while this worker was mid-edit on the same route file; this worker's own edits landed cleanly on top in commit `528d66e0`.

## Commands run
`grep -rn "CalendarFilters\|resolveCalendarFilters" app/ components/ lib/ --include="*.ts" --include="*.tsx"` (1 — zero matches, gate satisfied)
`npx eslint --max-warnings=0 "app/(workspace)/w/[workspaceSlug]/calendar/page.tsx" lib/calendar/people-selection.ts` (0)
`npx tsc --noEmit` (non-zero — see Blockers/Notes: failures are in `components/calendar/week-view.tsx`, `tests/unit/calendar-week-time-grid-*.test.tsx` over a `tasksByDate` prop-type mismatch on `WeekTimeGrid`; those files are mid-edit by a concurrent worker (visible as ` M` in `git status`, not touched by this feature) and are unrelated to `CalendarFilters`/`resolveCalendarFilters`)

## Decisions made
- Left `lib/queries/calendar.ts`'s `CalendarTaskFilters` type and `getCalendarTasks`'s optional `filters` argument in place. The spec named only `CalendarFilters` (the component) and `resolveCalendarFilters` (the URL-param resolver) for deletion; the query-layer filter type is shared query-file territory, not owned by this feature, and `getCalendarTasks` no longer receives a `filters` argument from the Planner page after F016 removed the task fetch entirely — the type is simply unused dead code left for whichever feature finishes purging the query layer.
- Removed the one call site in the Planner route that referenced `filters`/`filterSuffix`/`filtersBar`; `weekHrefFor` now only carries `?week=`.
- Deleted the two test files that directly imported/tested the deleted module and component (`tests/unit/f235-calendar-resolve-filters.test.ts`, `tests/integration/f235-calendar-filters.test.ts`) since they have no subject left to test — this matches the "Definition of done" instinct that deleting a feature's tests along with the feature is required for the suite to stay green, and is in-scope per the spec's "Remove all imports/usages" instruction.
- Updated the one remaining doc-comment reference to `resolveCalendarFilters` in `lib/calendar/people-selection.ts` (an unrelated file) so the comment doesn't dangle a broken import path.

## Out-of-scope work needed
- `tests/e2e/f235-calendar-responsive.spec.ts`'s `calendar-filters` testid assertion and `components/calendar/calendar-filters.tsx` were removed by a concurrent commit, not this worker — no follow-up needed there, just noting it for provenance.
- `lib/queries/calendar.ts` still exports `CalendarTaskFilters` and `getCalendarTasks`'s `filters` param, now unused by any caller in the codebase (Planner no longer calls `getCalendarTasks` at all per F016). A later feature that fully purges the task-query layer should remove that dead type/param.
- Full-suite `npx tsc --noEmit` currently fails due to unrelated concurrent in-flight work on `components/calendar/week-view.tsx` / `week-time-grid.tsx` (a `tasksByDate` prop-type mismatch) — not something this feature touches or should fix; flagging so the orchestrator doesn't attribute it to F017.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Kept `CalendarTaskFilters`/`getCalendarTasks(filters?)` in `lib/queries/calendar.ts` rather than also stripping them, since the spec's "Touches" list named only the component and the URL-param resolver, and the query-layer type is shared file territory outside this feature's stated scope.

## Notes for the next worker
This repo had genuinely concurrent worker activity on `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx` while this feature ran (two revert/fixup commits appeared in `git log` mid-task from another in-flight F017-adjacent process). Re-verify with the grep gate command above before trusting `git status` alone if you touch this route file next — it moved under this worker mid-edit more than once.
