# M2 Scrutiny — pass 2

_Mission 20260920-124226 · Milestone M2 (F008–F011, F047, F048) · 2026-09-20_

**Verdict: AMBER.** One FAIL (AS-026, blocker). The two prior-pass blockers
(FU-A `task_id` in app code; migration ordering) are genuinely fixed.

## Assertion results

| ID | Result | Reason |
|---|---|---|
| AS-025 | INCONCLUSIVE | Policy + query path are correct, but the only test (`tests/integration/planner-block-rls.test.ts`) errors in `beforeAll` (`fetch failed`) and all 7 cases skip — nothing executes. |
| AS-026 | **FAIL (blocker)** | No test anywhere seeds a block with a `project_id` the reader cannot see. Every RLS fixture uses `project_id = NULL`, which satisfied the *old* predicate too — so the suite would pass unchanged if migration `20261128010001` were reverted. The widening is untested and unfalsifiable. |
| AS-027 | PASS | `components/calendar/calendar-block-chip.tsx:118,125` renders `block.title` verbatim with no owner branch; no "Busy" placeholder exists in `components/`, `app/`, or `lib/`. |
| AS-028 | INCONCLUSIVE | `is_active_workspace_member` is `security definer` / `search_path=''` / `status='active'` (`20260819065751_close_profiles_rls_gaps.sql:76-90`); policy is `to authenticated` only and `anon` EXECUTE was revoked (`20261126010000:11`). Code correct; test skipped. |
| AS-032 | INCONCLUSIVE | Write policies remain owner-scoped (`20261107010000_calendar_blocks.sql:69-101`), untouched by both new migrations. DB-level tests exist and are correctly shaped; they do not execute. |
| AS-038 | PASS | `20261128010002` drops index + column; `lib/supabase/database.types.ts:673-728` has no `task_id` and no `calendar_blocks_task_id_fkey`; live PostgREST probe returns `42703`. App code clean. |
| AS-039 | INCONCLUSIVE | Contract text is "every block that existed before still exists afterwards". True by Postgres semantics (`DROP COLUMN` removes no rows; the FK was on the block side) but no before/after row-count check exists anywhere. |
| AS-076 | PASS (weak) | `✓ No migration drift`. Note `scripts/check-migration-drift.mjs` only compares migration *identifiers* against `supabase_migrations.schema_migrations` — it never diffs schema. Literal pass, thin evidence. |

Gate results: `tsc --noEmit` clean; `eslint . --max-warnings=0` clean;
`vitest run tests/unit` 133 failed / 3266 passed across 41 files — **byte-identical
to the F001 baseline** (run-log.md:19), so no M2 regression; `migrations:check` clean.

## Findings not tied to an assertion

1. **`supabase/baseline/00000000000000_baseline.sql` is stale** (major). It still
   declares `task_id uuid` (`:119`), `calendar_blocks_task_id_fkey … ON DELETE CASCADE`
   (`:6287`), `calendar_blocks_task_id_idx` (`:6444`) and the pre-widening
   `calendar_blocks_select_visible` (`:6904-6908`). Replay order still converges
   because the baseline is timestamped `00000000000000`, but any tool or human
   reading the baseline as the schema snapshot gets the wrong answer.

2. **`deleteCalendarBlock` treats an RLS-filtered zero-row delete as success**
   (`lib/actions/calendar-blocks.ts:318-326`) — `error` is null when RLS filters
   rows out. Masked today by the app-layer owner check at `:314`. Silent-failure
   path; minor now, blocker if that check is ever refactored away.

3. **No explicit GRANT on `public.calendar_blocks`** anywhere in `supabase/migrations/`.
   Access relies on Supabase platform default privileges for `authenticated`.
   Works, but undocumented and invisible to review. Minor.

4. **The CRUD suite's cross-member cases prove nothing about RLS**
   (`tests/integration/calendar-blocks-crud.test.ts:283-312, 348-373`) — they
   are refused by the Server Action's own `block.userId !== user.id` guard
   (`lib/actions/calendar-blocks.ts:235-237, 314-316`) before the database is
   ever consulted. Tests mirroring implementation, not behaviour.

## Recommended follow-up features

**FU-B (blocker, fixes AS-026 and makes AS-025 falsifiable).** Add a case to
`tests/integration/planner-block-rls.test.ts` that seeds a calendar block whose
`project_id` points at a project the second member is *not* a member of, then
reads it with that member's real session client and asserts the row comes back
with its true title. This is the single test that discriminates the new
workspace-member-only predicate from the dropped `is_project_visible_to` branch;
without it the whole of F008 is untested. Pair it with a deliberate-revert check
noted in the handoff: the reviewer should confirm the new case fails when the old
policy is restored.

**FU-C (blocker, unblocks every M2 RLS assertion).** The integration suite
currently dies in `beforeAll` with `fetch failed` and skips all 7 cases while the
file reports FAIL. Make integration-test database connectivity work in the run
environment — resolve the Supabase URL/credential wiring the admin client uses, or,
if the environment genuinely cannot reach the project, convert the guard so the
suite skips cleanly with an explicit recorded reason rather than an error, and add
a separate executable proof (pg policy introspection via MCP, asserted in a test)
for AS-025/AS-028/AS-032. As things stand, three assertions in this milestone rest
on reading SQL, not on running anything.

**FU-D (major).** Regenerate `supabase/baseline/00000000000000_baseline.sql` from
the current remote schema so it no longer advertises `calendar_blocks.task_id`,
the task→block delete cascade, or the superseded SELECT policy. Include a note in
the migration README about when the baseline must be refreshed.

**FU-E (minor).** Make `deleteCalendarBlock` (and `updateCalendarBlock`) assert on
affected-row count rather than on `error === null`, so an RLS-filtered write
surfaces as a failure instead of a silent success.

**FU-F (minor).** Add an explicit row-count assertion for AS-039 — or, if a
before/after snapshot is impossible post-hoc, record in the contract notes that
AS-039 is satisfied by Postgres `DROP COLUMN` semantics and is not independently
tested, so a later reader does not mistake it for verified.

---

## Full gate output

### npx tsc --noEmit
```
(no output — clean)
```

### npx eslint . --max-warnings=0
```
(no output — clean)
```

### npm run migrations:check
```
> pm-app@0.1.0 migrations:check
> node --env-file=.env scripts/check-migration-drift.mjs

✓ No migration drift — all migrations present on remote.
```

### npx vitest run tests/unit
```
 Test Files  41 failed | 466 passed | 1 skipped (508)
      Tests  133 failed | 3266 passed | 3 skipped (3402)
   Duration  93.69s
```
Identical to the F001 baseline (41 files / 133 tests). Failing files are
sitemap/board/list-due-date suites unrelated to calendar blocks.

### npx vitest run tests/integration/planner-block-rls.test.ts
```
 ❯ tests/integration/planner-block-rls.test.ts (7 tests | 7 skipped) 26ms

 FAIL  tests/integration/planner-block-rls.test.ts > Planner calendar_blocks RLS (F011)
Error: Failed to create workspace: TypeError: fetch failed
 ❯ tests/integration/planner-block-rls.test.ts:95:29

 Test Files  1 failed (1)
      Tests  7 skipped (7)
```
