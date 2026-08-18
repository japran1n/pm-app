# Handoff: F079 — rls audit all tables

## Status
COMPLETE

## Assertions covered
AS-137: PASS — audited every `create table` in supabase/migrations/ (workspaces, workspace_members, projects, tasks, comments, attachments); all six have a matching `alter table ... enable row level security;` statement in their migration. No gaps found. Verified live via anon SELECT test in tests/integration/rls-anon-all-tables.test.ts (all 6 tables return `[]`, not a schema error).
AS-138: PASS — pre-existing per-table anon-zero-rows tests already existed in rls-workspaces.test.ts, rls-projects.test.ts, rls-tasks.test.ts, rls-comments.test.ts, rls-attachments.test.ts. Added one new consolidated test file, tests/integration/rls-anon-all-tables.test.ts, that iterates all 6 tables in a single `it.each` and asserts an anon-key SELECT returns zero rows for every one, in one place. Ran against the real linked Supabase project (credentials present in .env): 6/6 passed.
AS-139: PASS — the literal scenario ("selecting tasks by project_id without workspace membership") already existed at tests/integration/rls-tasks.test.ts as a full-list query filtered by `project_id` for a non-member session; retitled/re-tagged it `AS-062/AS-139` to make the coverage explicit rather than adding a duplicate test. Also confirmed the join-direction test "non-member gets zero rows via a join-style query on project_id (tasks -> projects)" in the same file, and the equivalent workspace_members<->workspaces join tests in rls-workspaces.test.ts.

## Files changed
tests/integration/rls-anon-all-tables.test.ts (new — consolidated anon-key audit across all 6 workspace-scoped tables)
tests/integration/rls-tasks.test.ts (retitled one existing test to tag AS-139 explicitly, no behavior change)

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0, 1 pre-existing unrelated warning in lib/queries/search.ts)
`npx vitest run tests/integration/rls-anon-all-tables.test.ts tests/integration/rls-tasks.test.ts` (0, 15 passed)
`npx vitest run` (0, 79 files / 418 tests passed)
`npm run build` (0)

## Decisions made
- Did not rewrite the five existing per-table RLS test files — they already independently satisfy AS-138 for their own table and are more detailed (INSERT/UPDATE/join/list-scope cases). Per the spec's DoD ("if this doesn't already exist as a single consolidated check somewhere"), only the *consolidated, all-tables-in-one-place* check was missing, so I added exactly that rather than duplicating coverage.
- For AS-139, chose to re-tag the existing "full list query scoped to project A returns zero rows for a non-member" test in rls-tasks.test.ts rather than add a near-duplicate test, since it already exercises exactly the assertion's literal scenario (tasks filtered by project_id, non-member session, valid session in a different workspace).
- Audit method: `grep -rniE "create table"` and `grep -rniE "enable row level security"` across all of supabase/migrations/, cross-checked table-by-table by name. All 6 tables matched 1:1.

## Out-of-scope work needed
None found. No table lacks RLS; no anon leak found; no join-bypass found.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Interpreted "one consolidated integration test" as one new test file using `it.each` over all 6 tables (rather than merging the five existing detailed per-table RLS files into one file), since the existing files cover far more than the anon-SELECT check (INSERT/UPDATE/storage/join cases) and merging them would have been a large out-of-scope rewrite with no assertion-coverage benefit.

## Notes for the next worker
- Full migration list as of this audit: 20260817222532_create_workspaces.sql, 20260817222822_rls_workspaces.sql, 20260818004413_create_projects.sql, 20260818004709_rls_projects.sql, 20260818013434_create_tasks.sql, 20260818013805_rls_tasks.sql, 20260818040214_create_comments.sql, 20260818041550_rls_comments_delete_update.sql, 20260818050100_create_attachments.sql (plus non-table migrations: RPCs, FTS, realtime publications, constraints).
- Any future new table migration must be added to `WORKSPACE_SCOPED_TABLES` in tests/integration/rls-anon-all-tables.test.ts or this consolidated check silently stops covering it.
- Tests run for real against the live linked Supabase project (`.env` present locally) rather than skipping — all pass counts above are real, not skipped.
