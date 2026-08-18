# Handoff: F113 — task time ui

## Status
COMPLETE

## Assertions covered
AS-171: PASS — task detail sheet's TimeTracking section computes total from `timeEntries[].minutes` and displays "Xh Ym"; TaskCard shows a Clock icon + "Xh Ym" indicator when `totalMinutes` is passed and > 0. Covered by tests/unit/format-duration.test.ts (the formatting helper) and tests/integration/task-detail-sheet-time-total.test.ts (TimeTracking's total display + wiring into task-detail-sheet.tsx).

## Files changed
lib/time/format-duration.ts (new)
components/task/time-tracking.tsx (new)
components/task/task-detail-sheet.tsx
components/task/task-card.tsx
tests/unit/format-duration.test.ts (new)
tests/integration/task-detail-sheet-time-total.test.ts (new)

## Commands run
`npx tsc --noEmit -p .` (0)
`npm run lint` (0, 1 pre-existing unrelated warning in lib/queries/search.ts)
`npm run test` (0) — 497/497 tests pass
`npm run build` (0)

## Decisions made
- Total logged time is computed client-side by summing the `timeEntries` prop's `minutes` on every render, rather than adding a new aggregate query — the spec explicitly allows "compute from a passed-in list", and this keeps the total trivially consistent with the entry list rendered right below it (same array, no separate round trip that could disagree).
- `activeTimer` prop on TimeTracking is a narrow `{ taskId, startedAt } | null`, not F111's full `ActiveTimer` query type (which also joins task title/project) — the component only needs "is a timer running, and is it on this task" to pick between Start/Stop+elapsed/"switch here", so it doesn't need the extra joined fields.
- Elapsed counter is a client-side `setInterval` (1s tick) purely for display, per the spec's Clarified implementation — it recomputes from `activeTimer.startedAt` on every tick rather than accumulating, so it can never drift from what `stop_timer_atomic` will actually compute server-side.
- No dedicated Checkbox/Switch shadcn component exists in this repo yet (`ls components/ui/` has no checkbox.tsx) — used a plain `<input type="checkbox">` styled with `size-4 rounded border-input` (matching the existing Input's border token) rather than installing a new shadcn component, since the spec only calls for "billable toggle/checkbox" and this keeps the diff scoped to this feature's files.
- Edit affordance is author-only (AS-169, no admin override) and delete is author-or-admin/owner (AS-170), mirroring `canEdit`/`canDelete` naming and the `isAdminOrOwner` helper pattern already used by CommentList/AttachmentList. Both are UI-affordance-only; `editTimeEntry`/`deleteTimeEntry` (F112) independently re-check authorization server-side regardless.
- `timeEntries` and `activeTimer` are both optional props on TaskDetailSheet defaulting to `[]` / `null`, matching the existing `comments`/`attachments` convention — a caller that hasn't been updated yet still renders a valid empty state (no active timer, "No time logged yet.") rather than crashing.
- `TaskCard`'s new `totalMinutes` field is optional and defaults to hidden — no existing caller (board.tsx, list view) was touched, so this ships non-breaking; a future feature can thread a real aggregate into that prop when a getTaskTimeEntries-style query/aggregate exists.

## Out-of-scope work needed
- There is no `lib/queries/time-entries.ts` list/aggregate query yet for fetching a task's `time_entries` rows or a project's/task's total minutes server-side (only `getActiveTimer` exists from F111). A future feature should add a `getTaskTimeEntries(taskId)` query (mirroring `getTaskComments`) and wire it into whatever Server Component page renders TaskDetailSheet/TaskCard, passing `timeEntries`/`totalMinutes` end-to-end so the UI built here is actually populated with live data instead of relying on a caller to pass it. AS-172 (project header totals, billable/non-billable split) and AS-173 (per-person time report) are separate features (F108-F112's assertion list already scopes AS-172/AS-173 elsewhere) and were not touched here — only AS-171 (task-level total) was in this feature's scope.
- `getActiveTimer` is not currently called from any page/loader that feeds `activeTimer` into TaskDetailSheet — same pattern as the point above; a future wiring feature should call it alongside the task/comments/attachments fetch.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used a plain native `<input type="checkbox">` for the billable toggle since no shadcn Checkbox/Switch component exists in this repo yet, rather than installing a new shadcn component (out of scope for this feature and would touch components/ui/, a shared surface with no established need beyond this one form).
AUTONOMOUS_DECISION: Time entry list is sorted newest-first (by entryDate desc) since the spec didn't specify an order and no existing "time entries" ordering convention exists elsewhere in the codebase (comments use oldest-first, which reads naturally for a conversation; a log of dated time entries reads more naturally most-recent-first, similar to how expense/timesheet UIs typically order).

## Notes for the next worker
- `components/task/time-tracking.tsx` exports `TimeTracking`, `TimeEntry`, `TimeTrackingMember`, and `TimeTrackingActiveTimer` — reuse these types rather than re-declaring when wiring real data fetching in a follow-up feature.
- `lib/time/format-duration.ts` exports `formatDuration(minutes: number): string` — this is now the single source of truth for "Xh Ym" rendering; reuse it for AS-172 (project totals) and AS-173 (per-person report) rather than reimplementing.
- `tests/unit/board-task-detail-sheet-wiring.test.ts` documents an important gotcha reused here: the shadcn `Sheet` only portals/renders its content client-side, so `renderToStaticMarkup` on `<TaskDetailSheet open>` produces empty content regardless of the `open` prop. The DoD's "integration test: task detail sheet shows the correct total after logging entries" is therefore implemented as (1) a direct SSR render of `<TimeTracking>` (the component TaskDetailSheet composes) proving the total computes/displays correctly, plus (2) a source-inspection check proving task-detail-sheet.tsx actually wires its `timeEntries` prop into that same `<TimeTracking>` — same two-part pattern the board-wiring test already established for exactly this SSR/Sheet limitation.
