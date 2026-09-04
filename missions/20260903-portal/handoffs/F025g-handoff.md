# Handoff: F025g — The constraint half of the sweep

## Status
COMPLETE

## Assertions covered
This feature has no assertion IDs of its own assigned in plan.md (remediation/sweep feature). It exists to close AS-023's regression risk, already assigned to earlier features. Re-verified here:
AS-023: PASS — `tests/integration/f025c-projects-guard-bypass-and-notification-kind.test.ts` (12 tests) and `tests/integration/f009b-close-second-approval-path.test.ts` (all subtests) both pass against the live linked database, confirming `decide_approval_atomic`'s notification insert (including the Approve path) succeeds under the current `notifications_kind_check` — the fix from F025c is live and correct today.

## Files changed
(none — this sweep found no undocumented constraint-value drop to fix)

## Commands run
`grep -noE 'alter table [a-zA-Z_.]+ add constraint [a-zA-Z_0-9]+' -i supabase/migrations/*.sql` (0) — enumerated every `add constraint` in every migration in the repo (not just `f0NN[a-z]_`-prefixed ones, to satisfy scope item 4: constraints this mission modified but did not originally create)
`grep -noE 'alter table [a-zA-Z_.]+ drop constraint( if exists)? [a-zA-Z_0-9]+' -i supabase/migrations/*.sql` (0) — same, for `drop constraint`
`grep -noE 'create table [a-zA-Z_.]+' -i supabase/migrations/*.sql` (0) — enumerated `create table` statements to check inline `check (...)` constraints
`ls supabase/migrations | awk -F_ '$1+0 > 20261019010000'` (0) — listed every migration after F025c to confirm none re-touches `notifications_kind_check`
`grep -n "field_changed" supabase/migrations/*.sql` (0) — traced a false-positive candidate (`task_activity.kind`, a different table/constraint) back to its own unrelated closed list
`grep -A15 "create_notification($" <15 files>` (0) — extracted every literal `p_kind =>` value passed to `create_notification()` across the whole migration history, plus traced `v_kind`-variable call sites (F018, F021c) to their assignment lines, to independently rebuild the full set of notification kinds ever inserted, rather than trusting F025c's own header comment
`npx vitest run tests/integration/f025c-projects-guard-bypass-and-notification-kind.test.ts tests/integration/f009b-close-second-approval-path.test.ts` (0, 19 passed) — live re-verification that F018's fix (via F025c) is correct today
`npx tsc --noEmit` (0, clean)
`npx eslint tests/integration/f025c-projects-guard-bypass-and-notification-kind.test.ts` (0, clean)

## Decisions made

### The enumeration (scope item 1)
Ran, across every migration file in `supabase/migrations/*.sql` (not restricted to `f0NN[a-z]_`-prefixed files, since scope item 4 explicitly widens beyond this mission's own migrations for constraints the mission modified but didn't create):

```
grep -noE 'alter table [a-zA-Z_.]+ add constraint [a-zA-Z_0-9]+' -i supabase/migrations/*.sql
grep -noE 'alter table [a-zA-Z_.]+ drop constraint( if exists)? [a-zA-Z_0-9]+' -i supabase/migrations/*.sql
grep -noE 'create table [a-zA-Z_.]+' -i supabase/migrations/*.sql
```

Full result set (9 `add constraint`, 10 `drop constraint`, plus every `create table`'s inline `constraint ... check (...)` clauses inspected by file).

### Grouping by table+constraint name (scope item 2)
Grouping the `add`/`drop` output by constraint name gives exactly one constraint touched by more than one migration: **`notifications_kind_check`**, re-created 4 times:
1. `20260823020000_create_notifications.sql` (pre-mission base, per the constraint's own values quoted in later headers — not itself in the mission's migration set but the origin of the chain, per scope item 4)
2. `20260916010000_approval_requests.sql` — widens to add `'approval_decided'`
3. `20260929010000_f015_flag_assumption_atomic.sql` — widens to add `'assumption_flagged'`
4. `20261012010000_f018_budget_threshold_sweep.sql` — **the known drop**: re-adds the constraint from the *original* 5-value list (`mention, comment_reply, task_assigned, task_due_soon, watcher_update`) plus its own two new budget kinds, silently losing `'approval_decided'` and `'assumption_flagged'` from steps 2 and 3
5. `20261019010000_f025c_projects_guard_bypass_and_notification_kind.sql` — **the fix**: widens to the full union of all 9 kinds

Every other constraint in the enumeration (`tasks_status_not_empty`, `project_statuses_client_bucket_check`, `task_types_system_key_check`, `projects_launch_confidence_check`) appears as a single `drop constraint if exists` + `add constraint` pair *within the same migration file* — a defensive idempotent-creation pattern (drop-if-exists then (re)create with the intended definition), not a cross-migration re-creation with history to diff. `workspace_members_role_check` is touched twice (`20260821184932_workspace_members_role_expansion.sql`, pre-mission, and `20260902010000_client_role_and_task_client_visibility.sql`, mission-era): diffed directly — the second migration's `check (role in (...))` list is the first's five roles (`owner, admin, member, viewer, guest`) plus one new value (`client`), strictly additive, nothing dropped.

No other constraint in the repo's full migration history is touched by more than one migration, so `notifications_kind_check` is the only chain requiring the pairwise diff this feature exists to perform.

### Pairwise diff of the `notifications_kind_check` chain (scope item 2, continued)
Read all 5 versions in full (quoted inline in F025c's own migration header, cross-checked against each source file directly):
- v1 (base): `mention, comment_reply, task_assigned, task_due_soon, watcher_update`
- v2 (F016/approval_requests): v1 + `approval_decided` — additive, documented in its own header ("`notifications_kind_check` (20260823020000) is a closed list; ... must be widened").
- v3 (F015): v2 + `assumption_flagged` — additive, documented ("last widened by 20260916010000 for 'approval_decided'").
- v4 (F018): **v1 + `budget_threshold_80`/`budget_threshold_100`** — silently drops `approval_decided` and `assumption_flagged` from v2/v3. F018's own migration header does not mention this drop or justify it as intentional — this is the known instance, already found and fixed by a prior feature (F025c), not a new finding.
- v5 (F025c): union of all 7 real values used up to that point, `+` nothing further dropped.

### Independent re-derivation of the fix's completeness (item 3: verify F018's own fix is still correct today)
F025f explicitly did not re-check F025c's fix. Rather than trust F025c's own header comment ("verified by grepping every `p_kind =>` / `kind =>` call site ... no other kind exists beyond these nine"), re-derived the same claim independently:
- Extracted every literal `p_kind => '<value>'` across all `create_notification(` call sites in every migration (15 files that call it): `task_due_soon`, `approval_decided` (×4 call sites), `assumption_flagged` (×2).
- For the two call sites that pass a variable (`p_kind => v_kind`, in F018 and F021c), traced the variable's assignment lines directly: both assign only `'budget_threshold_100'` or `'budget_threshold_80'`.
- Combined with the base 5 values from `20260823020000` (`mention, comment_reply, task_assigned, task_due_soon, watcher_update`, confirmed by reading that file directly — `mention`/`comment_reply`/`task_assigned`/`watcher_update` have no migration call site because nothing in this codebase creates those kinds yet; they remain reserved values from the original schema design, not orphaned/dead entries needing removal), the full set is exactly the same 9 values the current (`20261019010000`) constraint enumerates. No 10th value exists anywhere in the migration history that the current constraint is missing.
- Confirmed via `ls supabase/migrations | awk -F_ '$1+0 > 20261019010000'` that no migration after F025c touches `notifications` or `notifications_kind_check` at all — the constraint has not regressed again since the fix.
- Ran the fix's own regression test (`f025c-projects-guard-bypass-and-notification-kind.test.ts`) plus the AS-023-adjacent `f009b-close-second-approval-path.test.ts` suite against the live linked Supabase project (not a local/dry run) — both pass, meaning the constraint as it exists in the live database today, not just in the migration file, accepts every kind the application actually inserts.

### Widening beyond this mission's own migrations (scope item 4)
Two constraints in the chain trace back to migrations outside this mission's `f0NN[a-z]_`-prefixed naming convention: `notifications_kind_check`'s origin (`20260823020000`, clearly pre-mission — mission started 20260903) and `workspace_members_role_check`'s origin (`20260821184932`, also pre-mission). Both were included in the enumeration (the grep commands above scanned every migration in the repo, not a mission-scoped subset) and both were diffed against their mission-era modifiers above. No other constraint in the repo has this "pre-mission origin + mission-era modification" shape — confirmed by the same full-repo enumeration; every other multiply-touched or check-bearing constraint either originates and is only ever touched within the mission, or (per scope item 2 above) is a same-file idempotent re-declaration with no real history to diff.

## Out-of-scope work needed
None identified. This sweep, combined with F025f's function sweep, now covers both halves (function re-creation and constraint re-creation) of the class of bug this mission was punished for, with a mechanical (grep-driven) enumeration basis for each.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Scoped the enumeration to the entire `supabase/migrations/*.sql` directory, not just `f0NN[a-z]_`-prefixed files, per scope item 4's explicit instruction to widen beyond this mission's own migrations for constraints the mission modified but didn't create. F025f used the `f0NN[a-z]_`-prefix scope for functions since that item didn't apply to its sweep; this feature's own spec explicitly requires the wider net for constraints, so no deviation from either predecessor's precedent — each scope matches what its own spec asked for.
AUTONOMOUS_DECISION: Treated `mention`, `comment_reply`, `task_assigned`, `watcher_update` (present in the base 20260823020000 list and every widening since, but with no `create_notification` call site anywhere in the migration history) as intentionally reserved/future values rather than dead entries to flag — nothing in this feature's scope asks for constraint *narrowing*, only for restoring dropped values, so removing unused-but-harmless allowed values would be out of scope and is not attempted.

## Notes for the next worker
- No MCP tools used — Supabase MCP is not authorised for this mission (consistent with every prior handoff); verification was done via `npx vitest` integration tests against the live linked project, matching this mission's established convention.
- The full, mechanical, repo-wide list of every `add constraint` / `drop constraint` / `create table` this repo's migrations contain is reproducible at any time with the three grep commands quoted above in "Decisions made" — worth re-running verbatim (not from memory) if a future feature touches `notifications` or any other multiply-constrained table again.
- `notifications_kind_check` is now the only constraint in this codebase's history that has ever been re-created more than once across separate migration files. If a future migration touches it again, diff it against `20261019010000_f025c_...`'s current 9-value list specifically, by hand, since this is precisely the shape (memory-based re-creation dropping a previously-added value) that caused the AS-023 regression this feature exists to guard against.
