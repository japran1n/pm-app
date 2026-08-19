# Handoff: F148 — parent/child task relation

## Status
COMPLETE

## Assertions covered
AS-265: PASS — a task cannot be its own parent, and a parent/child cycle is rejected. Enforced by the `tasks_parent_not_self` CHECK constraint (self-reference) plus the `enforce_task_parent_rules()` BEFORE INSERT/UPDATE trigger, which rejects any write giving a task a parent whose own `parent_task_id` is non-null — the same rule that blocks a two-node cycle (A→B→A), since closing the cycle always requires the second edge's target to already have a parent. Covered by `tests/integration/db-subtasks.test.ts`: `test_AS_265_a_direct_db_insert_setting_a_tasks_parent_to_itself_is_rejected`, `test_AS_265_a_direct_db_update_setting_a_tasks_parent_to_itself_is_rejected`, `test_AS_265_a_direct_db_two_node_parent_child_cycle_is_rejected`.
AS-266: PASS — nesting is limited to one level: a child task cannot itself have children. Enforced by the same trigger, both directions: (a) a task whose parent already has a parent is rejected, and (b) a task that already has live children is rejected from being given a parent itself. Covered by `test_AS_266_a_task_can_have_a_child_one_level_of_nesting_is_allowed` (positive path, also proves the F145 key/number-trigger interaction — the child gets its own distinct `number`), `test_AS_266_a_direct_db_insert_making_a_grandchild_of_an_existing_child_is_rejected`, `test_AS_266_a_direct_db_update_giving_a_parent_to_a_task_that_already_has_children_is_rejected`, plus two side-effect tests for the "same project" requirement: `test_AS_266_negative_parent_and_child_in_different_projects_is_rejected` and `test_AS_266_negative_moving_a_parent_task_with_children_to_a_different_project_is_rejected`.

## Files changed
supabase/migrations/20260819071050_subtasks_parent_task_id.sql
lib/supabase/database.types.ts
tests/integration/db-subtasks.test.ts

## Commands run
`supabase migration new subtasks_parent_task_id` (0)
`supabase db push` (0) — applied 20260819071050_subtasks_parent_task_id.sql (a harmless NOTICE — "trigger tasks_enforce_parent_rules does not exist, skipping" — came from the migration's own `drop trigger if exists` guard on a fresh trigger name, not an error)
`supabase gen types typescript --linked` (0) — regenerated lib/supabase/database.types.ts; diff reviewed before writing, limited to the new `parent_task_id` column and its FK relationship entry
`npx vitest run tests/integration/db-subtasks.test.ts --testTimeout=30000` (0) — 8/8 passed
`npx vitest run --testTimeout=30000` (0) — full suite, 645/645 passed across 111 files
`npx tsc --noEmit` (0)
`npx eslint .` (0 errors, 1 pre-existing warning: `lib/queries/search.ts:232` `_titleMatches` unused — not from this feature)

Per the mission brief, the default 5s vitest timeout is unreliable against
the real remote Supabase project, so every vitest run above used
`--testTimeout=30000`. No unrelated flakiness was observed at that
timeout.

No dev server was started for this feature (pure DB migration + tests);
no stray `next dev` process was found running, so nothing needed killing.
Playwright was not run — this feature has no live-interaction assertion
(AS-265/AS-266 are DB-constraint assertions), consistent with the
Definition of done's "Playwright only where the assertion is about live
interaction."

## Decisions made

- **Dependency correction honored.** The feature spec's "Depends on
  F132" does not exist yet (F132's `is_project_visible_to()` RLS helper —
  M11 lands after M13). No new RLS policy was added; `tasks.parent_task_id`
  is a plain column on `tasks`, already covered end-to-end by the
  existing mission-1 policies `tasks_select_active_members` /
  `tasks_insert_active_members` / `tasks_update_active_members`
  (`supabase/migrations/20260818013805_rls_tasks.sql`), which already
  scope through `workspace_members` via
  `public.is_project_workspace_member(project_id)`. This mirrors F145's
  precedent exactly (`20260819061129_project_keys_and_task_numbers.sql`).
  **F132 sweep checklist** (also written inline in the migration file):
  - No new RLS policy was added anywhere in this feature.
  - One new `SECURITY DEFINER` trigger function was added:
    `public.enforce_task_parent_rules()` — trigger-only use, not
    independently callable by client roles for anything beyond that, and
    does not reference or assume `is_project_visible_to()`.
  - One new CHECK constraint (`tasks_parent_not_self`) and one new
    trigger (`tasks_enforce_parent_rules`) were added — both encode
    structural invariants (self-reference, nesting depth, same-project)
    independent of row visibility; neither should need to change when
    F132 lands.
  - `is_project_visible_to()` is not called or invented anywhere in this
    feature, per the brief's explicit instruction.

- **One-level nesting is a deliberate product rule, documented in the
  migration itself** with an explicit `*** DELIBERATE PRODUCT LIMIT —
  DO NOT "FIX" ***` comment block above `enforce_task_parent_rules()`,
  per the brief's instruction, so a future reader doesn't "fix" it into
  an arbitrary-depth tree.

- **Enforcement mechanism: CHECK + trigger, not CHECK alone.** A CHECK
  constraint can only see the row being written, so it can express
  self-reference (`parent_task_id <> id`) but not "is my parent itself a
  child" or "do I already have children" — those need to read other rows
  of the same table, which requires a `BEFORE INSERT OR UPDATE` trigger
  (`enforce_task_parent_rules()`, `SECURITY DEFINER`, mirroring
  `assign_task_number()`/`assign_project_key()` from F145's migration).
  The CHECK constraint is kept as defense in depth alongside the
  trigger's own explicit self-reference check, per the spec's Draft scope
  ("CHECK preventing self-reference; trigger ... rejecting a parent that
  itself has a parent").

- **Cycle rejection (AS-265) and the one-level limit (AS-266) share one
  mechanism, not two.** Because nesting is capped at one level, the only
  possible cycle beyond self-reference is a two-node cycle (A parent of
  B, B parent of A). Creating the second edge always requires B (already
  somebody's parent, of A) to accept a parent itself — exactly the
  "proposed parent must itself be top-level" check that also enforces
  AS-266. Verified explicitly by
  `test_AS_265_a_direct_db_two_node_parent_child_cycle_is_rejected`,
  which builds A→B then asserts B→A is rejected by the *same* code path
  that rejects a grandchild.

- **Same-project requirement enforced both directions.** Beyond "parent
  and child must share `project_id`" at write time, the trigger also
  blocks moving a task that currently has live children to a different
  `project_id` (`UPDATE OF parent_task_id, project_id` trigger scope),
  since that would silently strand its children in the old project
  without touching their own rows — a cross-project data-integrity gap
  the Definition of done's side-effect answer ("no cross-project ...
  leaks") calls out. This is new behavior beyond the spec's literal
  Draft scope text but follows directly from "enforced in the database,
  not only in the action" — recorded here per the ambiguity-resolution
  rule (simpler option, ties DB truth to one invariant, no new
  dependency).

- **"Already has children" check filters `deleted_at is null`.** A
  soft-deleted child does not block its former parent from later being
  assigned a parent of its own, consistent with every other soft-delete
  convention in this schema (mirrors `tasks_select_active_members`'s
  `deleted_at is null` filter).

- **Zod mirror deferred to the Server Action feature, per scope.** The
  Clarified implementation's validation answer says invariants should be
  "in the database ... AND mirrored in a Zod schema for the action
  layer," but this feature's own "Files (approximate)" / Touches scope is
  `supabase/migrations/` + `lib/supabase/database.types.ts` only — no
  Server Action exists yet for creating/promoting subtasks. No
  `lib/actions/*` file was added or touched. The Zod mirror is the
  responsibility of whichever future feature adds the subtask Server
  Action (AS-263/AS-268 territory); noted in Out-of-scope work needed
  below so it isn't dropped.

- **Tests attack the database directly**, using the admin
  (`service_role`) client and, for the self-parenting case, an explicit
  client-supplied `id` on insert (`randomUUID()`) so `parent_task_id` can
  reference the row's own id within the same statement — per the brief's
  explicit instruction that both rejection paths need integration tests
  attempting the illegal write directly against the database, not through
  a Server Action that could be the only thing blocking it. No Server
  Action exists for this feature to route through anyway.

## Out-of-scope work needed

- **AS-263/AS-264/AS-267/AS-268** (parent/child UI, completion count,
  cascade soft-delete on parent delete, promote-to-top-level) are
  separate assertions in this mission's contract (section E, Subtasks &
  checklists) and were not touched — this feature is schema-only. A
  future Server Action feature building subtasks should add the Zod
  schema mirroring this migration's invariants (self-reference, one
  level, same project) per the Clarified implementation's validation
  answer, and should be aware that `enforce_task_parent_rules()` already
  raises a plain-text Postgres exception on violation — the Server Action
  will need to map that error to a field-level message in its
  discriminated-union result, per this feature's own Clarified
  implementation "Failure/error handling" answer.
- **AS-267 (cascade soft-delete)** specifically needs to know that
  `parent_task_id` is a plain FK with no `ON DELETE` behavior configured
  (soft-delete is a `deleted_at` UPDATE, not a hard DELETE, so `ON DELETE
  CASCADE` would never fire anyway) — that feature must implement the
  cascade explicitly (e.g. its own trigger or Server Action fan-out) when
  a parent's `deleted_at` is set.
- **F132 sweep** (project-visibility RLS): see the checklist above, also
  written inline as a comment block at the bottom of
  `supabase/migrations/20260819071050_subtasks_parent_task_id.sql`.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Extended the same-project invariant to also guard
moving an existing parent to a different project (not just rejecting a
mismatched parent/child pair at write time), since the spec's "enforced
in the database" instruction and the Definition of done's cross-project
leak requirement both point at closing this gap rather than leaving a
half-enforced invariant. No new dependency or second source of truth was
introduced — it's the same trigger, same check shape (query for live
children), just triggered by a different column changing.

## Notes for the next worker

- The new trigger fires on `before insert or update of parent_task_id,
  project_id on tasks` — narrower than a blanket `before insert or update
  on tasks`, so ordinary field edits (title, status, etc.) never pay the
  extra lookup cost and can't accidentally trip these checks.
- `enforce_task_parent_rules()` raises plain `raise exception '...'`
  messages (default SQLSTATE, no custom errcode) — a future Server Action
  wrapping these inserts/updates should match on message content or treat
  any error from a `parent_task_id`/`project_id`-touching write as a
  validation failure rather than relying on a specific Postgres error
  code.
- MCP usage: none required at runtime beyond `supabase db push` /
  `supabase gen types` (the Supabase CLI, not the Supabase MCP server —
  this mission's existing pattern per F145's handoff uses the CLI for
  migrations/types and MCP only for live introspection when needed; no
  live introspection was needed here beyond what `supabase db push`'s own
  output and the subsequent tests already verified).
- Verified directly against the live linked project (not just locally):
  `supabase db push` applied cleanly with no errors, and
  `tests/integration/db-subtasks.test.ts` exercises the real deployed
  trigger/constraint via the admin client — this is the "verify via MCP
  or equivalent live check" evidence for a DB-only feature.
