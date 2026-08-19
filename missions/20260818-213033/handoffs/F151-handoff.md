# Handoff: F151 — checklist_items table + RLS

## Status
COMPLETE

## Assertions covered
AS-269: PASS — a task can have checklist items with text (`content`) and a checked state (`is_checked`), and both persist as written (not just echoed by the insert response — verified by a separate re-read). Enforced by the `checklist_items` table (`supabase/migrations/20260819075456_create_checklist_items.sql`), `content text not null` plus a `checklist_items_content_not_empty` CHECK (btrim), and `is_checked boolean not null default false`. Covered by `tests/integration/rls-checklist.test.ts`: `AS-269: a task can have a checklist item with text content and a checked state, and both persist as written`, `AS-269: a checklist item defaults to unchecked when is_checked is omitted`, plus the negative case `an empty (whitespace-only) checklist item content is rejected at the database level`.
AS-274: PASS — checklist items are scoped by the same workspace RLS as their task; a non-member can neither read nor write them. Enforced by two RLS policies (`checklist_items_select_active_members`, `checklist_items_insert_active_members`) that reuse the EXISTING `public.is_task_workspace_member(task_id)` SECURITY DEFINER helper F058 created for `comments` (same tasks -> projects -> workspace_members join shape), rather than a new duplicate function. Covered by `tests/integration/rls-checklist.test.ts`: `AS-274: anon/publishable key with no session reading checklist_items returns zero rows, not an error`, `AS-274: a non-member cannot INSERT a checklist item claiming a task_id in a workspace they don't belong to`, `AS-274: a user not a member of the checklist item's task's workspace gets zero rows querying the item directly`, `AS-274: a non-member gets zero rows via a join-style query on task_id (checklist_items -> tasks)`, `AS-274: full list query scoped to task A returns zero rows for a non-member, even with a valid session in workspace B`. Positive-path membership tests (`a member of workspace A can SELECT...` / `...can INSERT...`) confirm the policy isn't over-restrictive.

## Files changed
supabase/migrations/20260819075456_create_checklist_items.sql
lib/supabase/database.types.ts
tests/integration/rls-checklist.test.ts

## Commands run
`supabase migration new create_checklist_items` (0) — created the migration filename via the CLI, same convention as F148/F149
`supabase db push` (0) — applied `20260819075456_create_checklist_items.sql` to the live linked project (ref `qcipqonnqajmazdbysow`) cleanly, no errors/notices
`supabase gen types typescript --linked` (0) — regenerated `lib/supabase/database.types.ts`; diff reviewed before writing, limited to the new `checklist_items` Table entry (Row/Insert/Update/Relationships) — no changes to any existing table's types
`npx vitest run tests/integration/rls-checklist.test.ts --testTimeout=30000` (0) — 10/10 passed
`npx vitest run --testTimeout=30000` (1, but see note below) — full suite, 683/684 passed across 115 files; the 1 failure was `tests/integration/perf-budget.test.ts`'s `AS-156: getProjectBoardTasks p95 is under the 500ms budget` (561ms vs 500ms budget) — unrelated to F151 (no assertion of mine, no file this feature touches), re-ran in isolation and it passed cleanly (2/2, `npx vitest run tests/integration/perf-budget.test.ts --testTimeout=30000`, exit 0), confirming real-network-timing flakiness against the remote Supabase project rather than a regression from this migration
`npx tsc --noEmit` (0)
`npx eslint .` (0 errors, 1 pre-existing warning: `lib/queries/search.ts:232` `_titleMatches` unused — not from this feature, called out by the mission brief as known/not mine)

Per the mission brief, the default 5s vitest timeout is unreliable against
the real remote Supabase project, so every vitest run above used
`--testTimeout=30000`.

MCP usage: Supabase MCP was checked for availability but flagged
"Pending approval" per the mission brief's guidance for that state; all
schema/migration work was done via the Supabase CLI (`supabase migration
new`, `supabase db push`, `supabase gen types typescript --linked`)
against the linked project instead, and I did not block on the MCP tool.

No dev server was started for this feature (pure DB migration + tests,
same shape as F148); `ps aux | grep "next dev"` found no stray process,
so nothing needed killing. Playwright was not run — neither AS-269 nor
AS-274 is a live-interaction assertion (both are DB-schema/RLS
behaviours, verified by integration tests calling the real linked
Supabase project), consistent with the Definition of done's "Playwright
only where the assertion is about live interaction" and F148's identical
precedent.

## Decisions made

- **Dependency correction honored, exactly as instructed.** The feature
  spec's "Depends on: F132" does not exist yet (F132's
  `is_project_visible_to()` RLS helper — M11 lands after M13). RLS was
  scoped entirely through the EXISTING mission-1 `tasks -> projects ->
  workspace_members` pattern, mirroring
  `supabase/migrations/20260818040214_create_comments.sql` (F058)
  exactly, and does not call or invent `is_project_visible_to()`
  anywhere.

- **Reused the existing `public.is_task_workspace_member(task_id)`
  helper instead of writing a new SECURITY DEFINER function.**
  `checklist_items.task_id` has the identical join shape to
  `comments.task_id` (task -> project -> workspace_members), so F058's
  helper (already deployed, already covering exactly this join) was
  reused as-is. This is the "shared SQL helper rather than a
  copy-pasted predicate" the Clarified implementation's Access control
  answer calls for, and it is also the simpler option under the
  ambiguity-resolution rule (adds zero new functions, zero new surface
  to audit).

- **Fractional-index `position`, not an integer order column** — per
  the Clarified implementation's explicit ambiguity-resolution answer.
  `position double precision not null default 0`, matching
  `tasks.position`'s exact shape
  (`supabase/migrations/20260818013434_create_tasks.sql`). Did NOT
  reimplement the ordering maths: `lib/board/position.ts`'s
  `calculatePosition` (which already carries the F101 bound-safety fix
  for the floating-point-precision collapse edge case) is the function
  a future checklist-reorder feature (AS-271) should call, and the
  migration's inline comment says so explicitly for whoever builds that
  feature.

- **Only SELECT + INSERT policies were added — no UPDATE or DELETE
  policy in this migration.** AS-270 (check/uncheck persists) and
  AS-271 (rename/reorder/delete) are NOT among this feature's assigned
  assertions (AS-269, AS-274 only), and the spec's "Files (approximate)"
  list names only the migration, the types file, and the RLS test — no
  Server Action or Zod schema file. This mirrors F058's
  `create_comments.sql` precedent exactly: SELECT + INSERT shipped
  first, UPDATE added later by a dedicated follow-up feature (F061) once
  its specific authorization rule (author-or-admin, in that case) was
  actually in scope. Per the Rules ("implement only what your feature
  spec covers... anything out of scope goes into Out-of-scope work
  needed"), I did not speculatively add UPDATE/DELETE policies for
  behaviour this feature doesn't implement.

- **No `deleted_at` column** — the feature spec's Draft scope lists the
  exact column set (id, task_id, content, is_checked, position,
  checked_by, checked_at, created_at) and does not include one, unlike
  `tasks`/`comments`. Per the Data shape clarified answer ("exactly the
  columns named in the feature's Draft scope... nullable only where the
  spec says nullable"), I did not add a soft-delete column beyond what
  was specified; hard delete is left to whichever future feature
  implements AS-271.

- **No CHECK linking `is_checked`/`checked_by`/`checked_at`
  consistency** (e.g. requiring `checked_at` to be set when
  `is_checked` is true). The spec does not state this invariant, and
  inventing one would be scope creep beyond AS-269/AS-274; noted under
  Out-of-scope work needed below for whoever builds the check/uncheck
  Server Action (AS-270).

- **Index: one composite index, `checklist_items_task_id_position_idx`
  on `(task_id, position)`, not a separate single-column `task_id`
  index.** A composite index already satisfies an equality filter on
  its leftmost column, so a separate `task_id`-only index would be
  redundant; the composite also covers the anticipated main read path
  ("all checklist items for a task, ordered by position"), per the
  Performance budget clarified answer's "index every FK and every
  column named in a WHERE/ORDER BY of the queries this feature
  enables." `checked_by` was left unindexed — no known query in this
  feature or its immediate follow-ups (AS-270/AS-271) filters or sorts
  on it.

## Out-of-scope work needed

- **UPDATE policy for checking/unchecking, renaming, and reordering
  (AS-270, AS-271).** A future feature should add a narrowly-scoped
  UPDATE policy on `checklist_items` (any active workspace member,
  matching `tasks_update_active_members`'s shape — checklist items are
  task-owned state, not user-authored content like comments, so there's
  no author-or-admin restriction expected) plus a DELETE policy for
  AS-271's "deleted" behaviour, a Server Action in `lib/actions/`, and a
  Zod schema in `lib/validation/`, per the Clarified implementation's
  API/contract and Validation-rules answers ("through Server Actions in
  lib/actions/, never a raw client query from a component"; "in the
  database AND mirrored in a Zod schema for the action layer").
- **Completion-percentage derivation (AS-272, AS-273)** — a task's
  completion percentage from checklist items + child tasks, displayed
  on the task card, and the "no items/children → no percentage shown"
  rule — is a separate read-path/UI feature layered on top of this
  table; not touched here.
- **`tests/integration/rls-anon-all-tables.test.ts`** (F079's
  consolidated anon-zero-rows audit) currently lists 6 workspace-scoped
  tables and was already stale before this feature (it's missing
  `time_entries`, `active_timers`, `profiles`, which shipped after F079
  in this same mission). This feature's own
  `tests/integration/rls-checklist.test.ts` has its own anon-zero-rows
  test for `checklist_items`, so AS-274 is not uncovered, but adding
  `checklist_items` (and the other missing tables) to that consolidated
  file is out of scope here — it isn't in F151's "Files (approximate)"
  list, and touching it would mean also fixing the pre-existing gap for
  unrelated tables, which is a wider change than this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Reused `public.is_task_workspace_member(task_id)` (F058) instead of writing a new SECURITY DEFINER helper, since `checklist_items.task_id` has the identical join shape to `comments.task_id`. See Decisions made above.
AUTONOMOUS_DECISION: Shipped only SELECT + INSERT RLS policies, mirroring F058's precedent, since UPDATE/DELETE behaviour (AS-270/AS-271) is not among this feature's assigned assertions. See Decisions made above.
AUTONOMOUS_DECISION: Used `position double precision not null default 0` (matching `tasks.position`'s exact default) since the spec names the column but not its default.

## Notes for the next worker

- The migration file's trailing comment block is an explicit "F132 sweep
  checklist" (same pattern F148 established for `tasks.parent_task_id`):
  table `checklist_items`; policies `checklist_items_select_active_members`,
  `checklist_items_insert_active_members` (both via the existing
  `is_task_workspace_member` helper, no new RLS function); constraint
  `checklist_items_content_not_empty` (CHECK); index
  `checklist_items_task_id_position_idx`; no triggers. When F132 lands,
  its sweep should treat this table as needing its SELECT/INSERT
  policies (and whatever UPDATE/DELETE policy a later feature adds)
  upgraded from `is_task_workspace_member` to F132's `is_project_visible_to()`-based
  equivalent — this migration deliberately does not anticipate that
  helper's shape.
- `lib/board/position.ts`'s `calculatePosition` already has the F101
  bound-safety fix for the floating-point-precision collapse edge case
  (repeated inserts between the same two neighbors). Whoever builds the
  checklist reorder feature (AS-271) should call that function directly
  rather than reimplementing the midpoint maths — I did not touch that
  file, only referenced it in the migration's column comment.
- Supabase MCP showed "Pending approval" per the mission brief's
  documented quirk; all schema work went through the Supabase CLI
  instead (`supabase migration new` / `supabase db push` / `supabase gen
  types typescript --linked`), which is the pattern F148/F149 also used.
