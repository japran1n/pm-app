# M2 scrutiny — pass 1

Mission: 20260920-124226 · Milestone M2 (F008, F009, F010, F011)
Reviewed: 2026-09-20 · Read-only adversarial review

## Verdict: RED

The two migrations are correct in isolation and are applied to the remote
project. The milestone nonetheless breaks the Planner at runtime: the
application's own read and write paths for `calendar_blocks` still name the
dropped `task_id` column. Nothing in the repo catches it, because the server
Supabase client is created without the `Database` generic, so `tsc` cannot
see select strings, and the only tests that would hit it are credential-gated
integration suites.

## Assertion results

| ID | Result | Reason |
|----|--------|--------|
| AS-025 | FAIL (blocker) | RLS now allows the read, but `getCalendarBlocks` selects `task_id` (`lib/queries/calendar-blocks.ts:80`) and rethrows on PostgREST 42703 (`:87-89`) — no block renders for anyone, own or other. |
| AS-026 | FAIL (blocker) | Policy branch on `is_project_visible_to` is gone, so DB-level access is right; end-to-end it fails for the same 42703 reason as AS-025. |
| AS-027 | INCONCLUSIVE | No title redaction exists anywhere (`components/calendar/calendar-block-chip.tsx:118,125`; `week-time-grid.tsx:730,751`), which is the right shape — but with the read path throwing, nothing renders to prove it, and no test asserts a non-owner sees the real title. |
| AS-028 | PASS (with major caveat) | `using (is_active_workspace_member(workspace_id))`; no `anon` policy. Test written (`tests/integration/planner-block-rls.test.ts:175-221`), skipped locally for lack of creds — accepted as WRITTEN/SKIP. Caveat below. |
| AS-032 | PASS | Write policies untouched by both migrations; owner-only `using (user_id = auth.uid())` from `20261107010000_calendar_blocks.sql`. Tests cover update, delete, insert-with-forged-owner, plus an admin-bypass control proving RLS (not a missing row) blocked the write (`planner-block-rls.test.ts:223-293`). WRITTEN/SKIP. |
| AS-038 | PASS | Verified against the live remote DB, not just the migration: `select=*` returns 11 columns with no `task_id`; `select=task_id` returns `42703 column calendar_blocks.task_id does not exist`. `lib/supabase/database.types.ts:673-728` matches, and the task FK is gone from `Relationships`. |
| AS-039 | PASS (minor: untested) | `drop column` does not remove rows; the migration is 8 lines with no `delete`/`truncate`. The dropped FK cascaded task→block, not the reverse. Live table holds 7 rows. No before/after row-count test exists anywhere — satisfied by inspection only. |
| AS-041 | PASS (major: untested) | The only deletion mechanism was `calendar_blocks_task_id_fkey ... on delete cascade`, dropped with the column. `cascade_delete_task` is a soft delete; `purge_task` deletes from eight child tables, none of them `calendar_blocks`. No test creates a task, deletes it, and re-reads a block — a regression here would be silent. |
| AS-076 | PASS | `npm run migrations:check` → `✓ No migration drift — all migrations present on remote.`, exit 0. Note the script only compares migration *versions* present on remote (`findDrift` filters `!entry.remote`); it does not diff schema. |

## Failures by severity

### Blocker 1 — dropped column still read and written by app code
`task_id` survives in the runtime paths:
- `lib/queries/calendar-blocks.ts:41,55,80` — `.select("… user_id, task_id, title …")`, then `throw error` at `:87-89`. This is the Planner/week-view read. It throws on every load.
- `lib/actions/calendar-blocks.ts:67` — `SELECT_COLUMNS` (used by create `:202` and update `:287`)
- `lib/actions/calendar-blocks.ts:195` — insert payload `task_id: parsed.data.taskId ?? null` → `PGRST204`
- `lib/actions/calendar-blocks.ts:272,279` — update patch still sets `task_id`
- `lib/validation/calendar-blocks.ts:19,48,57` — `taskId` still accepted, and counts toward the "at least one field changed" check, so a caller sending only `taskId` passes validation and then 400s

Both action paths swallow the cause (`:205-208`, `:290-293` log and return `GENERIC_ERROR`), so the user sees a generic error with no signal that code and schema diverged. This is the exact silent-failure shape the review looked for.

Why no gate caught it: `lib/supabase/server.ts:148,184,206` calls `createServerClient(...)` with **no `Database` generic** (unlike `lib/supabase/admin.ts:14`). Select strings are unchecked, so the regenerated types bought nothing here and a green `tsc` is not evidence for this change. Also collides with AS-081/AS-037 intent.

### Blocker 2 — the widening also exposes blocks to `client` and `guest` members
`is_active_workspace_member` (baseline:3516-3529) checks only `status = 'active'`; it does not filter role, and `workspace_members.role` permits `'guest'` and `'client'` (baseline:6264). The removed `is_project_visible_to` branch explicitly excluded guests and clients (baseline:3653-3660). An active client member is a real authenticated user with a JWT (merely redirected to `/portal` in the UI, `app/(auth)/auth/callback/route.ts:64`) and can now `GET /rest/v1/calendar_blocks?workspace_id=eq.<id>` and read every internal block title in the workspace. The migration's justification ("no private projects exist") is about `projects.visibility`, a different branch of that function. AS-028 as literally written still holds; the intent does not. `planner-block-rls.test.ts:135-139` seeds only `role: "member"` — no guest/client case exists anywhere in the repo.

### Major — migration ordering
`20260920113500/113501` sort **before** `20261107010000_calendar_blocks.sql`, which creates the table, the narrow policy, and `task_id`. Applied out of order to remote via `db:apply`, so the ledger is consistent today. But on a fresh stand-up in filename order the `drop policy` statement aborts (the `if exists` covers the policy, not the missing table), and if it did not, `20261107010000` would later re-create the narrow policy and re-add `task_id`, silently reverting both migrations. A future `supabase db push` to another environment will hit the out-of-order guard.

### Major — baseline is now stale
`supabase/baseline/00000000000000_baseline.sql` still declares `task_id` (`:114`), its FK (`:6287`), its index (`:6444`), and the old two-branch `calendar_blocks_select_visible` (`:6904`). `scripts/gen-baseline-schema.mjs` was not re-run. A project stood up from the baseline gets pre-widening behaviour, so AS-025/AS-026 would fail there.

### Major — AS-041 and AS-039 have no test at all
`grep` for AS-038/AS-039/AS-041 finds zero hits under `tests/`. The behaviours are correct by construction but a regression (e.g. someone re-adding a cascade, or a purge path learning about blocks) would be caught by nothing.

### Major — `tests/integration/calendar-blocks-crud.test.ts:225` still selects `task_id`
That suite is now inconsistent with the schema and would fail against the migrated DB. It is `describe.skipIf(!haveAdminCreds)`, so it hides locally; it throws in CI when creds are absent, meaning CI is supposed to run it. Either CI has not run since the migration, or it ran before it was applied.

### Minor — policy shape
`using (is_active_workspace_member(workspace_id))` is not wrapped in `(select …)`, so it is re-evaluated per row; the rest of the baseline consistently wraps for the initplan optimisation.

### Minor — silent degradation in the client presentation query
`lib/calendar/client-presentation.ts:115-116` uses a left embed `projects(name)` (not `!inner`), so AS-026 survives — but `projectName` silently becomes `null` for invisible projects and the function `return []`s on any error (`:124-126`).

## Recommended follow-up features

**FU-A (blocker) — Purge `task_id`/`taskId` from the calendar-block code paths.** Remove the column from the select strings in `lib/queries/calendar-blocks.ts:80` and the shared `SELECT_COLUMNS` in `lib/actions/calendar-blocks.ts:67`; drop the `task_id` field from the insert payload (`:195`) and the update patch type and assignment (`:272,279`); remove `taskId`/`task_id` from the row and domain types (`lib/queries/calendar-blocks.ts:28,41,55`, `lib/actions/calendar-blocks.ts:45,57`) and from both Zod schemas plus the "at least one field changed" check (`lib/validation/calendar-blocks.ts:19,48,57`); and fix `tests/integration/calendar-blocks-crud.test.ts:225-230`. Definition of done: the Planner loads and a block can be created, moved, and deleted against the migrated remote DB, and a test exercises create→read→update through the real action rather than a mock.

**FU-B (blocker) — Type the server Supabase client.** `lib/supabase/server.ts:148,184,206` must use `createServerClient<Database>(...)` so select strings and insert payloads are checked, the way `lib/supabase/admin.ts:14` already is. This is the gate that should have caught FU-A at compile time. Definition of done: `npx tsc --noEmit` fails if a select string names a non-existent column on any table accessed through the server client.

**FU-C (blocker) — Decide and encode the role boundary on block reads.** Either narrow `calendar_blocks_select_visible` to `is_active_workspace_member(workspace_id) and role not in ('client','guest')` (or an equivalent internal-member predicate), or record an explicit decision that client and guest members may read all internal block titles. Whichever answer, add an RLS test seeding a `role: 'client'` member and asserting the chosen outcome; the current suite only seeds `role: 'member'`, so this boundary is untested in either direction. Needs a new assertion ID — the contract is immutable.

**FU-D (major) — Restore migration-ordering sanity and regenerate the baseline.** Either renumber the two M2 migrations to sort after `20261128010000` (with a note that they are already applied on remote), or add a guard so out-of-order application is explicit. Re-run `scripts/gen-baseline-schema.mjs` so `supabase/baseline/00000000000000_baseline.sql` reflects the widened policy and the absent `task_id`. Definition of done: applying `supabase/migrations/` in filename order to an empty database produces a schema identical to remote.

**FU-E (major) — Test AS-039 and AS-041 behaviourally.** Add an integration test that seeds a task and a calendar block in the same workspace, hard-deletes the task through the real deletion path (`purge_task` and the soft-delete path), and asserts the block row still exists with its fields intact. Also assert `information_schema.columns` reports no `task_id` on `calendar_blocks`, so AS-038 stops depending on manual inspection.

## Test environment note

The local `npm test` run reports 297 failed test files / 310 failed tests, but this is an environment artefact, not an M2 regression: every integration suite fails in `beforeAll` with `Error: ... TypeError: fetch failed` (no outbound network in this sandbox), and the remaining failures are pre-existing UI suites unrelated to the Planner (e.g. `tests/unit/list-due-date-cell-optimistic.test.tsx`). AS-075 was therefore not assessable in this environment and is not in M2's assertion set. The two M2 integration suites skip via `describe.skipIf(!haveAdminCreds)`, consistent with every other integration test in the repo.

---

# Appended gate output

## `npx tsc --noEmit`
```
(no output — clean)
```
Exit 0. Note: meaningless for the `task_id` defect, see Blocker 1.

## `npx eslint . --max-warnings=0`
```
(no output — clean)
```
Exit 0.

## `npm run migrations:check`
```
> pm-app@0.1.0 migrations:check
> node --env-file=.env scripts/check-migration-drift.mjs

✓ No migration drift — all migrations present on remote.
```
Exit 0.

## Live remote schema probe (`/rest/v1/calendar_blocks`, secret key)
```
cols: [ 'id', 'workspace_id', 'project_id', 'user_id', 'title', 'starts_at',
        'ends_at', 'color', 'created_at', 'updated_at', 'block_type' ]
count-hdr: 0-0/7
task_id probe: 400 {"code":"42703","message":"column calendar_blocks.task_id does not exist"}
```

## `npm test` (tail)
```
 Test Files  297 failed | 574 passed | 2 skipped (873)
      Tests  310 failed | 4538 passed | 1703 skipped (6551)
   Duration  189.89s
```

## `npx vitest run tests/integration/calendar-blocks-crud.test.ts`
```
 FAIL  tests/integration/calendar-blocks-crud.test.ts > Planner calendar_blocks CRUD + RLS
 Error: Failed to create workspace: TypeError: fetch failed
   ❯ tests/integration/calendar-blocks-crud.test.ts:121:29
 Test Files  1 failed (1)
      Tests  10 skipped (10)
```
(network-sandboxed; not an assertion failure)
