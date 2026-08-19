# Handoff: F145 — project keys and per-project task numbers

## Status
COMPLETE

## Assertions covered
AS-257: PASS — every project gets a short, uppercase, 2-6 char key (format `^[A-Z][A-Z0-9]{1,5}$`), unique within its workspace. Covered by `tests/integration/db-task-keys.test.ts` (`test_AS_257_project_gets_a_short_unique_key_on_creation`, `test_AS_257_two_same_named_projects_in_one_workspace_get_different_unique_keys`, `test_AS_257_key_uniqueness_is_scoped_per_workspace_not_global`, `test_AS_257_negative_direct_insert_with_a_duplicate_key_in_the_same_workspace_is_rejected`, `test_AS_257_negative_db_check_rejects_a_malformed_key_even_bypassing_generation`).
AS-259: PASS — task numbers are assigned by an atomic counter increment (`UPDATE projects SET task_counter = task_counter + 1 ... RETURNING`) inside the same BEFORE INSERT trigger invocation as the task row's own insert, never a `max(number)+1` read. Proven with a genuine concurrency test firing 25 real concurrent inserts (`Promise.all`, each its own PostgREST round trip) into the same project and asserting the 25 returned numbers are exactly `1..25` with zero duplicates (`test_AS_259_concurrent_task_inserts_into_the_same_project_never_collide_on_number`, run with `--testTimeout=30000`), plus a negative test proving the `tasks_project_id_number_idx` UNIQUE index independently rejects a forced duplicate even bypassing the trigger's own number.
AS-260: PASS — `projects.task_counter` is a monotonically-increasing counter column, never derived from `count()`/`max()` of live rows, so a soft-deleted task's number is never reissued. Covered by `test_AS_260_a_softdeleted_tasks_number_is_never_reissued_to_a_later_task` (soft-deletes every live task down to zero, then proves the next task's number still climbs past the highest ever issued) and `test_AS_260_projects_task_counter_never_decreases_across_deletes`.
AS-261: PASS — the historical backfill (`20260819061129_project_keys_and_task_numbers.sql`) ran once against the live linked project during this work session and gave every pre-existing project/task a key/number, ordered by `(created_at, id)`. Verified directly against the live DB during implementation (see Decisions made) and covered by an automated global-invariant test (`test_AS_261_negative_pre_existing_rows_in_the_database_all_have_a_real_key_and_number_no_stale_sentinels_remain`) plus two tests that exercise the exact same shared mechanism the backfill uses — `public.generate_unique_project_key` for the deterministic disambiguation rule (`test_AS_261_key_disambiguation_rule_is_deterministic_by_creation_order_same_rule_the_backfill_uses`) and the `created_at`-ordered numbering shape (`test_AS_261_tasks_created_in_sequence_receive_strictly_increasing_numbers_in_creation_order`). See "Notes for the next worker" for why the backfill itself can't be re-triggered from an automated test.

## Files changed
supabase/migrations/20260819061129_project_keys_and_task_numbers.sql
supabase/migrations/20260819061442_project_key_task_number_insert_defaults.sql
lib/supabase/database.types.ts
tests/integration/db-task-keys.test.ts

## Commands run
`supabase migration new project_keys_and_task_numbers` (0)
`supabase db push` (0) — applied 20260819061129_project_keys_and_task_numbers.sql
`supabase migration new project_key_task_number_insert_defaults` (0)
`supabase db push` (0) — applied 20260819061442_project_key_task_number_insert_defaults.sql
`supabase gen types typescript --linked` (0) — regenerated lib/supabase/database.types.ts twice (once per migration above)
`npx vitest run tests/integration/db-task-keys.test.ts --testTimeout=30000` (0) — 12/12 passed
`npx vitest run --testTimeout=30000` (0) — full suite, 594/594 passed across 105 files
`npx tsc --noEmit` (0)
`npx eslint .` (0 errors, 1 pre-existing warning: `lib/queries/search.ts:159` `_titleMatches` unused — not from this feature)

Note on timeouts: the default 5s vitest timeout is not reliable against the
real remote Supabase project (network round trips, `auth.admin.createUser`
calls, and this feature's own concurrency test add up), so every run above
used `--testTimeout=30000` per the mission brief. `--hookTimeout` also
needed lifting for this file's own `afterAll` at the default settings
(fixed properly instead: batched the cleanup deletes with `.in(...)`
rather than one round trip per row, since the AS-259 test alone creates 25
task rows — see `tests/integration/db-task-keys.test.ts`'s `afterAll`).

## Decisions made

- **Trigger-based assignment, not a Server Action/RPC change.** The
  Clarified implementation's "Touches" answer scopes this feature to
  `supabase/migrations/` + `lib/supabase/database.types.ts` only. Both
  `projects.key` and `tasks.number` are populated by `BEFORE INSERT`
  triggers (`assign_project_key()`, `assign_task_number()`), so every
  existing insert path — the admin-client Server Actions in
  `lib/actions/projects.ts`/`lib/actions/tasks.ts`, any future
  authenticated-role insert, and every existing test fixture that does a
  raw `.insert()` — gets a key/number for free with zero application-code
  changes. `lib/actions/*.ts` was NOT touched.

- **Atomic numbering mechanism (AS-259).** `assign_task_number()` does
  `UPDATE projects SET task_counter = task_counter + 1 WHERE id =
  new.project_id RETURNING task_counter INTO new.number` inside the same
  `BEFORE INSERT` trigger invocation as the task row's own insert — i.e.
  the same statement/transaction, never a separate `select max(number)+1`
  read. Concurrent inserts into the same project serialize on the
  `projects` row's lock from that `UPDATE`. Proven, not just asserted —
  see AS-259 above.

- **AS-260 mechanism.** `task_counter` only ever increments; it is never
  recomputed from `count(*)`/`max(number)` of live (non-soft-deleted)
  rows, so a deleted task's number can never be handed to a later task.

- **Both triggers are `SECURITY DEFINER`** (mirroring
  `create_workspace_with_owner` / `start_timer_atomic` elsewhere in this
  schema), so key/number assignment never depends on the inserting role's
  own RLS-gated UPDATE privilege on `projects` — it only fires for rows
  the existing `tasks_insert_active_members`/`projects_insert_active_members`
  policies already allowed to be inserted, so this does not widen who can
  create a project/task.

- **No new RLS policy added.** `projects.key`/`task_counter` and
  `tasks.number` are plain columns on tables already fully covered by the
  mission-1 policies (`projects_select_active_members`,
  `projects_insert_active_members`, `projects_update_active_members` from
  `20260818004709_rls_projects.sql`; `tasks_select_active_members`,
  `tasks_insert_active_members`, `tasks_update_active_members` from
  `20260818013805_rls_tasks.sql`), both scoped through
  `workspace_members` exactly as the dependency correction in this
  worker's brief required. **F132 sweep checklist** (also written inline
  in the migration file, per the brief's instruction to give the later
  sweep a checklist rather than rely on memory):
  - No new policy was added anywhere in this feature.
  - Two `SECURITY DEFINER` trigger functions were added:
    `public.assign_project_key()`, `public.assign_task_number()` — not
    directly callable by client roles for anything beyond their trigger
    use, and neither references or assumes `is_project_visible_to()`.
  - Two `SECURITY DEFINER` helper functions were added, granted EXECUTE
    to `authenticated`/`anon`/`service_role`:
    `public.derive_project_key_base(text)`,
    `public.generate_unique_project_key(uuid, text)` — pure key-derivation
    logic, take no row-visibility shortcut, and should not need to change
    when F132 lands.
  - Two new constraints: `projects_key_format` (CHECK),
    `projects_key_unique_per_workspace` (UNIQUE on
    `workspace_id, key`), `tasks_number_positive` (CHECK), and the unique
    index `tasks_project_id_number_idx` on `(project_id, number)`. None
    reference project visibility.
  - `is_project_visible_to()` is not called or invented anywhere in this
    feature, per the brief's explicit instruction.

- **Key derivation algorithm** (`public.derive_project_key_base`,
  documented in full in the migration's comments): 2+ words with a
  leading letter → initials of up to the first 6 such words (e.g.
  "Product Marketing" → "PM"); otherwise → the first 6 letters of the
  name with non-letters stripped (e.g. "Marketing" → "MARKET"), padded
  with `X` if only 1 letter, or `PRJ` if the name has no letters at all.
  Chosen for being dependency-free, pure SQL, and deterministic — the
  "simpler option" the clarification file's Round B Q2 asked for.

- **Deterministic backfill collision disambiguation rule** (the "two
  projects both named Marketing" question flagged as open in the feature
  spec's Notes): whichever project is resolved FIRST — oldest
  `created_at` (tiebroken by `id`) for the historical backfill, insertion
  order for live inserts — keeps the bare base key. Every later collision
  on the same base within the same workspace appends the smallest unused
  integer suffix starting at 2 (`base`, `base2`, `base3`, ...), trimming
  the base so the combined candidate never exceeds 6 characters. This is
  implemented once, in `public.generate_unique_project_key`, and called
  by BOTH the `projects_assign_key` trigger and the one-time backfill DO
  block — so "how a new project gets its key" and "how a pre-existing
  project gets its key retroactively" are provably the same algorithm.

- **`key`/`number` given trivial `''`/`0` DEFAULTs in a second migration
  (`20260819061442_...`), not the first.** `supabase gen types` infers
  Insert-type optionality from a registered column `DEFAULT`, not from
  `NOT NULL` + a trigger. Without a `DEFAULT`, regenerating
  `database.types.ts` after the first migration made `key`/`number`
  *required* in the generated `Insert` type, which broke `npx tsc
  --noEmit` on files this feature is not allowed to touch
  (`lib/actions/projects.ts`, `lib/actions/tasks.ts`,
  `tests/unit/fts-tasks.test.ts` — none of them pass `key`/`number`
  today, correctly, since both are server-generated). Fixed at the DB
  layer instead of touching those files: `''`/`0` are inert sentinels
  (rejected by `projects_key_format`/`tasks_number_positive` if they ever
  reached storage) that the trigger functions now treat identically to
  `NULL` and always overwrite before the row is stored. This kept the
  fix inside `supabase/migrations/` + `database.types.ts`, honoring the
  Clarified implementation's file scope. The historical backfill in the
  first migration already ran against genuinely-NULL columns (no
  `DEFAULT` existed yet at that point), so no data was affected by this
  follow-up — verified directly (see below).

- **`derive_project_key_base`/`generate_unique_project_key` execute
  grants include `authenticated`/`anon`** even though nothing in the
  app currently calls them client-side, matching this feature's decision
  to make them reusable, independently-testable units (the AS-261 tests
  call `derive_project_key_base` via `.rpc()` directly) rather than
  inlining the logic only inside the trigger bodies.

## Out-of-scope work needed

- No Server Action or UI lets a user edit a project's key after creation.
  The feature spec's Draft scope says the key is "editable later"; the DB
  layer already supports this (any `UPDATE projects SET key = ...` is
  validated by the same `projects_key_format`/
  `projects_key_unique_per_workspace` constraints), but no
  `editProjectKey` Server Action exists yet. Not required by AS-257/
  AS-259/AS-260/AS-261 — likely belongs with F146 (task-key-display) or a
  dedicated future feature.
- AS-258 (human-readable `PM-142` display) and AS-262 (exact-key search)
  are explicitly out of scope for F145 and are already tracked as
  separate plan.md entries: F146 task-key-display, F147 task-key-search.
  Both can now build directly on `projects.key` and `tasks.number`
  without any further schema work.
- No UI surfaces `projects.key` anywhere yet (by design — F146's job).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used a `BEFORE INSERT` trigger pair instead of
routing `projects`/`tasks` creation through a new RPC (the pattern used
elsewhere in this schema for atomic operations, e.g.
`create_workspace_with_owner`, `start_timer_atomic`), specifically
because the Clarified implementation's "Touches" answer forbids editing
`lib/actions/*.ts` for this feature, and an RPC-based design would have
required changing `createProject`/`createTask` to call `.rpc(...)`
instead of `.insert(...)`. The trigger design achieves the same atomicity
guarantee (same statement/transaction as the row's own insert) with zero
application-code changes.

AUTONOMOUS_DECISION: Added a second, small follow-up migration
(`20260819061442_project_key_task_number_insert_defaults.sql`) rather
than editing the already-applied first migration, per this mission's
"migrations are additive" convention and the existing repo precedent
(`20260818013108_project_name_not_blank_constraint.sql` as a follow-up to
`20260818004413_create_projects.sql`). Editing an already-`db push`-ed
migration file in place would not have re-applied on the remote project
anyway (the CLI tracks applied versions), so a new file was the only
correct option regardless.

AUTONOMOUS_DECISION: Chose the initials/first-6-letters key-derivation
algorithm and the base+numeric-suffix disambiguation rule myself (Round B
Q2 of the clarification file: "take the simpler option that does not add
a dependency ... record the choice in the handoff"), since the feature
spec's Notes flagged the backfill collision case as open without
prescribing an exact algorithm.

## Notes for the next worker

- **Live-DB verification of the backfill (AS-261).** During
  implementation I ran a throwaway script against the linked project
  (`qcipqonnqajmazdbysow`) confirming: `select count(*) from projects
  where key is null or key = ''` → 0, and the same for `tasks.number`
  (`is null or = 0`) → 0, across every pre-existing row, immediately
  after `20260819061129_...` was pushed. Sample output showed the
  disambiguation rule working on real pre-existing data, e.g. two
  projects named "F037 Project ..." and "F037 Other Project ..." (from an
  earlier mission's test fixtures) got keys `FPM` and `FOPM` respectively
  — different initials because the names differ, not a collision case,
  but it confirms the initials algorithm ran correctly end-to-end against
  real historical rows. The script was a temp file, not committed.
- **Why AS-261 isn't (and can't cleanly be) tested by literally
  re-running the historical backfill from vitest:** once the
  `BEFORE INSERT` triggers exist, any row inserted through the
  PostgREST-backed admin client always gets a key/number immediately —
  there's no way to create a "pre-existing row without a key" fixture
  through `.from("projects").insert(...)` to feed back into the backfill
  DO block, short of disabling the trigger via raw DDL, which the
  `@supabase/supabase-js` client used by this test suite has no access
  to (PostgREST is row CRUD only). The chosen approach instead tests the
  exact reusable mechanism the backfill uses
  (`generate_unique_project_key`, `created_at`-ordered numbering) through
  ordinary sequential row creation, plus the live-DB spot check above.
  If a future worker gets Postgres MCP / `mcp__supabase__execute_sql`
  actually connected (it was listed "Pending approval" for this session —
  see `connections/mcp-registry.md`), that would allow a more literal
  disable-trigger-insert-reenable-backfill test; not blocking for this
  feature.
- The Supabase MCP (`mcp__supabase__*`) was unavailable this run (not in
  this worker's tool search results, consistent with
  `connections/mcp-registry.md`'s "Pending approval" note) — all schema
  work went through the Supabase CLI (`supabase migration new`,
  `supabase db push`, `supabase gen types typescript --linked`) per the
  registry's guidance to never block on MCP approval. `mcp__postgres__*`
  was listed as available to this worker's role but no tool matching that
  prefix was found via tool search either; not needed since the CLI path
  worked end to end.
- `lib/supabase/database.types.ts` picked up one unrelated addition on
  regen: `is_valid_timezone` (a pre-existing RPC function, from
  `20260818225500_profiles_timezone_check.sql`/F275, that just hadn't
  made it into a prior regen). Harmless full-file regen byproduct, not
  something this feature added or changed.
