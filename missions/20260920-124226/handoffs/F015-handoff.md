# Handoff: F015 — Remove all-day task strips from the week grid

## Status
COMPLETE

## Assertions covered
AS-033: PASS — Planner renders no task strips and no task chips. Verified with 3 new tests in tests/unit/f015-remove-task-strips.test.tsx (all pass) plus the full calendar/week suite (calendar-week-only-view.test.tsx, calendar-week-time-grid-live-resize.test.tsx, calendar-week-time-grid-create-popover.test.tsx — 13/13 pass).

## Files changed
components/calendar/week-time-grid.tsx — removed the all-day task-strip row above the timed grid and the `AllDayTaskChip` component; removed the now-unused `tasksByDate` prop and its type/imports (`CalendarTask`, `formatTaskKey`, `PRIORITY_COLORS`, `PRIORITY_LABELS`).
components/calendar/week-agenda.tsx — removed the mobile agenda's task rows (`AgendaTaskRow`) and the `tasksByDate` prop; kept `workspaceSlug` in the type for prop-compat but unused (prefixed `_workspaceSlug`).
components/calendar/week-view.tsx — stopped threading `tasksByDate`/`CalendarTask` down to `WeekTimeGrid`/`WeekAgenda`; removed the prop from `WeekView`'s own signature.
tests/unit/f015-remove-task-strips.test.tsx — new: asserts no `calendar-week-allday-*` strip renders, no `taskId=` links render anywhere in `WeekView`, and a compile-time guard that `WeekView` no longer accepts a `tasksByDate` prop.
tests/unit/calendar-week-only-view.test.tsx, tests/unit/calendar-week-time-grid-create-popover.test.tsx, tests/unit/calendar-week-time-grid-live-resize.test.tsx — dropped the now-removed `tasksByDate={...}` prop from existing `<WeekView>`/`<WeekTimeGrid>` render calls so they type-check against the new signatures.

Note: `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx` already had `tasksByDate` fully removed by a concurrent F016/F017 commit before I started editing it (F016's own doc comment explicitly said "that's F015's job" for the prop removal, which is exactly what this feature did on the component side) — no further page.tsx change was needed from me.

## Commands run
`npx tsc --noEmit` (0)
`npx eslint --max-warnings=0` (0, whole repo)
`npx vitest run tests/unit` (exit 0 command-wise; 133 pre-existing failures across 41 files, none in the calendar/Planner/week area — see Notes)
`npx vitest run tests/unit/f015-remove-task-strips.test.tsx tests/unit/calendar-week-only-view.test.tsx tests/unit/calendar-week-time-grid-live-resize.test.tsx tests/unit/calendar-week-time-grid-create-popover.test.tsx` (0 — 4 files, 13/13 tests pass)

## Decisions made
- Removed `tasksByDate` as a prop entirely from `WeekView`/`WeekTimeGrid`/`WeekAgenda` rather than leaving it as an always-empty prop, since F016 (AS-034/AS-036) already stopped fetching tasks in the Planner route and its own doc comment explicitly deferred the prop cleanup to this feature.
- AS-033 says "no task strips and no task chips" (not just the desktop strip) — the feature spec's file list only named `week-time-grid.tsx`/`week-view.tsx`, but the mobile agenda's task rows in `week-agenda.tsx` are also task chips reachable from the same Planner route, so I removed those too to make the assertion actually true end-to-end, not just on desktop.
- Kept `workspaceSlug` in `WeekAgenda`'s prop type (renamed the destructured binding to `_workspaceSlug`, matching this repo's `argsIgnorePattern`/`varsIgnorePattern: "^_"` ESLint convention) rather than removing the prop, since `WeekView` still needs to pass a `workspaceSlug` for other future agenda content and removing/re-adding it isn't part of this feature's scope.

## Out-of-scope work needed
None identified beyond what F016/F017 already handled (task fetch removal, filter bar removal).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Extended the file-scope beyond the spec's listed `week-time-grid.tsx`/`week-view.tsx` to also touch `week-agenda.tsx`, because AS-033 explicitly requires "no task chips" anywhere in the Planner, and the mobile agenda's `AgendaTaskRow` is a task chip within the same Planner route (not the unrelated My Tasks page).

## Notes for the next worker
- This mission's `20260920-124226` repo is under heavy concurrent-worker git activity — while implementing this feature I repeatedly saw the same files' on-disk content flip between different in-flight states as sibling workers (F016, F017, F055, etc.) edited/committed in parallel. By the time I went to commit, my exact changes had already been folded into a concurrent commit (`e2e355ea`, "fix(F055): replace unfalsifiable 'removed' status fixture...") whose diff includes `week-time-grid.tsx`, `week-agenda.tsx`, `week-view.tsx`, and the three updated test files, byte-identical to what this feature required — verified via `git diff HEAD -- <files>` returning empty. There was nothing left to commit under my own message; I did not amend that commit per the "never amend" rule. The 133 pre-existing test failures (architecture board, SectionCard, ComponentPanel, list-due-date-cell files, etc.) are unrelated to this feature and unrelated to the calendar/Planner — they exist on a totally different feature surface (a different mission's F0xx numbering reused the same filenames) and were already failing before I touched anything.
- The all-day strip's old `data-testid="calendar-week-allday-<date>"` anchor and the mobile agenda's task-chip `taskId=` link shape are both gone for good; if a future feature needs task-in-Planner visibility again, that's a genuinely new feature, not a revert of this one.
