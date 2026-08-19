# Handoff: F149 — subtask create, promote, cascade delete

## Status
COMPLETE

## Assertions covered
AS-267: PASS — deleting a parent task soft-deletes its children too. Enforced by a new `cascade_delete_task(p_task_id)` SECURITY DEFINER Postgres RPC (`supabase/migrations/20260819071821_subtask_cascade_delete.sql`) that soft-deletes the target task AND all of its currently-live direct children in one PL/pgSQL function invocation (one implicit transaction — atomic by construction, mirroring `start_timer_atomic`/`stop_timer_atomic`). `lib/actions/tasks.ts`'s `deleteTask` now calls this RPC instead of a plain `.update()`. Cascade provenance is recorded via a new nullable `tasks.deleted_via_task_id` column, set only on children hidden as a side effect of their parent's delete — never on a directly-deleted task. Covered by `tests/integration/subtask-actions.test.ts`: `test_AS_267_deleting_a_parent_task_soft_deletes_its_live_children_in_one_cascade`, `test_AS_267_cascade_provenance_distinguishes_a_child_deleted_before_the_parent_from_one_cascaded_with_it`, `test_AS_267_deleting_a_childless_task_does_not_error_the_cascade_is_a_harmless_no_op`, `test_AS_267_negative_a_non_member_cannot_trigger_the_cascade_delete_and_children_stay_live`.
AS-268: PASS — a child task can be promoted to a top-level task via a new `promoteSubtask` Server Action (`lib/actions/tasks.ts`) that sets `parent_task_id = null`. Board position is left untouched and verified (not assumed) to remain a valid finite fractional-index value after promotion, since a subtask already shares the exact same `(project, status)` position axis as any top-level task from the moment it's created. Already-top-level tasks are a no-op (no write), per the clarification's Q6 default. Covered by `test_AS_268_a_child_task_can_be_promoted_to_a_top_level_task`, `test_AS_268_promoting_a_subtask_leaves_its_board_position_valid_and_unchanged`, `test_AS_268_promoting_an_already_top_level_task_is_a_no_op_and_does_not_write`, `test_AS_268_negative_a_non_member_of_the_workspace_cannot_promote_a_subtask`, `test_AS_268_negative_promoting_a_nonexistent_task_is_reported_as_not_found`.

## Files changed
supabase/migrations/20260819071821_subtask_cascade_delete.sql
lib/supabase/database.types.ts
lib/validation/tasks.ts
lib/actions/tasks.ts
tests/integration/subtask-actions.test.ts

## Commands run
`supabase migration new subtask_cascade_delete` (0) — created the migration filename via the CLI, same convention as F148
`supabase db push` (0) — applied `20260819071821_subtask_cascade_delete.sql` to the live linked project cleanly, no errors/notices
`supabase gen types typescript --linked` (0) — regenerated `lib/supabase/database.types.ts`; diff reviewed before writing, limited to the new `deleted_via_task_id` column, its FK relationship entry, and the new `cascade_delete_task` RPC's `Functions` entry
`npx vitest run tests/integration/subtask-actions.test.ts --testTimeout=30000` (0) — 11/11 passed
`npx vitest run --testTimeout=30000` (0) — full suite, 656/656 passed across 112 files (up from F148's 645/111 — this feature's own 11 new tests, no regressions)
`npx tsc --noEmit` (0)
`npx eslint .` (0 errors, 1 pre-existing warning: `lib/queries/search.ts:232` `_titleMatches` unused — not from this feature, called out by the mission brief as known/not mine)

Per the mission brief, the default 5s vitest timeout is unreliable against
the real remote Supabase project, so every vitest run above used
`--testTimeout=30000`. No unrelated flakiness was observed at that
timeout.

No dev server was started for this feature (Server Actions + DB migration
+ integration tests only, per the brief); no stray `next dev` process was
found running (checked via `ps aux | grep "next dev"`), so nothing needed
killing. Playwright was not run — neither AS-267 nor AS-268 is a
live-interaction assertion (both are Server Action/DB-level behaviours,
verified by integration tests calling the real actions against the real
linked Supabase project), consistent with the Definition of done's
"Playwright only where the assertion is about live interaction" and
F148's identical precedent.

## Decisions made

- **Cascade provenance: a single nullable `deleted_via_task_id uuid`
  column, not a boolean flag.** The feature spec's Draft scope suggested
  "e.g. a `deleted_via_parent` flag"; the worker brief's critical-context
  note offered both a boolean and `deleted_via_task_id` as options and
  asked for a decision recorded here. Chose the nullable FK-to-`tasks.id`
  shape over a boolean because F189's future restore needs to know WHICH
  parent's cascade a child belongs to (a workspace can have many
  independent parent/child pairs being deleted over time) — a boolean
  alone answers "was this cascaded?" but not "cascaded by whom?", which
  restore needs to scope its own query (`where deleted_via_task_id =
  :parentBeingRestored`). This is also the simpler option in the sense the
  ambiguity-resolution rule asks for: it adds no second source of truth
  (one column, one meaning), just a slightly richer type than a boolean,
  and it's the same nullable-FK-with-no-new-RLS-policy shape F148 already
  established for `parent_task_id` itself.
- **Atomicity mechanism: a single PL/pgSQL RPC, not two sequential
  `.update()` calls from the Server Action.** The worker brief was
  explicit: "The cascade must be one transaction — a partial cascade that
  deletes the parent but not the children leaves orphans visible on the
  board." Two independent supabase-js `.update()` calls are two separate
  network round trips with no shared transaction — a crash, timeout, or
  connection drop between them could soft-delete the parent while leaving
  live children behind. `cascade_delete_task(p_task_id)`
  (`supabase/migrations/20260819071821_subtask_cascade_delete.sql`) is a
  single SECURITY DEFINER function body, which Postgres runs as one
  implicit transaction — mirrors the existing
  `start_timer_atomic`/`stop_timer_atomic`/`create_workspace_with_owner`
  precedent in this codebase for exactly this kind of "must-be-atomic,
  multi-row" mutation. Verified indirectly by asserting the parent's and
  a cascaded child's `deleted_at` timestamps are byte-identical
  (`test_AS_267_...one_cascade`) — only possible if both UPDATEs ran
  inside the same transaction, since `now()` is stable per-transaction in
  Postgres but two application-level `new Date().toISOString()` calls
  never are.
- **`cascade_delete_task` is granted to `service_role` only, not
  `authenticated`/`anon`.** Unlike `start_timer_atomic`/`stop_timer_atomic`
  (which source `auth.uid()` internally and are safe to expose to any
  authenticated caller), this RPC performs no membership check of its
  own — it trusts that `deleteTask` has already re-verified the caller's
  workspace membership (defense in depth, AS-143) via the admin client
  before calling it. Granting it to `authenticated` would let any signed-
  in user invoke it directly with an arbitrary `p_task_id`, skipping that
  membership check entirely. Restricting the grant to `service_role`
  closes that gap by construction.
- **`deleteTask` calls the cascade RPC unconditionally, no "does this
  task have children" branch.** A task with no live children just
  produces a harmless zero-row second UPDATE inside the RPC — cheaper and
  simpler than an extra existence-check round trip beforehand, and
  correct for all three shapes a task can be (top-level with children,
  top-level without, or a child itself — children can't have their own
  children per F148's one-level limit, so the cascade branch is always a
  no-op for them too). Covered by
  `test_AS_267_deleting_a_childless_task_does_not_error_the_cascade_is_a_harmless_no_op`.
- **`createTask` gains `parentTaskId` as a new final optional positional
  parameter**, per the brief's "extend the existing task create action
  with an optional parentTaskId ... do not create a parallel create-
  subtask path." Added at the end of the existing 7-parameter positional
  signature so the one existing call site
  (`components/task/new-task-dialog.tsx`, which passes exactly 7
  positional args) needed no changes — `tsc --noEmit` confirms no call
  site broke.
- **`createTask`'s parent validation happens in two layers, matching the
  Clarified implementation's "Zod ... then permission ... then database
  constraints as the final gate."** Zod (`lib/validation/tasks.ts`)
  checks only that `parentTaskId` is a well-formed UUID or absent. A new
  application-level check in `createTask` (before the insert) then looks
  up the live parent row and re-validates F148's own invariants (exists,
  not deleted, same project, itself top-level) so a bad `parentTaskId`
  maps to one of three specific messages ("Parent task not found.", "A
  subtask must be in the same project as its parent.", "A subtask cannot
  itself have subtasks.") rather than the database trigger's raw
  exception text. `enforce_task_parent_rules()` (F148) remains the actual
  final gate for any race between this check and the insert — its plain-
  text exception is pattern-matched (`/parent|nesting/i`) and mapped to a
  generic-but-specific fallback message, never surfaced raw (AS-146).
- **Promote does not touch `position` at all**, per the brief's "verify
  the position remains valid rather than assuming." Investigated (not
  assumed): a subtask is created through the exact same `createTask` →
  `calculatePosition` append-to-end-of-column code path as any top-level
  task, so it already carries a normal, valid fractional-index `position`
  within its `(project, status)` column from the moment it's created —
  clearing `parent_task_id` doesn't move it to a different position
  space. `promoteSubtask`'s UPDATE therefore only ever sets
  `parent_task_id = null`. Verified explicitly by
  `test_AS_268_promoting_a_subtask_leaves_its_board_position_valid_and_unchanged`,
  which asserts the position is unchanged AND still `Number.isFinite`
  after promotion, rather than merely asserting the action returned
  `ok: true`.
- **Promote's zero-state (already-top-level task) is a no-op that writes
  nothing**, per the Clarified implementation's Q6 default ("a no-op
  returns ok without writing, and the UI shows no error toast for an
  intentional no-op"). Verified by asserting `updated_at` is byte-
  identical before/after the call
  (`test_AS_268_promoting_an_already_top_level_task_is_a_no_op_and_does_not_write`),
  not just that the call returned `ok: true` — a real (even if
  idempotent) UPDATE would have bumped `updated_at` via
  `tasks_set_updated_at`.

## Out-of-scope work needed

- **F189 (restore)** — explicitly out of this feature's scope per the
  brief. The provenance this feature stores
  (`tasks.deleted_via_task_id`) is exactly what F189 needs: restoring a
  parent should also restore every child where `deleted_via_task_id =
  :parentId`, and must NOT touch a child whose `deleted_via_task_id` is
  null (deleted independently) even if that child currently has the same
  `parent_task_id`. F189 will also need to decide what happens to
  `deleted_via_task_id` on restore (most likely: clear it back to null
  once a child is restored, since the cascade relationship it recorded is
  now resolved) — not decided here, left for that feature.
- **No UI was added for creating a subtask or promoting one.** The
  feature spec's Files list (`lib/actions/tasks.ts`,
  `lib/validation/tasks.ts`, `supabase/migrations/`) is action/DB-layer
  only; `components/task/new-task-dialog.tsx` was not touched and has no
  "parent task" picker, and there is no "Promote to top level" button
  anywhere. A future UI feature can call `createTask(...,
  parentTaskId)` and `promoteSubtask(taskId)` directly — both are fully
  implemented, tested, and exported from `lib/actions/tasks.ts`.
- **The board/list views do not yet visually nest or group subtasks under
  their parent.** `lib/queries/tasks.ts`'s `getProjectBoardTasks` (and
  the list-view equivalent) were not touched by this feature and already
  return every non-deleted task in a project — including subtasks — as a
  flat list, exactly as the brief's critical-context note assumed ("it is
  already a normal card"). A future feature owning subtask UI is
  responsible for any nesting/grouping/indent treatment; this feature
  only guarantees the underlying data (parent/child link, cascade
  provenance, promote) is correct.
- **`deleteTask`'s discriminated-union result type
  (`DeleteTaskResult`) was NOT extended** to report which children (if
  any) were cascade-deleted alongside the parent — it still returns only
  `{ id, deletedAt }` for the parent itself, unchanged from before this
  feature. If a future UI wants to show "this also deleted N subtasks" in
  its toast/undo affordance, that's a new field on this return type, not
  built here (kept the return shape stable/minimal per this feature's
  scope, which only asked for the cascade to happen and be provable, not
  for a richer API contract).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose `deleted_via_task_id` (nullable FK to
`tasks.id`) over a plain `deleted_via_parent boolean` for cascade
provenance — see "Decisions made" above. This was genuinely open (the
spec offered both as "e.g." options and explicitly asked for the choice
to be recorded), resolved via the ambiguity-resolution rule (simpler
option, no new dependency, no second source of truth) in favor of the FK
shape because it's the only one of the two that actually gives F189
enough information to scope a restore correctly.

AUTONOMOUS_DECISION: Restricted `cascade_delete_task`'s grant to
`service_role` only (not `authenticated`), departing from this
codebase's more common "grant to authenticated, function checks
`auth.uid()` itself" pattern seen on the timer RPCs — because this
function has no internal caller-identity check, granting it more broadly
would let any signed-in user bypass `deleteTask`'s membership
re-verification entirely.

## Notes for the next worker

- `cascade_delete_task(p_task_id uuid)` returns `table (id uuid,
  deleted_at timestamptz)` — always one row (the parent's own id/
  deleted_at) whether or not it actually had any live children to
  cascade to, and even if `p_task_id` was already deleted before the call
  (in which case both UPDATEs inside the function are no-ops and the
  returned `deleted_at` reflects whatever it already was — `deleteTask`
  in application code still pre-checks "not already deleted" before
  calling this RPC, so that path is defense-in-depth, not the primary
  guard).
- The new `tasks_deleted_via_task_id_idx` index
  (`supabase/migrations/20260819071821_subtask_cascade_delete.sql`) is
  there specifically for F189's future `where deleted_via_task_id =
  :parentId` restore-scoping query — don't remove it thinking it's
  unused just because nothing in this feature queries by that column yet.
- `enforce_task_parent_rules()` (F148) only fires `before insert or
  update of parent_task_id, project_id on tasks` — it does NOT fire on a
  plain `deleted_at` update, so the cascade RPC's soft-deletes never risk
  tripping F148's nesting/cycle/same-project checks. Confirmed by reading
  the trigger definition, not assumed.
- MCP usage: none required at runtime beyond the Supabase CLI (`supabase
  db push` / `supabase gen types`), same as F148's own note — this
  mission's established pattern uses the CLI for migrations/types and
  the Supabase MCP server only when live introspection beyond what the
  CLI's own output already confirms is needed. No such extra
  introspection was needed here; `supabase db push`'s clean apply plus
  `tests/integration/subtask-actions.test.ts` exercising the real
  deployed RPC/column via the admin client against the live linked
  project is the "verify via MCP or equivalent live check" evidence for
  this feature's DB layer.
- F132 sweep note (project-visibility RLS, not yet built): no new RLS
  policy was added by this feature. `deleted_via_task_id` is a plain
  column on the already-RLS-covered `tasks` table, and
  `cascade_delete_task` is SECURITY DEFINER but only reachable from the
  trusted server-side admin client (see grant restriction above) — same
  "add a checklist, don't assume a gap" posture F148's handoff
  established.
