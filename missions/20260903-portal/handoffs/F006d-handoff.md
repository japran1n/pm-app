# Handoff: F006d — Close the three authorisation gaps

## Status
COMPLETE

## Assertions covered
None directly assigned (per the feature spec: "these protect AS-054 and the
mission's general rule that authorisation is enforced server-side").

## Files changed
lib/actions/phases.ts
tests/integration/f002-phase-management.test.ts
supabase/migrations/20260914010000_f006d_authz_gaps.sql

## Commands run
`npm run db:apply -- supabase/migrations/20260914010000_f006d_authz_gaps.sql` (0)
`npm run db:gen-types` (0, no diff to lib/supabase/database.types.ts — only function bodies changed, no signature change)
`npm run migrations:check` (0)
`npx vitest run tests/integration/f002-phase-management.test.ts` (0 — 24/24 passed, including the 4 new tests)
`npx tsc --noEmit` (0)
`npm run lint` (0 errors, 20 pre-existing warnings, unchanged from the M1 scrutiny baseline — none introduced by this feature)
`node --env-file=.env <scratchpad script>` — direct Management-API `pg_proc.proconfig`/`proacl` queries to verify pg_temp pinning and grants before/after (see Decisions made)
`node --env-file=.env <scratchpad script>` — smoke-tested `create_channel_atomic` end-to-end via `admin.rpc(...)` (real workspace/users/channel, cleaned up after) — channel + 2 channel_members rows created successfully, confirming defect 3's fix did not regress chat channel creation

## Decisions made

- **Defect 1 (`bulkSetTaskPhase`, `lib/actions/phases.ts`):** Ported
  `bulkUpdateTasks`'s private-project visibility gate
  (`lib/actions/tasks.ts:3994-4012`, confirmed by direct read before
  editing) verbatim: added `visibility` to the `TaskRow`/`Context` types
  (the query already selected it — it was just dropped), added the same
  batched `project_members` lookup scoped to only the private projects
  touched by the call, and added the identical
  `visibility === "private" && role !== "owner" && role !== "admin" &&
  !explicitMemberProjectIds.has(projectId)` check in the per-task loop.
  **Behaviour on a forbidden task matches the precedent exactly**: the
  task is pushed to `failedIds` with reason `"You don't have access to
  this task's project."` and the loop `continue`s — the whole batch does
  NOT fail; every other permitted task in the same call still succeeds.
  This is `bulkUpdateTasks`'s own partial-success shape, and it's also
  what this file's own existing tests for `viewer`/`client` already
  assert for `bulkSetTaskPhase` (`result.ok` stays `true`,
  `failedIds` carries the rejection).

- **Defect 2 (`seed_default_phases`):** Switched the guard from the
  `= 'client'` deny-list to `in ('viewer', 'client')` — the same
  allow/deny predicate `is_project_workspace_writer`
  (`20260908010000:69-84`, confirmed by grep: `wm.role not in ('viewer',
  'client')`) already uses for `project_phases_insert_team`, so the RPC's
  own internal check now agrees with the RLS policy it sits in front of.
  Body/signature/grants otherwise byte-identical to the live definition.

- **Defect 3 (`create_channel_atomic`):** Re-issued with `set search_path
  = public, pg_temp`, forward-only (`create or replace function`, no
  drop needed — the signature F002b settled on in `20260910010000` is
  unchanged), preserving grants (`authenticated, service_role`) exactly.
  Verified via `pg_proc.proacl` before and after that the grant set is
  unchanged, and smoke-tested the RPC directly (see Commands run) to
  confirm chat channel creation still works.

- **Step 4 sweep, scope boundary:** The spec says "sweep every SECURITY
  DEFINER function **this mission** has added or replaced." I resolved
  "this mission" by grepping every migration's own header comment for
  the literal tag `missions/20260903-portal` (per this mission's own
  `git log`/handoff convention of stamping every file this way) rather
  than by date range, because date range is misleading here: several
  migrations dated between this mission's F001 (`20260909010000`) and
  today carry OTHER missions' tags in their header comments (see next
  bullet). This produced five tagged migrations with SECURITY DEFINER
  functions: F001 (`20260909010000`), F002b (`20260910010000`), F004
  (`20260911010000`), F005b (`20260912010000`), F006b (`20260913010000`,
  no SECURITY DEFINER function — RLS policy only), plus this feature's own
  migration.

- **Two additional gaps found, correctly left OUT of scope:** while
  grepping the whole `supabase/migrations/` directory for every
  `security definer` function regardless of date, I found two more RPCs
  with the exact same defect class (`set search_path = public`, no
  `pg_temp`, unqualified table refs, `grant execute … to authenticated`):
  `accept_client_request_atomic` (`20260905100000`) and
  `change_workspace_slug_atomic` (`20260905110000`). Both files' own
  header comments open with `-- W7e (missions/20260828-hardening/
  w7-atomicity-triage.md, Tier 2)` — a DIFFERENT mission, not this one,
  even though the migration timestamp falls inside this mission's date
  range. I also found `check_doc_folder_scope` (`20260904010000`, a
  SECURITY DEFINER **trigger** function, also unpinned, also unqualified
  `doc_folders` reference) — its header is `-- W1
  (docs/docs-system-plan.md)`, untagged to any mission. I initially wrote
  a fix for `check_doc_folder_scope` into the migration (reasoning that
  the spirit of "one regression is evidence the sweep is worth doing" —
  the feature spec's own words — justified closing every gap found), then
  reverted that decision: the spec's literal scope is "this mission,"
  I have grep evidence these three functions are not this mission's, and
  the hard rule is "implement only what your feature spec covers ...
  anything out of scope goes into Out-of-scope work needed." I reverted
  `check_doc_folder_scope` on the live database back to its original
  `20260904010000` definition (verified via `pg_proc.proconfig`,
  confirmed `search_path=public` with no `pg_temp`, matching the
  as-committed migration file byte-for-byte) and left the migration file
  covering only the two in-scope fixes. All three are listed in
  Out-of-scope work needed below with exact file/line citations for a
  follow-up feature.

- **Grants pre-existing artifact, not a regression:** `pg_proc.proacl`
  shows `anon=X` (EXECUTE) on every function checked, including
  long-standing ones like `apply_status_template` (`20260903010000`,
  predates this mission) and `is_project_client`
  (`20260908010000`) that already do `revoke all … from public`. This is
  a project-wide Supabase default-privilege setting
  (`ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ... TO anon`), not
  something this migration introduced or could regress by adding its own
  `revoke all … from public` statements — confirmed by querying `proacl`
  on `apply_status_template` (untouched by this feature) before touching
  anything, and it already shows the identical `anon=X` entry. Matches
  the M1 scrutiny report's own Minor finding on
  `is_project_portal_enabled` ("UUIDs are unguessable, so practical
  severity is low"). Not fixed here — schema-wide default-privilege
  changes are outside this feature's three named defects.

## Out-of-scope work needed

- **M3 (project_phases write-policy visibility conjunct)** — M1
  scrutiny's own Major-3 finding: `project_phases_insert_team` /
  `_update_team` / `_delete_team` (`20260909010000:163-183`) use
  `is_project_workspace_writer(project_id)` alone, without
  `is_project_visible_to(project_id)`, unlike the sibling
  `project_statuses_insert_admin` pattern
  (`20260828040000:76-83`). A workspace `member` not in
  `project_members` of a `visibility = 'private'` project can still
  insert/update/delete that project's phases via RLS directly (not
  through `lib/actions/phases.ts`, which already applies its own
  `withAuthz` gate — this is a defense-in-depth gap at the RLS layer).
  `seed_default_phases` never calls `is_project_visible_to` either. The
  feature spec for F006d named only the deny-list→allow-list swap for
  `seed_default_phases` (defect 2) — the visibility conjunct on the three
  write policies was NOT in scope and is not addressed here. A follow-up
  feature should add `is_project_visible_to(project_id) and` to all three
  policies and to `seed_default_phases`'s own guard.

- **`accept_client_request_atomic`** (`supabase/migrations/
  20260905100000_accept_client_request_atomic.sql:33`) — `security
  definer`, `set search_path = public` (no `pg_temp`), unqualified
  `client_requests`/`tasks` refs, `grant execute … to authenticated`
  (line 79). Same exploitable-shadow class as this feature's defect 3.
  Belongs to a different mission (`missions/20260828-hardening`'s W7e),
  so left unfixed here per this feature's scope boundary — a follow-up
  should re-issue it with `set search_path = public, pg_temp`.

- **`change_workspace_slug_atomic`** (`supabase/migrations/
  20260905110000_change_workspace_slug_atomic.sql:36`) — same gap,
  `grant execute … to authenticated, service_role` (line 72). Same
  mission attribution and recommendation as above.

- **`check_doc_folder_scope`** (`supabase/migrations/
  20260904010000_docs_system.sql:48`) — SECURITY DEFINER trigger
  function, `set search_path = public` (no `pg_temp`), unqualified
  `doc_folders` reference inside the body. Untagged to any mission (`--
  W1 (docs/docs-system-plan.md)`). Lower exploitability than the two
  above (trigger functions can't be invoked directly over PostgREST,
  only fire in the invoking session's search_path context on a genuine
  `INSERT`/`UPDATE` of `doc_folders` the caller was already permitted to
  make), but still closeable the same way. A follow-up should re-issue it
  with `set search_path = public, pg_temp`.

- **Schema-wide `anon` default-privilege grant** — every SECURITY
  DEFINER function checked (in-scope and out-of-scope alike) is
  executable by `anon` via a project-level default-privilege setting,
  independent of any individual migration's `revoke all … from public`.
  Matches the M1 scrutiny report's Minor finding on
  `is_project_portal_enabled`. Not a regression of this feature; a
  project-wide `alter default privileges … revoke execute on functions
  from anon` (with per-function re-grants where anon access is actually
  intended, if any) would need its own review, well beyond three named
  authorisation gaps.

## Blockers

(none — Status is COMPLETE)

## Autonomous decisions

AUTONOMOUS_DECISION: Interpreted "this mission" in step 4's sweep
instruction as migrations whose own header comment is tagged
`missions/20260903-portal`, not as "every migration dated after this
mission's earliest migration," because several migrations in that date
range are provably tagged to other missions (grep evidence in Decisions
made / Out-of-scope work needed). This keeps the fix set to exactly what
the spec's own scope section names, while still surfacing the two
genuinely-equivalent gaps found by the broader sweep as follow-up work
rather than silently expanding this feature or silently dropping them.

AUTONOMOUS_DECISION: Added two new integration tests beyond the DoD's
literal wording — one confirming the private-project gate does NOT
falsely reject a task in a private project the caller IS an explicit
member of (a true-positive/false-positive pair), and one confirming
`seed_default_phases` is rejected with Postgres errcode `42501` when
called directly over the RPC boundary as a signed-in `viewer` (not
through the `withAuthz`-gated Server Action) — this is the exact bypass
path M1 scrutiny's M2 finding describes, and the existing
`describe.each` viewer/client tests in this file only exercise the
Server Action, which was never the vulnerable boundary.

## Notes for the next worker

- **Full SECURITY DEFINER sweep (step 4), every function this mission
  (migrations explicitly tagged `missions/20260903-portal`) has added or
  replaced, verified via `pg_proc.proconfig` against the live linked
  Supabase project after this migration was applied:**

  - [x] `is_project_portal_enabled` (`20260909010000`, F001) —
    `search_path=public, pg_temp`
  - [x] `is_task_visible_to` (`20260909010000`, F001, replaces
    `20260906010000`'s definition) — `search_path=public, pg_temp`
  - [x] `seed_default_phases` (`20260909010000`, F001; re-issued by this
    feature's `20260914010000`) — `search_path=public, pg_temp` (was
    already pinned in `20260909010000` — the deny-list/allow-list bug
    fixed by this feature was a role-check defect, not a `pg_temp`
    defect; confirmed both are now correct)
  - [x] `create_channel_atomic` (`20260910010000`, F002b; re-issued by
    this feature's `20260914010000`) — `search_path=public, pg_temp`
    (was MISSING `pg_temp` before this feature — defect 3, now fixed)
  - [x] `seed_default_project_statuses` (`20260911010000`, F004) —
    `search_path=public, pg_temp`
  - [x] `create_workspace_with_owner` (`20260912010000`, F005b) —
    `search_path=public, pg_temp`
  - N/A `20260913010000` (F006b) adds no SECURITY DEFINER function (RLS
    policy changes only — confirmed by grep, no `security definer` match
    in that file)

  Two functions of the identical defect class exist elsewhere in the
  schema but are NOT this mission's (see Out-of-scope work needed for
  citations and recommended fix): `accept_client_request_atomic`,
  `change_workspace_slug_atomic` (both `missions/20260828-hardening`),
  and `check_doc_folder_scope` (untagged `docs-system-plan.md`).

- No MCP tools were used — the Supabase MCP is not authorised for this
  mission per the task instructions; all schema introspection and
  migration application went through the repo's own `npm run db:apply` /
  `npm run db:gen-types` scripts (Management API, `SUPABASE_ACCESS_TOKEN`)
  plus small one-off verification scripts in the scratchpad directory
  (deleted after use) that queried `pg_proc.proconfig`/`proacl` via the
  same Management API query endpoint `scripts/apply-migration.mjs` uses.

- `lib/supabase/database.types.ts` regenerated but produced **no diff** —
  expected, since none of this feature's SQL changes touch a table
  schema or function signature, only function bodies/`search_path`.
