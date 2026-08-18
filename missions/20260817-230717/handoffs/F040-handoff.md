# Handoff: F040 — overdue indicator

## Status
COMPLETE

## Assertions covered
AS-063: PASS — isOverdue/TaskCard/TaskDetailSheet place no restriction on due dates in the past; editTask's existing due-date validation (lib/validation/tasks.ts) is untouched, so past dates continue to be accepted.
AS-064: PASS — tests/unit/is-overdue.test.ts covers past+non-done=true, past+done=false, future=false, null=false, today=false, invalid-date=false; TaskCard (board/list surface) and TaskDetailSheet (detail surface) both call isOverdue() and render red text + a TriangleAlert icon when true.

## Files changed
lib/tasks/is-overdue.ts
components/task/task-card.tsx
components/task/task-detail-sheet.tsx
tests/unit/is-overdue.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0)
`npm test` (0) — 196/196 tests passed, including 6 new is-overdue tests
`npm run build` (0)

## Decisions made
- isOverdue() does whole-date-only comparison (ignores time-of-day), since dueDate is stored as a "YYYY-MM-DD" string (see TaskDetailSheet's `<input type="date">`) rather than a timestamp — a task due "today" is never overdue regardless of the current time.
- Did not add `date-fns` (listed in tech-decisions.md's Libraries section but not yet in package.json/installed) for this one date-only comparison; `Date` methods are sufficient and avoid introducing a new dependency mid-feature. A future feature that needs richer date formatting/relative-time across the app should add it once, not per-feature.
- TaskCard is a plain presentational Client Component (no data fetching, no Server Action calls) per the file layout in tech-decisions.md (components/board/ + components/task/) — this lets both F042's board (draggable wrapper) and F053's list (plain row) reuse it without TaskCard owning drag-and-drop or list semantics.
- Per the feature spec's explicit instruction referencing AS-153 (later accessibility requirement — status not conveyed by color alone), added the TriangleAlert icon now in both TaskCard and TaskDetailSheet rather than deferring it, since it was cheap and correct to do from the start.
- TaskDetailSheet's overdue treatment covers both the due-date Label (icon + red text) and the due-date Input (red border/text) so the overdue state is visible whether or not the user has focused the field.

## Out-of-scope work needed
- TaskCard is not yet wired into any real board or list route — F042 (board) and F053 (list) are the features that will render it against real data. This is expected per the spec ("will be used by F042's board and possibly F053's list").
- `date-fns` is listed in tech-decisions.md's Libraries but is not in package.json yet; whichever feature first needs richer date formatting (e.g. relative comment timestamps per tech-decisions.md) should install it then.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used native `Date` instead of installing `date-fns` for this single date-only comparison, to avoid adding a dependency for a one-line utility; deferred to a future feature that actually needs date-fns's broader formatting.
AUTONOMOUS_DECISION: TaskCard exports a `TaskCardTask` type mirroring `TaskDetailSheetTask`'s shape (minus `description`) rather than importing/reusing TaskDetailSheetTask directly, so TaskCard doesn't need to depend on task-detail-sheet.tsx and can be imported standalone by board/list code that doesn't need the sheet.

## Notes for the next worker
- `isOverdue(dueDate: string | null, status: string): boolean` lives at `lib/tasks/is-overdue.ts` — import this rather than re-deriving overdue logic; it's now the single source of truth used by TaskCard and TaskDetailSheet.
- `TaskCard` (components/task/task-card.tsx) takes `{ task: TaskCardTask, onClick?, className? }`. `onClick` makes the whole card a keyboard-accessible button (Enter/Space) — pass it a handler that opens `TaskDetailSheet` for that task id.
- No MCP tools used — pure client-side/presentational feature, no Supabase interaction.
