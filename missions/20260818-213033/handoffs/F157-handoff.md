# Handoff: F157 — dependency UI

## Status
COMPLETE

## Assertions covered
AS-277: PASS — the blocking task shows the tasks it blocks, and the blocked task shows what blocks it. `getTaskDetail` (lib/actions/tasks.ts) fetches both `task_dependencies` directions for the open task in the SAME query as the rest of the detail fetch (no per-section round trip), each row joined to the related task's own title/status/number/project-key (a related task can live in a DIFFERENT project of the same workspace — AS-285 only guarantees a shared workspace, not project — so its key is resolved via its own join, never assumed to equal the open task's). `components/task/dependencies.tsx`'s `Dependencies` component always renders BOTH the "Blocked by" and "Blocks" sections (even when a side is empty), each row showing the related task's key+title+status and an "Open"/"Remove" control. Covered by `tests/integration/dependency-ui-actions.test.ts` (`test_AS_277_getTaskDetail_returns_both_the_blocked_by_and_blocks_lists_with_key_title_and_status`, `test_AS_277_getTaskDetail_excludes_a_dependency_whose_related_task_has_been_soft_deleted`), `tests/unit/dependencies-ui-render.test.ts` (both-sections-always-shown + row content), and live in a real browser by `tests/e2e/dependency-ui.spec.ts`'s first test (both sections visible on both tasks' sheets, plus the "Add" picker genuinely creating a new dependency that appears immediately).
AS-282: PASS — a dependency can be removed by either side of the relationship. `deleteDependency` (new export, lib/actions/dependencies.ts) takes only the `task_dependencies` row's own id — never "which task/side initiated it" — so the exact same call serves a row read off either the blocking task's own "Blocks" list or the blocked task's own "Blocked by" list; F155's existing DELETE RLS policy (`task_dependencies_delete_active_members`) already enforces this symmetrically (checks membership via the shared workspace, not a side). Covered by `tests/integration/dependency-ui-actions.test.ts`'s two positive tests (removal via an id read from each side respectively, each independently re-verified with a direct admin re-read), three negative tests (invalid input, nonexistent id, a different-workspace caller — with a side-effect check that the row survives the denied attempt), `tests/unit/dependencies-ui-render.test.ts` (every row has its own remove control regardless of direction), and live by `tests/e2e/dependency-ui.spec.ts`'s second test (clicking the remove control on the blocked task's own section actually deletes the row, verified by both the UI updating and a direct database re-read).
AS-283: PASS — a blocked task shows a visible indicator on its card, using an icon plus text rather than colour alone. `getProjectBoardTasks` (lib/queries/tasks.ts) computes `openBlockerCount` per task in one additional whole-project-scoped query (never a per-card round trip), counting only blockers whose own status isn't "done" (see Decisions made for why). `TaskCard` (components/task/task-card.tsx) renders a `Ban` icon + the literal text "Blocked" when `openBlockerCount > 0`, following the exact same icon+text pairing already established for the overdue indicator in the same file. Covered by `tests/unit/task-card-blocked-indicator-render.test.ts` (icon+text present/absent for positive/undefined/zero), `tests/integration/dependency-ui-actions.test.ts`'s `test_AS_283_getProjectBoardTasks_reports_an_open_blocker_count_only_while_a_blocker_is_not_done` (data correctness: open blocker counted, done-only blocker not counted, no blocker not counted), and live by `tests/e2e/dependency-ui.spec.ts`'s first test (the blocked card shows "Blocked", the blocker's own card does not).

## Files changed
supabase/migrations/20260819104900_dependency_reachability_functions.sql (new)
lib/supabase/database.types.ts
lib/validation/dependencies.ts
lib/actions/dependencies.ts
lib/actions/tasks.ts
lib/queries/tasks.ts
components/task/dependencies.tsx (new)
components/task/task-detail-sheet.tsx
components/task/task-card.tsx
tests/unit/dependencies-ui-render.test.ts (new)
tests/unit/task-card-blocked-indicator-render.test.ts (new)
tests/integration/dependency-ui-actions.test.ts (new)
tests/e2e/dependency-ui.spec.ts (new)

## Commands run
`supabase migration new dependency_reachability_functions` (0)
`supabase db push` (0) — applied `20260819104900_dependency_reachability_functions.sql` cleanly against the linked project (ref `qcipqonnqajmazdbysow`).
`supabase gen types typescript --linked` (0) — regenerated into a temp file, diffed against the existing `lib/supabase/database.types.ts` before copying over; diff was a clean, isolated addition of the two new RPC function entries only, nothing else changed.
`npx vitest run tests/unit/dependencies-ui-render.test.ts tests/unit/task-card-blocked-indicator-render.test.ts --no-file-parallelism` (0) — 8/8 passed
`npx vitest run tests/integration/dependency-ui-actions.test.ts --no-file-parallelism --testTimeout=30000` (0) — 12/12 passed
`npx vitest run tests/integration/rls-dependencies.test.ts tests/integration/dependency-cycle.test.ts --no-file-parallelism --testTimeout=30000` (0) — 13/13 passed (F155/F156 regression re-check — this feature's migration and getTaskDetail/getProjectBoardTasks edits touch the same table/files)
`npx vitest run tests/integration/board-tasks-completion.test.ts tests/integration/board-columns-render.test.ts tests/integration/board-reload-persistence.test.ts tests/integration/checklist-actions.test.ts tests/integration/subtask-actions.test.ts tests/integration/subtask-ui-detail.test.ts tests/integration/task-detail-sheet-time-total.test.ts --no-file-parallelism --testTimeout=30000` (0) — 46/46 passed (regression re-check on every other suite that exercises `getTaskDetail`/`getProjectBoardTasks`/`TaskDetailSheet`/`TaskCard`, all touched by this feature)
`npx vitest run tests/unit --no-file-parallelism` (0) — 340/340 passed (full unit-test regression re-check — this feature edited shared, widely-imported files)
`npx playwright test tests/e2e/dependency-ui.spec.ts --reporter=list` (0) — 2/2 passed (real browser, real running app, real magic-link auth; no stray `next dev` was running before or left running after)
`npx tsc --noEmit` (0)
`npx eslint .` (0 errors, 1 pre-existing warning: `lib/queries/search.ts:232` `_titleMatches` unused — not from this feature, same warning F155/F156/F148's handoffs already noted)

Per the process rules for this run, the full `npm run test` suite was NOT
run (the orchestrator runs it between features) — the commands above are
this feature's own tests plus targeted regression re-runs of every other
suite that exercises the shared files this feature touched, plus
`tsc`/`eslint`. Nothing was backgrounded. Integration tests ran serially
(`--no-file-parallelism`) to avoid Supabase Auth rate limits from the
tests' `auth.admin.createUser`/`generateLink` calls. A stray `next dev`
was checked for (none found) before running Playwright, and none was left
running afterward (Playwright's own `webServer` starts/stops it).

## Decisions made

- **The picker's cycle exclusion reuses F156's own SQL reachability walk,
  never a second TypeScript graph implementation**, per the critical
  context's explicit instruction. Two new `stable`, invoker-rights SQL
  functions (`get_dependency_descendants`/`get_dependency_ancestors`,
  this feature's migration) expose the SAME recursive-CTE shape F156's
  `enforce_task_dependency_no_cycle()` trigger already uses, in both
  directions. `getDependencyCandidates` (lib/actions/dependencies.ts)
  calls whichever one matches the picker's direction and excludes every
  id it returns (plus the task itself, plus any task already directly
  linked in that same direction — a small additive refinement so the
  picker never offers a pick that would only fail with "this dependency
  already exists"). No pre-insert cycle check of the action's OWN was
  added anywhere — `createDependency`'s own no-pre-check TOCTOU-safety
  guarantee from F156 is unchanged; the picker's exclusion is a UX
  convenience layered on top, not a second enforcement path, and the
  database trigger remains the only place a cycle is actually rejected.

- **AS-283's "blocked" definition: an OPEN (non-"done") blocker, not "has
  ever had any blocking dependency at all".** This section's own adjacent
  AS-281 ("a task whose blockers are all complete shows no blocked
  warning") establishes that this feature's use of "blocked" already
  means "currently, actively blocked" elsewhere in this same section of
  the validation contract, even though AS-281 itself (the move-to-done
  confirmation) is a separate, not-yet-built feature. Reusing that same
  semantics for the card indicator, rather than inventing a
  "has-ever-had-a-blocker" flag with no clear product meaning once the
  blocker resolves, is the simpler option that adds no second definition
  of "blocked" for this feature area — recorded here per the
  ambiguity-resolution default, since the assertion text itself doesn't
  spell out which reading applies to the card indicator specifically.

- **The card indicator's text is the fixed word "Blocked", not a count**
  ("Blocked by 2" etc.), unlike the subtask-count indicator on the same
  card which does show a number. AS-283's literal text only asks for
  "icon plus text", and "blocked" is inherently closer to the overdue
  indicator's binary-state shape (is it, or isn't it) than to
  subtask-count's inherently-numeric one — the simpler option, matching
  the overdue indicator's own precedent most closely.

- **AS-283's indicator was added to `TaskCard`/`getProjectBoardTasks`
  (the board) only, not to `task-list-table.tsx`/`getProjectListTasks`
  (the list table).** This exactly mirrors the existing precedent for
  BOTH of this card's other two "extra" indicators (subtaskCount from
  F150, completion from F154) — neither exists on the list table either,
  only on the board card. The feature spec's own "Files (approximate)"
  list also only names `task-card.tsx`, not `task-list-table.tsx`. AS-283
  itself says "on its card", which the list view (a table, not cards)
  doesn't have.

- **`deleteDependency` takes only a `dependencyId`, never a "which side"
  parameter** — this is what makes it genuinely symmetric rather than
  needing to special-case which of the two directions the UI happened to
  read the row from; the row's own id is the only thing either the
  "Blocked by" or "Blocks" section's remove button ever needs, and F155's
  existing DELETE RLS policy already enforces the shared-workspace
  membership check the same way regardless of which task's sheet
  triggered the call.

- **The "Add" picker's search reuses `parseTaskKeyQuery`
  (lib/tasks/task-key.ts, F147) for the "search by key" half**, rather
  than a new regex, and falls back to a plain `ilike` title substring
  match otherwise — deliberately NOT reusing
  `searchWorkspaceTasks`(lib/queries/search.ts), which is a Server
  Component-only, full-text-ranked, whole-workspace search with a
  different (heavier) shape than this picker's single
  project+number-or-title match needs, and isn't itself callable from a
  Client Component's Server Action the way this picker needs.

- **The Popover/Command combobox uses `shouldFilter={false}`** — filtering
  is server-side (workspace-scoped, cycle- and duplicate-excluded)
  through `getDependencyCandidates`; cmdk's own client-side substring
  filter would otherwise re-filter an already-correct, already-small
  result set, and could hide a legitimate key-only match whose display
  text doesn't literally contain the typed substring.

- **Access control**: per this codebase's own established precedent for
  this exact gap (SubtaskList/F150, Checklist/F153 — both documented in
  their own handoffs), `lib/auth/permissions.ts` does not exist yet in
  this codebase (that module is AS-230's own not-yet-built feature; M11
  lands after M13 in this mission's plan). Every control in
  `components/task/dependencies.tsx` is available to any active
  workspace member and re-verified server-side by
  `createDependency`/`deleteDependency`/`getDependencyCandidates`
  themselves (`requireActiveMembership`), matching every sibling section
  of this Sheet.

## Out-of-scope work needed

- **AS-280/AS-281** (moving a blocked task to a done status warns the
  user a blocker is still open, and requires confirmation; a task whose
  blockers are all complete shows no warning) — not this feature's
  assigned assertions, not started. A future worker implementing them
  should reuse this feature's own "open blocker" semantics
  (`getProjectBoardTasks`'s `openBlockerCount` computation, or an
  equivalent per-task query for wherever the status-change control lives)
  rather than inventing a second definition of "still blocked".
- **`lib/auth/permissions.ts` (AS-230)**, once it lands, should replace
  the `requireActiveMembership`-only gating in
  `lib/actions/dependencies.ts` and the unconditional control visibility
  in `components/task/dependencies.tsx` — same follow-up every other
  task-detail section (Subtasks, Checklist, Comments, Attachments) is
  already waiting on, not specific to this feature.
- **The list view (`task-list-table.tsx`) and dashboard table do not show
  a "blocked" indicator** — deliberately out of scope, matching the
  existing precedent that subtask-count/completion indicators are
  board-card-only too (see Decisions made above). If a future feature
  wants list/dashboard parity for any of these three indicators, it
  should add all of them together rather than singling this one out.
- **DEPENDENCY_CANDIDATE_LIMIT (25) has no "load more" affordance** — the
  picker simply shows up to the first 25 matches for a query (most
  recently created first, or the exact key/title matches for a specific
  query). For a workspace whose task count is large enough that a real
  target task never appears in the first 25 unfiltered results, refining
  the search text is the only way to find it today. No assertion in this
  feature's scope calls for pagination, so none was added.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Defined the AS-283 card indicator as "has at least
one OPEN (non-\"done\") blocker" rather than "has ever had any blocking
dependency", reusing this section's own adjacent AS-281 semantics for
what "blocked" means, since the assertion text itself doesn't specify
which reading applies to the card and the simpler/no-second-definition
option was to match the meaning the validation contract's own next
assertion already establishes for the same word.

AUTONOMOUS_DECISION: Scoped the picker's "already directly linked"
exclusion (in addition to the cycle exclusion the critical context
explicitly requires) as a small additive refinement, so the picker never
offers a pick that would only fail with a "this dependency already
exists" uniqueness error — judged to be the same "don't offer what will
fail" principle already being asked for, at effectively no extra cost (one
more id-set lookup), rather than a scope expansion needing its own
sign-off.

AUTONOMOUS_DECISION: Did not extend `task-list-table.tsx`/
`getProjectListTasks`/the dashboard table with the AS-283 indicator,
matching the existing board-card-only precedent for this card's two other
non-core indicators (subtaskCount, completion) and the feature spec's own
Files list, which names only `task-card.tsx`.

## Notes for the next worker

- `task_dependencies` has TWO foreign keys to `tasks`
  (`blocking_task_id`, `blocked_task_id`), so any embedded-relation
  select against it needs PostgREST's `!constraint_name` disambiguation
  hint. The two FK names (confirmed against
  `lib/supabase/database.types.ts`'s own `Relationships` entries) are
  `task_dependencies_blocking_task_id_fkey` and
  `task_dependencies_blocked_task_id_fkey` — used throughout
  `getTaskDetail`'s two new queries and `getProjectBoardTasks`'s new
  blocker-count query.
- A dependency's two tasks are only guaranteed to share a WORKSPACE
  (F155's AS-285), never a PROJECT — every place this feature reads a
  related task's display key resolves that task's OWN
  `projects(key)` join rather than assuming it equals the current task's
  own `projectKey`. `tests/integration/dependency-ui-actions.test.ts`'s
  first test seeds a cross-project-same-workspace pair specifically to
  prove this.
- The app's task delete path is soft-delete only (`deleted_at`); a
  dependency whose related task has been soft-deleted is NOT
  automatically removed (F155's `on delete cascade` only fires on a
  genuine hard `DELETE`, which nothing in the app does today — same
  caveat F155's own handoff already documented for AS-284's tests). This
  feature's `getTaskDetail` filters such rows out in TypeScript after the
  fetch; it does not rely on the database to have already removed them.
- `react-dom/server`'s `renderToStaticMarkup` does not render portalled
  content at all (confirmed empirically before writing
  `tests/unit/dependencies-ui-render.test.ts` — the Popover/Command
  search UI's markup is genuinely absent from the SSR output, only the
  always-rendered `PopoverTrigger` button appears). This is why this
  feature's unit test can't prove the picker's search/select behavior —
  that's exactly what `tests/e2e/dependency-ui.spec.ts` exists to prove,
  against a real browser.
- MCP usage: none beyond the Supabase CLI (`supabase db push`/
  `supabase gen types`), same convention F145/F148/F155/F156's handoffs
  already established — the Supabase MCP server was not needed since the
  CLI's own push/gen-types output plus the integration and e2e tests
  against the live linked project (ref `qcipqonnqajmazdbysow`) already
  constitute the live verification.
