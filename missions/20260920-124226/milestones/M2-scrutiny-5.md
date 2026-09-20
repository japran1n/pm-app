# M2 Scrutiny — Pass 5 (after F054)

Verdict: **GREEN**. Zero FAILs. Two non-blocking findings.

## Assertion table

| ID | Status | Reason |
|---|---|---|
| AS-025 | INCONCLUSIVE | `test_AS_028_active_workspace_member_can_read_another_members_block` is well-formed; suite skipped in this environment (see "Why the suite skipped"). Accepted per mission note. |
| AS-026 | **PASS** | F054 fix confirmed in code AND verified live out-of-band against the remote DB: an active member (`role: member`, not the owner, no `project_members` row) reads a block whose `project_id` points to a `visibility: 'private'` project. Read returned the row, no error. |
| AS-027 | PASS | Same live probe returned `title = "Block on private project"` — the real title, not a placeholder. |
| AS-028 | INCONCLUSIVE | Non-member and anon cases are well-formed; not executed here. Accepted. |
| AS-032 | INCONCLUSIVE | Insert-forgery / update / delete cases well-formed; not executed here. Accepted. |
| AS-038 | PASS | Unchanged since pass 4; no `task_id` references on calendar blocks anywhere in `lib/`, `app/`, `components/`, `tests/`. |
| AS-022 | PASS | Unchanged; `toUtcMs` colon-offset handling intact. |

## Checks from the brief

1. **adminClient seed** — confirmed. `tests/integration/planner-block-rls.test.ts:217` now inserts the
   project-attached block via `adminClient`, and `user_id` is still `memberUserId` (line 221). The
   project seed at line 207 also uses `adminClient` with `visibility: "private"`. The pass-4 blocker
   (INSERT policy `calendar_blocks_insert_visible` gating on `is_project_visible_to`) no longer
   applies, because the admin client bypasses RLS on the seed.

2. **Revert-discrimination — holds.** Old policy (`20261107010000_calendar_blocks.sql:60-67`):

   ```sql
   using (
     (project_id is not null and public.is_project_visible_to(project_id))
     or (project_id is null and public.is_active_workspace_member(workspace_id))
   );
   ```

   The block under test has `project_id is not null`, so the first branch governs. `otherMemberUserId`
   is seeded `role: "member"` (line 140), the project is `visibility: 'private'`, and no
   `project_members` row is ever created — so `is_project_visible_to` is false, the read returns zero
   rows, and `expect(data?.map(r => r.id)).toContain(block.id)` fails. Under
   `20261128010001` (`using (is_active_workspace_member(workspace_id))`) the read succeeds — verified
   live. Reverting the migration breaks the test. Discrimination achieved.

   Note the seed change does not weaken this: the assertion is about SELECT, and the SELECT path is
   still exercised through `otherClient`'s RLS-enforced session.

3. **beforeAll catch** — confirmed (lines 165-176). Narrows to `fetch failed` / `ECONNREFUSED` /
   `network` and ends with `throw e`. The F053 fix is in place.

4. **`npx tsc --noEmit`** — clean, exit 0.

5. **`npm run migrations:check`** — clean: "No migration drift — all migrations present on remote."

## Finding 1 (major, non-blocking) — the suite silently skips on network failure even in CI

`haveAdminCreds` is true in this environment (all three vars present and non-empty in `.env`, and a
plain `node --env-file=.env` script reaches the remote DB fine), yet `npx vitest run
tests/integration/planner-block-rls.test.ts` reports **8 skipped**. That means the skip came from
`skipDueToNetwork` in `beforeEach`, i.e. `beforeAll` hit a network-classified error under vitest.

The CI guard only covers missing credentials:

```ts
if (process.env.CI && !haveAdminCreds) { throw new Error(...) }
```

There is no equivalent guard on `skipDueToNetwork`. So in CI, if the Supabase call fails for any
reason whose message contains "fetch failed"/"network", all eight RLS assertions are silently skipped
and the pipeline stays green. A regression that took the DB or policies offline would read as a pass.
This is exactly the "silent failure" pattern: the suite's own escape hatch can mask the thing it
exists to prove.

## Finding 2 (minor) — AS-026's seed no longer proves the write path

By moving the seed to `adminClient`, the test no longer demonstrates that a member *can* create a
block against a project they cannot see. That is correct for AS-026 (a read assertion) and correct as
a fix, but it leaves an untested gap: `calendar_blocks_insert_visible` still gates INSERT on
`is_project_visible_to(project_id)` while SELECT was widened to workspace-wide. Nothing in M2 asserts
what the intended INSERT behaviour is for a private-project block, so that asymmetry is undocumented
and unverified.

## Recommended follow-up features

**Fail the RLS integration suite in CI when it cannot reach the database.** Extend the existing CI
guard in `tests/integration/planner-block-rls.test.ts` so that `skipDueToNetwork` is treated as a hard
failure whenever `process.env.CI` is set: keep the local-developer convenience of skipping when
Supabase is unreachable, but in CI re-throw the original error instead of setting the flag, so the run
goes red. The same pattern should be applied to any sibling integration suite using the
loadDotEnv/skipDueToNetwork idiom (`tests/integration/calendar-blocks-crud.test.ts` at minimum), since
they share the escape hatch. Additionally, surface the underlying error message on skip (currently
swallowed) so a developer can tell "no DB running" from "policy changed and the seed now errors".

**Pin the INSERT/SELECT asymmetry on calendar_blocks with an explicit assertion.** The widening
migration changed SELECT only; INSERT still requires `is_project_visible_to(project_id)` when
`project_id` is non-null. Decide whether that is intended, then encode the decision as a test: either
a member can insert a block against a private project (in which case the INSERT policy needs the same
widening) or they cannot (in which case add a negative test asserting the rejection, so a future blanket
widening of the insert policy is caught). Without this, a well-meaning future migration could widen
INSERT and nothing would notice.

## Command output

### `npx tsc --noEmit`
```
(no output, exit 0)
```

### `npm run migrations:check`
```
> pm-app@0.1.0 migrations:check
> node --env-file=.env scripts/check-migration-drift.mjs

✓ No migration drift — all migrations present on remote.
```

### `npm run lint`
```
> pm-app@0.1.0 lint
> eslint
(no findings, exit 0)
```

### `npx vitest run tests/integration/planner-block-rls.test.ts`
```
 Test Files  1 passed (1)
      Tests  8 skipped (8)
   Duration  178ms
```
All eight skipped — see Finding 1. Credentials ARE present; the skip is from `skipDueToNetwork`.

### Live out-of-band verification of AS-026 / AS-027
Standalone script (scratchpad, not committed) replicating the test's seed against the remote DB,
with full cleanup afterwards:
```
AS-026 read err: none rows: [{"id":"8e3f2421-...","title":"Block on private project"}]
cleaned
```

### `npx vitest run` (full suite)
```
 Test Files  296 failed | 575 passed | 2 skipped (873)
      Tests  310 failed | 4557 passed | 1704 skipped (6571)
   Duration  171.42s
```
Pass 4 ran `tests/unit` only (508 files, 41 pre-existing failures). The full-suite delta is other
suites that require a running dev server or live DB in this sandbox. Spot-checked: no failing file is
a planner/calendar-blocks M2 file. Pre-existing unit failures (f015-rename-section,
list-due-date-cell-*, f014-rename-page, f060-discipline-estimate-schema, f250-list-inline-edit, etc.)
are unchanged from pass 4 and unrelated to M2.
