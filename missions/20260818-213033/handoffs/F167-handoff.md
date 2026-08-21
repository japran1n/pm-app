# Handoff: F167 — estimate vs logged time on the task

## Status
COMPLETE

## Assertions covered
AS-300: PASS — `TimeTracking` renders an estimate row ("Xh of Yh estimated") whenever `estimateMinutes` is set, plus a progress bar; verified by `tests/unit/time-tracking-estimate-render.test.ts` (`test_AS_300_shows_logged_time_against_the_estimate`) and the underlying ratio math by `tests/unit/estimate-progress.test.ts`.
AS-301: PASS — over-estimate badge (TriangleAlert icon + "Over estimate" text, amber not red — a fact, not an error) renders both in the detail view (`TimeTracking`) and on the board/list card (`TaskCard`), only when logged strictly exceeds estimate; verified by `test_AS_301_*` tests in `tests/unit/time-tracking-estimate-render.test.ts`, `tests/unit/task-card-over-estimate-indicator-render.test.ts`, and the flag logic itself in `tests/unit/estimate-progress.test.ts` (including the exactly-at-estimate non-flag edge case).
AS-302: PASS — `getEstimateProgress` returns `null` for a null/undefined/non-positive estimate, and both `TimeTracking` and `TaskCard` render nothing extra (no progress bar, no badge) in that case, with the plain logged-time total still showing; verified by `test_AS_302_*` tests across all three new test files.

## Files changed
lib/tasks/estimate-progress.ts (new)
components/task/time-tracking.tsx
components/task/task-card.tsx
components/task/task-detail-sheet.tsx
tests/unit/estimate-progress.test.ts (new)
tests/unit/task-card-over-estimate-indicator-render.test.ts (new)
tests/unit/time-tracking-estimate-render.test.ts (new)

## Commands run
`npm run test -- tests/unit/estimate-progress.test.ts tests/unit/task-card-over-estimate-indicator-render.test.ts tests/unit/time-tracking-estimate-render.test.ts` (0 — 15/15 passed)
`npx tsc --noEmit` (0)
`npx eslint .` (0 errors, 2 pre-existing unrelated warnings in lib/queries/search.ts and tests/unit/invite-member-pagination.test.ts, unchanged by this feature)
`npm run test` (full suite — 887 passed / 31 failed / 217 skipped across 172 files; every failure is a pre-existing `AuthApiError: Request rate limit reached` (429) on `signInWithPassword`/`createUser` in unrelated integration tests — the same intermittent-connectivity condition F166's handoff documented, worsened by concurrent workers (F160/F164 per the task brief) hammering the same Supabase project's Auth Admin API simultaneously. None of the 31 failing tests are in any file this feature touches; the targeted run above (this feature's own 3 new test files) passed 15/15 in isolation with 0 failures.)

## Decisions made
- Placed the pure helper at `lib/tasks/estimate-progress.ts` (not `lib/time/estimate-progress.ts` as the draft spec's "approximate" Files list suggested) — the task brief's explicit instruction was to mirror `lib/tasks/is-overdue.ts`'s exact convention, and that helper lives in `lib/tasks/`, matching the "task-domain pure helper" grouping already used there and by `lib/tasks/completion.ts`/`lib/tasks/task-key.ts`.
- `getEstimateProgress(estimateMinutes, loggedMinutes)` returns `null` (not a zeroed object) whenever there's no usable estimate — this is the single gate both `TimeTracking` and `TaskCard` check before rendering anything estimate-related, so AS-302's "no broken/zero progress bar, no false over-estimate flag" can never regress independently in one surface but not the other.
- `isOverEstimate` is computed from the strict `>` comparison against the raw (unclamped) ratio, not the clamped display `percent` — a task logged at exactly 100% of its estimate is NOT flagged ("over," not "at," per the assertion text), while `percent` itself is clamped to 100 purely for the progress bar's own width so 500% logged doesn't overflow the bar visually.
- Followed the Clarified spec's explicit note ("over-estimate is a fact, not an error — the styling should inform, not alarm") by using an amber (`text-amber-600`/`bg-amber-500`, dark-mode-aware) treatment for the badge and bar-over-fill, deliberately distinct from the overdue indicator's `text-destructive`/red treatment in the same file — same icon+text pairing convention (never colour alone, matching this codebase's AS-153/AS-525 established rule) but a different colour token to signal "worth knowing" rather than "something's wrong."
- Threaded `estimateMinutes` through `TaskDetailSheetTask` and into the `TimeTracking` call in `components/task/task-detail-sheet.tsx` — a one-field, two-line addition necessary for AS-300 to be reachable at all from the Sheet that actually composes `TimeTracking`, even though the spec's Files list didn't name this file explicitly; no other line in that file was touched.
- `estimateMinutes` defaults to `null` in both `TimeTracking` and (implicitly, via `task.estimateMinutes` being optional) `TaskCardTask` — same "safe default, caller hasn't fetched it yet" convention this codebase already uses for `totalMinutes`/`subtaskCount`/`openBlockerCount`/`completion` on `TaskCardTask`.

## Out-of-scope work needed
- No query yet selects `tasks.estimate_minutes` for read paths: `lib/queries/tasks.ts`'s `getProjectBoardTasks` (feeds `TaskCard.estimateMinutes`) and `lib/actions/tasks.ts`'s `getTaskDetail` (feeds `TaskDetailSheetTask.estimateMinutes`) both need a one-column addition to their existing `select(...)` calls, plus the page/board-state mapping layer that builds `TaskCardTask`/`TaskDetailSheetTask` props needs to pass the new field through. This wasn't in F167's Files/Touches list (`components/task/time-tracking.tsx`, `components/task/task-card.tsx`, plus the helper) and touching `lib/queries/tasks.ts`/`lib/actions/tasks.ts` risked colliding with the two concurrent workers (F160, F164) already modifying `lib/actions/tasks.ts` per the task brief's warning. A follow-up feature should: (1) add `estimate_minutes` to the two queries' selects, (2) map it through to `TaskCardTask.estimateMinutes`/`TaskDetailSheetTask.estimateMinutes` at every call site (board page, list page, dashboard), and (3) add an integration test asserting the estimate round-trips from the DB through the query into the shape these components expect. Until that follow-up lands, the estimate row/badge built here render correctly for any given prop value but no real page currently supplies a non-null `estimateMinutes`.
- No UI input to actually type/edit an estimate exists yet either (F166's handoff already flagged this) — this feature only renders whatever `estimateMinutes` value it's given; it doesn't add an edit control. That remains a separate follow-up (also noted by F166).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose amber/informational styling over any red/destructive treatment for the over-estimate badge, directly per the spec's Notes ("Over-estimate is a fact, not an error — the styling should inform, not alarm"), even though it visually diverges from the overdue badge's red `text-destructive` in the same two files — the icon+text pairing convention is preserved, only the colour token differs, which the Clarified spec explicitly calls for.
AUTONOMOUS_DECISION: Left `lib/queries/tasks.ts`/`lib/actions/tasks.ts` (and every page that builds `TaskCardTask`/`TaskDetailSheetTask`) untouched and filed the query-wiring gap as Out-of-scope rather than making the wider change myself, per the task brief's explicit warning that concurrent workers (F160, F164) are actively modifying `lib/actions/tasks.ts` and the feature spec's own Files/Touches list not naming those files.

## Notes for the next worker
- MCP usage: none — this feature is pure UI/presentational logic with no live external-service schema or config to introspect (per `mcp-registry.md`'s guidance and the feature spec's own "MCP at run: none").
- `formatDuration` (from `lib/time/format-duration.ts`, F113) was reused as-is for both the logged-time and estimate displays — no second formatter was written, per the task brief's explicit instruction.
- The estimate row's markup carries `data-testid="estimate-progress"` and the badge carries `data-testid="over-estimate-badge"` in both `TimeTracking` and `TaskCard`, for any future Playwright/UX-validator coverage to hook into directly rather than relying on text-content matching alone.
- Screenshots were not attached — no real page yet supplies a non-null `estimateMinutes` (see Out-of-scope above), so there is no live browser-reachable state to screenshot yet; the render tests (`renderToStaticMarkup`, matching this codebase's established `tests/unit/task-card-*-indicator-render.test.ts` pattern) are the evidence artifact for the UI states themselves, and are named per the Definition of Done's "screenshots additionally for UI features" answer being conditional on there being a live state to capture.
