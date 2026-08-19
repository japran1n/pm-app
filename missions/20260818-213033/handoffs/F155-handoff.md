# Handoff: F155 — task_dependencies table + RLS

## Status
COMPLETE

## Assertions covered
AS-276: PASS — a task can be marked blocked by another task in the same workspace. An active member of the shared workspace can INSERT and then re-read a `task_dependencies` row (`blocking_task_id`, `blocked_task_id`) linking two tasks in the same project/workspace, through the real RLS-respecting client. Covered by `tests/integration/rls-dependencies.test.ts`: `test_AS_276_a_member_can_create_and_read_a_dependency_between_two_tasks_in_the_same_workspace`.
AS-279: PASS — a task cannot depend on itself. Enforced by the `task_dependencies_not_self` CHECK constraint (`blocking_task_id <> blocked_task_id`). Covered by `test_AS_279_a_direct_db_insert_where_blocking_and_blocked_task_are_identical_is_rejected` (admin/service_role client) and `test_AS_279_a_real_member_client_insert_where_blocking_and_blocked_task_are_identical_is_rejected` (real authenticated member client).
AS-284: PASS — deleting a task leaves no dangling dependency rows. Enforced by `on delete cascade` on both `blocking_task_id` and `blocked_task_id` FKs to `tasks(id)`. Covered by `test_AS_284_deleting_the_blocking_task_removes_the_dependency_row_via_on_delete_cascade` and `test_AS_284_deleting_the_blocked_task_removes_the_dependency_row_via_on_delete_cascade`, both doing a real hard `DELETE` on the task row (the literal operation `on delete cascade` fires on) and re-querying for the dependency row afterward.
AS-285: PASS — a cross-workspace dependency is rejected at the database. Enforced primarily by the new `task_dependencies_enforce_same_workspace` BEFORE INSERT trigger (`public.enforce_task_dependency_same_workspace()`), which resolves both tasks' real workspace ids (via tasks -> projects) and raises if they differ — this fires even for the service-role client, which bypasses RLS but not triggers. Covered by three tests, all attempting the insert directly against the database (no Server Action exists for this feature): `test_AS_285_a_direct_admin_client_insert_across_two_workspaces_is_rejected_by_the_trigger` (admin client — proves the trigger itself, independent of RLS), `test_AS_285_a_real_authenticated_client_who_is_a_member_of_BOTH_workspaces_is_still_rejected` (the important case — a user who is genuinely an active member of both workspaces would pass an RLS check built only from per-column membership, but is still rejected by the trigger), and `test_AS_285_a_member_of_only_one_side_workspace_is_rejected_at_the_rls_layer` (side-effect coverage — a member of only one side is stopped even earlier, by the INSERT policy's `with check`).

## Files changed
supabase/migrations/20260819102618_task_dependencies.sql
lib/supabase/database.types.ts
tests/integration/rls-dependencies.test.ts

## Commands run
`supabase migration new task_dependencies` (0)
`supabase db push` (0) — applied 20260819102618_task_dependencies.sql cleanly against the linked project (ref qcipqonnqajmazdbysow); one harmless NOTICE ("trigger ... does not exist, skipping") from the migration's own `drop trigger if exists` guard on a fresh trigger name, same pattern as F148/F149's migrations.
`supabase gen types typescript --linked` (0) — regenerated into a temp file, diffed against the existing `lib/supabase/database.types.ts` before copying over; diff was a clean, isolated addition of the `task_dependencies` table entry only (Row/Insert/Update/Relationships), nothing else changed.
`npx vitest run tests/integration/rls-dependencies.test.ts --no-file-parallelism --testTimeout=30000` (0) — 9/9 passed
`npx tsc --noEmit` (0)
`npx eslint .` (0 errors, 1 pre-existing warning: `lib/queries/search.ts:232` `_titleMatches` unused — not from this feature, same warning F148's handoff already noted)

Per the process rules for this run, the full vitest suite was NOT run (the
orchestrator runs it between features) and no command was backgrounded —
everything above ran in the foreground, serially (`--no-file-parallelism`)
to avoid Supabase Auth rate limits from the test's several
`auth.admin.createUser` calls.

No dev server was started (pure DB migration + integration test feature);
Playwright was not run — no assertion here is about live UI interaction.

## Decisions made

- **Dependency correction honored.** The feature spec's "Depends on F132"
  does not exist yet (F132's `is_project_visible_to()` helper — M11 lands
  after M13). RLS is scoped through the EXISTING mission-1
  tasks -> projects -> workspace_members pattern, reusing
  `public.is_task_workspace_member(target_task_id)` (F058,
  `20260818040214_create_comments.sql`), the same helper F151/F152 reused
  for `checklist_items`. No new RLS-predicate function was invented.

- **Verb decision, made deliberately (per the brief's instruction to learn
  from F151's SELECT/INSERT-only gap).** This migration ships SELECT,
  INSERT, and DELETE together, and intentionally omits UPDATE:
  - SELECT/INSERT: needed for AS-276/AS-279/AS-285 directly.
  - DELETE: AS-282 ("a dependency can be removed by either side of the
    relationship") is a named assertion in this table's own validation-
    contract section, with no separate follow-up feature spec analogous
    to F152 that would otherwise close this gap — unlike F151's checklist
    precedent, where UPDATE/DELETE genuinely belonged to a not-yet-built
    feature. Shipping DELETE now costs nothing extra (identical shape to
    SELECT/INSERT) and avoids recreating the exact class of gap this
    brief called out. AS-282 itself is NOT one of my assigned assertions,
    so I did not write a test for it — the policy is present so a future
    worker isn't blocked by a missing verb, but its behavior is unverified
    by this feature's own test suite. Flagged in Out-of-scope work needed.
  - UPDATE: intentionally and permanently absent. A dependency row's
    fields are immutable once created — there is no product operation
    that "edits" a dependency, only create and delete. This is documented
    inline in the migration (not left silent), per the brief's explicit
    instruction.

- **Enforcement mechanism for AS-285: BEFORE INSERT trigger, not RLS
  alone, and not a CHECK constraint.** A CHECK constraint can only see the
  row being written, so it cannot express "do these two FKs resolve to
  the same workspace" (that requires reading `tasks`/`projects`), which
  needs a trigger — same reasoning as F148's
  `enforce_task_parent_rules()`. RLS alone is deliberately NOT relied on
  for this assertion: the INSERT policy's `with check` proves the caller
  is a member of *each* task's own workspace individually, which is not
  the same claim as "the two tasks share one workspace" — a user who is
  an active member of two different workspaces would satisfy the RLS
  check for a genuinely cross-workspace pair. The trigger closes that gap
  by directly comparing the two tasks' resolved `workspace_id`s, and
  additionally applies even to writes made through the service-role
  client (which bypasses RLS but never bypasses triggers). Both
  mechanisms are implemented and both are tested separately.

- **INSERT policy checks both `blocking_task_id` and `blocked_task_id`**
  (`with check (is_task_workspace_member(blocking) and
  is_task_workspace_member(blocked))`), unlike SELECT/DELETE which check
  only `blocking_task_id`. This is deliberate asymmetry, not an oversight:
  every row that has already passed the trigger is guaranteed to have
  both tasks in one workspace, so a single-column check is sufficient for
  SELECT/DELETE on existing rows (mirrors checklist_items' single-column
  pattern). At INSERT time, no such guarantee exists yet, so checking
  both columns rejects a caller who isn't even a member of one side's
  workspace before the trigger has to run at all — pure defense in depth,
  not the mechanism AS-285 actually depends on (the trigger is).

- **Index strategy.** The `task_dependencies_unique_pair` UNIQUE
  constraint's own composite index on `(blocking_task_id,
  blocked_task_id)` already serves an equality filter on
  `blocking_task_id` alone (leftmost column), so no separate single-column
  index was added for it. `blocked_task_id` is NOT the leftmost column of
  that index, so it gets its own explicit
  `task_dependencies_blocked_task_id_idx` to serve the reverse-direction
  read ("what blocks this task") without a sequential scan — this read
  path is AS-277's (out of scope here, but a certain near-term follow-up
  given it's the very next assertion in this table's section).
  `created_by` is not indexed: no known query filters or sorts on it.

- **AS-284 tests use a real hard `DELETE` on the `tasks` row**, not the
  app's usual soft-delete (`deleted_at` UPDATE). The FK's `on delete
  cascade` is defined against the literal SQL `DELETE` statement, and the
  feature spec's own assertion text ("deleting a task leaves no dangling
  dependency rows") is about that database-level guarantee, independent
  of whether/when the application's soft-delete convention is later
  extended to also physically purge rows.

- **Only one relation type is modeled** (blocks/blocked-by) — "relates
  to" and "duplicates" are out of scope, per the clarification file's ★
  default and the feature spec's own "Notes for clarification".

- **No Server Action or Zod schema was added.** The feature spec's Files
  (approximate) list is `supabase/migrations/` +
  `lib/supabase/database.types.ts` + the integration test only — same
  scope shape as F148 (parent/child relation), which also shipped
  DB-only. The Clarified implementation's validation answer ("mirrored in
  a Zod schema for the action layer") applies to whichever future feature
  adds the create/delete-dependency Server Action; deferring it is
  consistent with F148's own handoff precedent and the "stay in scope,
  report the rest" ambiguity-resolution default.

## Out-of-scope work needed

- **A `lib/actions/dependencies.ts` Server Action + Zod schema** for
  creating/deleting a dependency, mirroring `lib/actions/checklist.ts`'s
  shape: perform the actual write through the request-scoped RLS-
  respecting client (not the admin client) so RLS stays the real
  enforcement boundary, map the trigger's plain-text exception (raised as
  a default-SQLSTATE `raise exception`, no custom errcode — same caveat
  F148's handoff left for its own trigger) to a specific field-level
  message in the discriminated-union result per this feature's Clarified
  implementation "Failure/error handling" answer, and add a Zod schema
  mirroring `task_dependencies_not_self` (blocking != blocked) client-side
  before it ever reaches the database.
- **AS-277** (the blocking task shows what it blocks, and vice versa) —
  the read/list side, using the new `task_dependencies_blocked_task_id_idx`
  for the reverse-direction query.
- **AS-278** (cycle rejection) — explicitly F156, not started here. The
  self-reference case (AS-279) is the only cycle-adjacent thing this
  migration rejects; do not read the CHECK constraint as partial cycle
  coverage.
- **AS-280/AS-281** (blocked-status warning + confirmation on the board/
  task UI) and **AS-282/AS-283** (removing a dependency from either side's
  UI, and the removal's own UI affordance) — UI/product features layered
  on top of this schema. AS-282's DB-level requirement (a DELETE policy
  must exist) is already satisfied by this migration's
  `task_dependencies_delete_active_members` policy, but the assertion's
  actual behavior (UI trigger points on both tasks) is untested here since
  AS-282 was not assigned to this feature.
- **F132 sweep**: this migration's checklist is written inline as a
  comment block at the bottom of
  `supabase/migrations/20260819102618_task_dependencies.sql` — 3 policies
  (select/insert/delete, all via `is_task_workspace_member`), 2 CHECK/
  UNIQUE constraints (structural, no sweep needed), 2 indexes, 1 new
  trigger function (`enforce_task_dependency_same_workspace`, structural
  cross-workspace guard, no sweep needed — it doesn't gate row visibility,
  it gates write-time consistency).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Shipped a DELETE policy in this same migration
(`task_dependencies_delete_active_members`) even though DELETE-behavior
verification (AS-282) is not one of my four assigned assertions, because
the worker brief explicitly instructed deciding deliberately on all four
verbs now rather than repeating F151's gap, and AS-282 already names this
exact requirement in the validation contract with no dedicated future
feature spec to catch it otherwise. No test was written for AS-282 since
it isn't assigned to F155 — noted above under Out-of-scope work needed so
a future worker knows the policy exists but is unverified by this
feature's own suite.

AUTONOMOUS_DECISION: Used a BEFORE INSERT trigger (not a CHECK constraint,
and not RLS alone) as the real enforcement for AS-285, following F148's
`enforce_task_parent_rules()` precedent, because a CHECK constraint
cannot read other rows/tables and RLS alone provably does not close the
"member of both workspaces" gap (worked through explicitly in the
Decisions made section above and directly tested).

## Notes for the next worker

- `enforce_task_dependency_same_workspace()` raises plain `raise
  exception '...'` messages (default SQLSTATE, no custom errcode) — same
  caveat as F148's `enforce_task_parent_rules()`. A future Server Action
  wrapping the insert should treat any error from this write as a
  validation failure rather than pattern-matching a specific Postgres
  error code.
- The trigger is BEFORE INSERT only (no UPDATE) — deliberate, since this
  table has no UPDATE policy at all (dependencies are immutable), so
  there is no write path that could re-point `blocking_task_id`/
  `blocked_task_id` after creation to smuggle a cross-workspace pairing
  past this check.
- MCP usage: none beyond the Supabase CLI (`supabase db push` /
  `supabase gen types`), same convention F145/F148's handoffs already
  established for this mission — the Supabase MCP server was not needed
  since the CLI's own push/gen-types output plus the integration test
  against the live linked project (ref `qcipqonnqajmazdbysow`) already
  constitute the live verification.
- Verified directly against the live linked project, not just locally:
  `supabase db push` applied cleanly, and
  `tests/integration/rls-dependencies.test.ts` exercises the real deployed
  table, trigger, and RLS policies via both the admin client and real
  signed-in publishable-key clients.
