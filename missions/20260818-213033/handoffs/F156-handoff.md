# Handoff: F156 — dependency cycle guard

## Status
COMPLETE

## Assertions covered
AS-278: PASS — a dependency that would create a cycle is rejected with a message naming the conflict. Enforced by a new BEFORE INSERT trigger, `public.enforce_task_dependency_no_cycle()` (`supabase/migrations/20260819103337_dependency_cycle_guard.sql`), which runs a recursive CTE walking existing `task_dependencies` edges outward from the newly-blocked task to check whether it can already reach the newly-blocking task, but only AFTER acquiring `pg_advisory_xact_lock(hashtextextended(workspace_id::text, 0))` — a transaction-scoped advisory lock keyed on the dependency's workspace. That lock is the actual concurrency mechanism; see "Decisions made" below for exactly why it closes the TOCTOU race. Covered by `tests/integration/dependency-cycle.test.ts`: `test_AS_278_a_direct_two_task_A_blocks_B_then_B_blocks_A_cycle_is_rejected` (2-cycle), `test_AS_278_a_three_task_A_blocks_B_blocks_C_then_C_blocks_A_cycle_is_rejected` (3-cycle, plus a same-graph non-cycle shortcut edge proven to still be allowed), `test_AS_278_the_rejection_names_the_conflicting_tasks_key_and_title` (via the new `createDependency` Server Action, proves the error text contains both tasks' real `KEY-NUMBER` and title), and `test_AS_278_two_concurrent_inserts_that_would_together_close_a_cycle_do_not_both_succeed` (the actual race: two independent Postgres clients each insert one direction of the same A/B pair via `Promise.all`, NOT sequentially — exactly one wins, the other is rejected with the cycle message, and a direct re-read confirms only one row exists for the pair).

## Files changed
supabase/migrations/20260819103337_dependency_cycle_guard.sql
lib/validation/dependencies.ts
lib/actions/dependencies.ts
tests/integration/dependency-cycle.test.ts
tests/unit/dependency-cycle-validation.test.ts

## Commands run
`supabase migration new dependency_cycle_guard` (0)
`supabase db push` (0) — applied `20260819103337_dependency_cycle_guard.sql` cleanly against the linked project (ref `qcipqonnqajmazdbysow`); one harmless NOTICE ("trigger ... does not exist, skipping") from the migration's own `drop trigger if exists` guard on a fresh trigger name, same pattern as every prior trigger-adding migration in this mission.
`npx vitest run tests/unit/dependency-cycle-validation.test.ts --no-file-parallelism` (0) — 5/5 passed
`npx vitest run tests/integration/dependency-cycle.test.ts --no-file-parallelism --testTimeout=30000` (0) — 4/4 passed
`npx vitest run tests/integration/rls-dependencies.test.ts --no-file-parallelism --testTimeout=30000` (0) — 9/9 passed (F155's own suite, re-run to confirm this feature's new trigger introduces no regression on the table it shares)
`npx tsc --noEmit` (0)
`npx eslint .` (0 errors, 1 pre-existing warning: `lib/queries/search.ts:232` `_titleMatches` unused — not from this feature, same warning F155's and F148's handoffs already noted)

Per the process rules for this run, the full vitest suite was NOT run (the
orchestrator runs it between features) and no command was backgrounded —
everything above ran in the foreground, serially (`--no-file-parallelism`)
to avoid Supabase Auth rate limits from the tests' several
`auth.admin.createUser` calls. No dev server was started (this feature has
no UI surface — cycle rejection is exercised through the database and a
Server Action); Playwright was not run — no assertion here is about live
UI interaction.

## Decisions made

- **How concurrency is actually prevented — the load-bearing mechanism.**
  `public.enforce_task_dependency_no_cycle()` (BEFORE INSERT, per-row)
  calls `perform pg_advisory_xact_lock(hashtextextended(v_workspace_id::text, 0))`
  BEFORE running its recursive-CTE cycle check, where `v_workspace_id` is
  resolved from the inserting row's `blocking_task_id`. This is a
  **transaction-scoped** advisory lock (`_xact_`, not `_session_`): it is
  held until the holding transaction commits or rolls back, and cannot be
  released early by the same session the way a session-level advisory
  lock could. Two concurrent INSERTs on `task_dependencies` whose tasks
  live in the same workspace therefore cannot both be past the lock
  acquisition at once — the second transaction blocks inside
  `pg_advisory_xact_lock` until the first transaction ends. Postgres's
  default READ COMMITTED isolation gives each *statement* (not each
  transaction) a fresh snapshot of committed data when that statement
  starts; because the recursive CTE below runs only after the lock call
  returns, the second transaction's cycle-check statement necessarily
  starts (and takes its snapshot) only once the first transaction has
  already committed its insert (or rolled back and released the lock
  having written nothing) — so the second transaction's check is
  guaranteed to see whatever the first one actually persisted. This is
  exactly the property a plain pre-insert `SELECT` (in application code
  or as a separate query) cannot provide: two such selects can both run
  concurrently, before either transaction commits, and each sees "no
  cycle" — the TOCTOU bug this feature exists to close. Dependencies
  never cross workspaces (F155's `task_dependencies_enforce_same_workspace`
  trigger, AS-285), so every pair of tasks that could possibly
  participate in one cycle share a single workspace id, meaning locking
  on that one key is sufficient to serialize every insert that could
  race on that graph — no finer-grained (and more failure-prone) locking
  scheme was needed. Verified directly, not just argued: the concurrent
  test above fires two real, independent Postgres client connections at
  the same pair via `Promise.all` (not sequential `await`s), and the
  result is deterministically exactly one success + one rejection, every
  run.

- **`lib/actions/dependencies.ts` does no pre-insert cycle check of its
  own — by design, not oversight.** `createDependency` always attempts
  the real INSERT through the RLS-respecting client and treats the
  database trigger as the single source of truth for whether a cycle
  exists. The only work this action does AFTER a rejected insert is
  build a human-readable message from data it already had before
  attempting the write (each task's title/key), never a fresh cycle
  check of its own — doing the latter would have reintroduced exactly
  the race this feature exists to close, just one layer up in
  application code instead of the database.

- **Naming the conflicting task: `blocked_task_id` is always the named
  task, and needs no extra graph walk.** When the trigger's recursive CTE
  finds that `NEW.blocked_task_id` can already reach `NEW.blocking_task_id`
  via existing edges, `NEW.blocked_task_id` is — by construction — the
  task that already (directly, in a 2-cycle, or transitively, in a longer
  ring) blocks `NEW.blocking_task_id`. This holds for any cycle length,
  so the action layer never needs to walk the chain to find "the"
  conflicting task; it already has that task's id as one of its own two
  input arguments. This is the simpler option per the clarification's
  ambiguity-resolution default (no new dependency, no second source of
  truth for "which task is the conflict").

- **The display string is built once, by `formatTaskKey` alone — the SQL
  trigger never formats a `KEY-NUMBER` string.** Per the worker brief's
  explicit instruction, `lib/tasks/task-key.ts`'s `formatTaskKey` (F146)
  is reused, not rebuilt: the trigger raises a plain message carrying
  only the raw conflicting task id (for logs), pattern-matched in
  `lib/actions/dependencies.ts` on the literal marker string
  `"task_dependency_cycle:"`. On a match, the action layer — which
  already looked up both tasks' `projectKey`/`number`/`title` before
  attempting the insert, purely so it would have this data on hand if
  needed — calls `formatTaskKey(task.projectKey, task.number)` to build
  the exact same key string used everywhere else in the app, then
  composes the final error: `` `Adding this dependency would create a
  cycle: ${key} — "${title}" already blocks ${key} — "${title}".` ``.

- **Pattern-matching on the trigger's message text, not a custom
  SQLSTATE.** F155's handoff left a note that a future action wrapping
  this table's writes "should treat any error from this write as a
  validation failure rather than pattern-matching a specific error
  code" — sound guidance for AS-285 (cross-workspace), which needs no
  bespoke user-facing text. AS-278 explicitly requires naming the
  conflict, which is impossible without first identifying that a cycle
  (specifically) is what failed, so this feature necessarily departs
  from that generic-fallback advice for this one case. Rather than invent
  a new custom SQLSTATE/errcode mechanism (a heavier, more novel
  approach than anything else in this migration set), the trigger's
  raised message begins with the fixed literal marker
  `"task_dependency_cycle:"`, and the action layer does one
  `.includes()` check against it — same "simplest option, no new
  dependency" default. Every other insert failure (uniqueness violation,
  RLS denial, a task that vanished between lookup and insert) still
  falls through to a fully generic message, exactly as F155's note
  intended.

- **`createDependency`'s cross-workspace defense-in-depth check reuses
  the generic "Task not found." message**, deliberately not a distinct
  "these are in different workspaces" message — this action must not
  itself become an oracle for discovering which workspace an id the
  caller isn't a member of belongs to. The real enforcement for
  cross-workspace rejection remains F155's
  `task_dependencies_enforce_same_workspace` trigger and its INSERT RLS
  policy; this check only avoids an unnecessary round trip to the
  database for an already-known-bad pair.

- **No `deleteDependency` action was added.** Only `createDependency`
  was needed to exercise AS-278 (the assertion assigned to this
  feature). AS-282 (removing a dependency from either side) was already
  explicitly out of scope in F155's own handoff and remains unassigned
  here — see "Out-of-scope work needed" below, unchanged from F155's
  note.

- **No separate "path-finding helper" was written in TypeScript,
  despite the feature spec's Draft scope mentioning a "unit test for the
  path-finding helper."** The only correct place for cycle detection is
  inside the database trigger's transaction, under its advisory lock —
  see the concurrency argument above. Any TypeScript reimplementation of
  the same reachability logic would either (a) never be called for the
  actual enforcement decision (dead code, pure risk of drifting out of
  sync with the real SQL logic), or (b) be used as a real pre-check,
  reintroducing the TOCTOU bug. Per this feature's own Clarified
  implementation answer ("validation: an automated test per assertion
  where feasible, plus a written enumeration... for structural/negative
  assertions") and the Definition of done's "primary test: the test type
  that fits," the fitting test type for this genuinely database/
  transaction-shaped behaviour is the integration test against the live
  trigger, not a unit test against a parallel TypeScript implementation
  that wouldn't actually be the code path being verified. The one unit
  test this feature does add (`tests/unit/dependency-cycle-validation.test.ts`)
  covers the one piece that IS pure, safe, client-side logic: the
  not-self input guard on `createDependencySchema`.

## Out-of-scope work needed

- **AS-277** (read side: a task showing what it blocks / what blocks it)
  — unchanged from F155's handoff, still not started.
- **AS-280/AS-281** (blocked-status warning + confirmation on the board/
  task UI) and **AS-282/AS-283** (removing a dependency from either
  side's UI, and its own UI affordance) — unchanged from F155's handoff,
  still UI/product features layered on top of this schema. This feature
  did not add a `deleteDependency` action; a future worker picking up
  AS-282 should follow this file's `createDependency` pattern
  (membership re-check via `requireActiveMembership`, the real delete
  through the RLS-respecting client using F155's
  `task_dependencies_delete_active_members` policy) rather than routing
  around it with the admin client.
- **F132 sweep**: this migration's addendum is written inline as a
  comment block at the bottom of
  `supabase/migrations/20260819103337_dependency_cycle_guard.sql` — one
  new trigger (`task_dependencies_enforce_no_cycle`, structural write-time
  guard, no RLS predicate changed, no sweep needed), nothing else.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used a fixed literal message-prefix marker
(`"task_dependency_cycle:"`) for the action layer to pattern-match on,
rather than introducing a custom Postgres SQLSTATE/errcode, because
AS-278's naming requirement cannot be met by treating every insert
failure generically (F155's handoff note), but a new errcode mechanism
would be a heavier, more novel pattern than anything else in this
migration set for a need fully met by a substring check — the simpler
option per the clarification's ambiguity-resolution default.

AUTONOMOUS_DECISION: Named `blocked_task_id` as "the conflicting task" in
every case (2-cycle or longer), rather than walking the existing chain to
find some other "more specific" task, because it is the one, well-defined
answer that requires no extra query beyond the boolean reachability check
the trigger already performs, and the action layer already holds that
task's id as one of its own two input arguments — no second lookup or
graph walk needed to name it.

## Notes for the next worker

- `enforce_task_dependency_no_cycle()` fires as its own independent
  BEFORE INSERT trigger, alongside F155's
  `task_dependencies_enforce_same_workspace` — trigger firing ORDER
  between the two is not relied upon for correctness by either: this
  trigger resolves its own workspace id independently (from
  `blocking_task_id`) rather than trusting the other trigger to have run
  first, and returns early (no lock, no check) if that task doesn't
  resolve to a real workspace at all, leaving that case for whatever
  other constraint/trigger is meant to reject a nonexistent task.
- The advisory lock key is `hashtextextended(workspace_id::text, 0)`, a
  64-bit hash of the workspace's UUID text. A hash collision between two
  different workspaces would only cause harmless extra serialization
  (two unrelated workspaces briefly contending for the same lock, never
  observable as incorrect behaviour) — it is not a correctness dependency
  of this feature, only a (negligible) liveness/performance one.
- Every dependency-graph mutation for a workspace goes through this one
  lock today (there is no `deleteDependency` action yet — see
  Out-of-scope above), so there is currently no code path that removes
  an edge concurrently with an insert to reason about; if/when
  `deleteDependency` is added, it does not need to take this same
  advisory lock itself, since removing an edge can never itself create a
  cycle — only the INSERT path needs the lock.
- MCP usage: none beyond the Supabase CLI (`supabase db push`), same
  convention F155/F148/F145's handoffs already established — the
  Supabase MCP server was not needed since the CLI's own push output plus
  the integration tests against the live linked project (ref
  `qcipqonnqajmazdbysow`) already constitute the live verification.
