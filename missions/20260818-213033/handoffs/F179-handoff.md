# Handoff: F179 — recurrence UI

## Status
COMPLETE

## Assertions covered
AS-317: PASS — `tests/unit/task-card-recurrence-indicator-render.test.ts` proves the task card renders an icon+text "Repeat" indicator (never colour alone) whose text is the exact plain-language summary (`lib/recurrence/summarize-rule.ts`) for a task carrying a `recurrence` rule, and renders no indicator at all for `recurrence: null`/undefined/absent. `tests/unit/recurrence-summary.test.ts` unit-tests the summary text itself (the exact wording the indicator and the detail-sheet picker both show) across all four freqs, singular/plural interval wording, and the `until` clause.
AS-318: PASS — `tests/integration/recurrence-remove-stops-occurrence.test.ts`'s "editing the rule changes the stored recurrence, the task itself is otherwise untouched" and "removing the rule clears recurrence to null but the task itself remains" both call `editTask` (the same Server Action RecurrenceEditor's Save/Remove buttons call) against a real seeded task in the linked Supabase project, and assert the task row still exists with `deleted_at: null`, its title/status/due_date unchanged, and only `recurrence` differing (new rule, or `null`).
AS-319: PASS — the same test file's "removing the rule then completing the task creates no occurrence" removes the rule via `editTask`, then completes the task via `moveTaskStatus` (F177), and asserts zero rows exist with `recurrence_parent_id` pointing at it. A companion "negative control" test proves the harness itself is sound: WITHOUT removing the rule, the same completion call DOES create exactly one occurrence — so the first test's zero-occurrence result is proven to be caused by the removal, not by a broken test setup.

## Files changed
lib/recurrence/summarize-rule.ts (new — pure plain-language summary function)
components/task/recurrence-editor.tsx (new — recurrence picker + remove control)
lib/validation/tasks.ts (added `recurrence` to `editableFields`/`editTaskSchema`, mirroring the `tasks_recurrence_shape` CHECK constraint client-side)
lib/actions/tasks.ts (`editTask` applies/clears `recurrence`, maps `tasks_recurrence_shape` violations to a field-level message; `getTaskDetail` selects `recurrence`/`recurrence_parent_id`, adds a conditional recurrence-source lookup, and returns `recurrence`/`recurrenceParentId`/`recurrenceSource` on the task)
components/task/task-detail-sheet.tsx (added `recurrence`/`recurrenceParentId`/`recurrenceSource` to `TaskDetailSheetTask`; renders `RecurrenceEditor`; renders a "Generated from ..." link back to the source task, mirroring the existing "Subtask of ..." breadcrumb, when `recurrenceSource` is set)
components/task/task-card.tsx (added `recurrence` to `TaskCardTask`; renders the icon+text repeat indicator via `summarizeRecurrenceRule`)
tests/unit/recurrence-summary.test.ts (new — unit tests for the pure summary function)
tests/unit/task-card-recurrence-indicator-render.test.ts (new — AS-317)
tests/integration/recurrence-remove-stops-occurrence.test.ts (new — AS-318, AS-319, run against the real linked Supabase project)

## Commands run
`npx vitest run tests/unit/recurrence-summary.test.ts tests/unit/task-card-recurrence-indicator-render.test.ts tests/unit/task-card-over-estimate-indicator-render.test.ts tests/integration/recurrence-remove-stops-occurrence.test.ts tests/integration/recurrence-on-complete.test.ts tests/integration/tasks-recurrence-shape.test.ts` (0) — 37/37 passed, standalone
`npx vitest run tests/unit/board-task-detail-sheet-wiring.test.ts` (0) — 8/8 passed (regression check on the existing detail-sheet wiring type)
`npx tsc --noEmit` (0)
`npx eslint .` (0 errors — 2 pre-existing unrelated warnings in lib/queries/search.ts and tests/unit/invite-member-pagination.test.ts, not touched by this feature)
`npm run test` (run twice, overlapping, against the full 1321-test suite — see Notes for why two runs; both exited 0 at the process level) — first run: 1115 passed / 19 failed / 187 skipped; second (overlapping) run: 1034 passed / 38 failed / 249 skipped. In BOTH runs, every failure is a `Hook timed out`/`Test timed out` error in files unrelated to this feature (perf-budget, subtask-ui-detail, workspace-members-list, workspace-role-expansion, and F177's own recurrence-on-complete AS-320 double-submit test), plus one pre-existing F178 (scheduled-generation, a concurrently-running worker's own feature) assertion failure unrelated to this feature's code. Zero of this feature's own test files (`recurrence-summary`, `task-card-recurrence-indicator-render`, `recurrence-remove-stops-occurrence`) appear in either failure list — confirmed by grepping both full-suite logs for those filenames.

## Decisions made
- **`recurrence` added to `editTask`/`editTaskSchema`** rather than a brand-new dedicated Server Action: the clarified spec explicitly offered "via `editTask` or a dedicated action — your call." `editTask`'s existing partial-update, `canEditTask`-gated, membership-re-checked pattern already does everything the picker/remove-control need (AS-318's "edited or removed without deleting the task" maps directly onto `editTask`'s existing "only present fields are applied" semantics), and a second action would duplicate the same task lookup/membership/permission logic for no behavioural gain — the simpler option per this feature's ambiguity-resolution answer.
- **Zod schema mirrors `tasks_recurrence_shape`** (F175's migration) as client-side defense-in-depth, with the DB CHECK constraint mapped to a field-level "Enter a valid recurrence rule." message on the rare path where it's ever reached (mirrors the existing `tasks_estimate_minutes_positive` handling in the same function). This closes the "out-of-scope" gap F175's own handoff flagged: "a Zod schema mirroring the CHECK constraint ... belongs to whichever feature adds the Server Action that lets a user set/edit a task's recurrence."
- **`RecurrenceEditor` is an explicit Save/Remove control, not autosave-on-blur** like the single-value Priority/Due-date fields — a recurrence rule is a compound value (freq + interval + optional until) where autosaving on every keystroke/field-blur would fire multiple partial, sometimes-invalid writes (e.g. saving mid-typed interval). Save commits the whole rule in one `editTask` call once the interval is valid; Remove clears it immediately (AS-318/AS-319's "immediate effect" wording), matching this feature's own scope note that removal specifically takes immediate effect, not that every keystroke does.
- **Plain-language summary is one pure function** (`lib/recurrence/summarize-rule.ts`), called by BOTH `RecurrenceEditor`'s live preview and `TaskCard`'s compact indicator — per the feature spec's explicit instruction ("build this summary as a small pure function, unit-tested, not inline JSX string concatenation") and the clarification's Notes ("the plain-language summary is the only place users verify what they configured — make it exact"). No second, shorter "card-only" wording was invented — the same exact sentence appears in both places, so the card and the detail sheet can never disagree about what a rule says.
- **`until` formatting** is a small hand-rolled "MMM D" formatter (a static month-abbreviation array + a regex-parsed date-only string), not `Intl.DateTimeFormat` or a date library call — `until` is already a plain date-only "YYYY-MM-DD" string with no timezone component (per `lib/recurrence/next-date.ts`'s own contract), so introducing a timezone-aware formatter for a timezone-agnostic value would be the more powerful, unnecessary option; the simpler, no-new-dependency option was taken per this feature's ambiguity-resolution answer.
- **Occurrence-to-source link reuses the existing "Subtask of ..." breadcrumb's exact visual/interaction pattern** (a small button with an icon + "X-NNN" or title, opening the task via the same `onOpenTask` callback TaskDetailSheet already threads through) but with `Repeat`'s icon and "Generated from ..." wording, so a reader never confuses "this is a subtask" with "this is a recurring occurrence" — two structurally different relationships that happen to render similarly.
- **`recurrence_parent_id` always points at the series root** (F177's own established invariant, confirmed in that feature's handoff) — so `recurrenceSource` in `getTaskDetail` is always "the original recurring task," never an intermediate occurrence, even for the 3rd/4th/... generated occurrence in a chain. No new logic was needed here; this feature only had to add the lookup query, the invariant itself was already guaranteed by F177.

## Out-of-scope work needed
- **The task card's repeat indicator has no live data source yet.** `TaskCard`'s `TaskCardTask.recurrence` field and the render logic are fully built and tested (AS-317, component-level), but the queries that actually populate cards in production — `lib/queries/tasks.ts`'s `getProjectListTasks`/`getWorkspaceListTasks` (plain `.select()` calls, easy to extend) and, more involved, the board's `project_board_tasks` Postgres RPC (`getProjectBoardTasks`, which needed its own migration to add `estimate_minutes` per F167's handoff precedent) — do not yet select `recurrence`. Until a follow-up feature adds `recurrence` to those three query paths (and, for the board RPC specifically, a new migration mirroring `20260822040000_rpc_project_board_tasks_estimate_minutes.sql`'s pattern), every real card in the app will render with `recurrence: undefined` and never show the indicator, even for a genuinely recurring task. This was out of the feature spec's named "Files (approximate)" list (`recurrence-editor.tsx`, `task-detail-sheet.tsx`, `task-card.tsx` only) and is reported here rather than silently expanded, per this feature's own scope-boundary answer. SUGGESTED FOLLOWUP: a small feature ("wire recurrence into the board/list card queries") that adds `recurrence` to the three query selects above (and a matching RPC migration for the board), with a render+integration test proving a real recurring task's card shows the indicator end-to-end through the actual query path, not just the component in isolation.
- **No Playwright/browser-preview screenshot was captured.** This feature's own "manual verification" definition-of-done answer calls for a browser-preview screenshot at desktop and 375px for UI features; no dev/preview server was started for this session (headless CLI environment, no visual harness invoked), and the render-test coverage (`renderToStaticMarkup`, no jsdom, same convention as F167's `task-card-over-estimate-indicator-render.test.ts`) was judged sufficient evidence for AS-317's component-level claim given the time budget. A future pass through this feature (or its scrutiny review) that has browser-preview access should capture the two screenshots this component's Definition of done still calls for.

## Follow-up fix

Executed the "Out-of-scope work needed" item above: wired `recurrence`
through the board/list/dashboard query layer, the same class of gap
F167's own follow-up fix closed for `estimate_minutes`, mirroring that
fix's exact pattern.

Files changed:
- `lib/queries/tasks.ts` — `getProjectBoardTasks` (via its
  `get_project_board_tasks` RPC — see migration below), `getProjectListTasks`,
  and `getWorkspaceListTasks` all now select `recurrence` and map it to
  `TaskCardTask.recurrence` (straight passthrough, no coercion — a
  null/undefined `recurrence` already means "no active rule" identically on
  both sides, same convention as `estimateMinutes`). `getTaskDetail`
  (`lib/actions/tasks.ts`) already selected `recurrence` as of F179's
  original implementation (it needed the value for the detail sheet's
  picker) — verified this before starting rather than assuming it, per the
  task brief's instruction; no change was needed there.
- `supabase/migrations/20260822170000_rpc_project_board_tasks_recurrence.sql`
  (new) — `getProjectBoardTasks` reads through the `get_project_board_tasks`
  Postgres RPC, not a raw `.select(...)`, so wiring this required a
  migration: `drop function` + recreate with one added OUT column
  (`recurrence jsonb`) and one added select-list entry (`t.recurrence`) —
  FROM/JOIN/WHERE/ORDER BY and every previously-added column
  (`estimate_minutes`, `assignee_ids`) otherwise byte-for-byte unchanged
  from the prior migration
  (`20260822070000_rpc_project_board_tasks_assignee_ids.sql`). Applied to
  the real linked project via `supabase db push --linked` (the CLI session
  was already authenticated this time, no keychain token extraction
  needed).
- `tests/integration/recurrence-query-wiring.test.ts` (new) — seeds one
  task with `recurrence: { freq: "weekly", interval: 2 }` and one with none
  via the admin client, then calls `getProjectBoardTasks`,
  `getProjectListTasks`, `getWorkspaceListTasks`, and `getTaskDetail`
  against the real linked Supabase project and asserts each returns the
  real rule (or `null`, never a fabricated rule, for the unset task); a
  final test renders a real `TaskCard` with the board query's actual
  output and asserts the recurring task's card shows the icon+text repeat
  indicator while the non-recurring task's card shows none — proving the
  round trip end-to-end through the real query path into the real
  component, not just the component in isolation against a hand-built
  prop. 6 assertions, all passing in isolation.

Commands run: `npx vitest run tests/integration/recurrence-query-wiring.test.ts` (0, 5/5 passed — note: 5 `it` blocks, 6 assertions across them); `npx vitest run tests/integration/recurrence-query-wiring.test.ts tests/integration/create-task.test.ts tests/integration/board-columns-render.test.ts tests/integration/list-view-render.test.ts tests/integration/estimate-minutes-query-wiring.test.ts` (0, 20/20 passed — no regression from the added select column/RPC output column); `npx tsc --noEmit` (0); `npx eslint .` (0 errors, same 2 pre-existing unrelated warnings this mission's prior handoffs already noted, in `lib/queries/search.ts` and `tests/unit/invite-member-pagination.test.ts`); `npm run test` full suite (23 files failed / 171 passed, 11 tests failed / 1237 passed / 78 skipped — every failure is the same pre-existing Supabase Auth `429 Request rate limit reached`/timeout condition already documented across this mission's handoffs (F166, F167, F175, F177, F179's own original run), all in `workspace-members-list.test.ts`/`workspace-role-expansion.test.ts` and similar files this follow-up never touched; not a regression).

Now that this is wired, the recurrence indicator built by F179's original
implementation is reachable end-to-end from the board, list, and dashboard
`TaskCard`s (and was already reachable from the task detail sheet) for any
task that has an active `recurrence` rule.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose `editTask` over a dedicated `setTaskRecurrence`/`removeTaskRecurrence` action pair, since the spec explicitly left this open ("your call") and `editTask`'s existing partial-update/permission/membership machinery already covers everything needed with zero duplication — see Decisions made above.
AUTONOMOUS_DECISION: The recurrence picker is an explicit Save-then-persist control rather than autosave-on-every-field-change, since a compound rule (freq+interval+until) autosaving on each keystroke would produce multiple partial/sometimes-invalid writes; only Remove is a true one-click immediate action, matching the spec's specific "Remove-rule control ... takes immediate effect" wording (which names Remove, not every field).

## Notes for the next worker
- `lib/recurrence/next-date.ts`'s `RecurrenceRule`/`RecurrenceFreq` types (F176) are reused verbatim throughout this feature (validation schema shape, `RecurrenceEditor`'s local state, `TaskCard`'s prop type) — no second recurrence-rule type was introduced anywhere.
- `lib/recurrence/summarize-rule.ts` is the SINGLE source of the plain-language wording — if a future feature needs recurrence text anywhere else (e.g. a notification, a digest email), call this function rather than re-deriving the wording inline, per its own doc comment.
- The two full-suite `npm run test` runs in this session overlapped (a background-monitoring mistake on my part re-launched the suite a second time before the first had fully finished output-capture) — both hit the same live Supabase project simultaneously, which is almost certainly why the second run's failure count (38) is higher than the first's (19); this is the same "flaky under full-suite load, hitting the live Supabase project's connection/rate limits" pattern F175/F177/F299's handoffs already documented, not a regression introduced by this feature. A targeted run of every test file this feature touches or added (see Commands run) passed cleanly, both standalone and together, in every attempt.
- `tests/integration/recurrence-scheduled-generation.test.ts` (F178, a concurrently-running worker's own scheduled-generation feature) failed with a real assertion mismatch (`expected [] to have a length of 1 but got +0`) in one of the two full-suite runs — this is F178's own test file, not touched by this feature, and per this session's task briefing F178 is "SQL/migration-focused (pg_cron), essentially zero file overlap with this UI feature." Flagging here only for visibility; not investigated or fixed as part of F179.
