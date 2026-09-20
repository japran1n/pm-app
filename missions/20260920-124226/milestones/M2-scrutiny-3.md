# M2 Scrutiny — pass 3

_Mission 20260920-124226 · Milestone M2 (F008–F011, F047, F048, F051) · 2026-09-20_

**Verdict: AMBER.** One FAIL (AS-026, blocker) — the *same* assertion that
failed pass 2. F051 added a test with the right name and the right shape, but
it seeds a project with the **default** `visibility = 'workspace'`, which the
*old* policy already admitted. The test does not discriminate the widening and
therefore does not exercise AS-026. A second blocker was introduced by F051's
graceful-skip mechanism, which now swallows genuine RLS failures.

## Assertion results

| ID | Result | Reason |
|---|---|---|
| AS-025 | INCONCLUSIVE | Policy and query path are correct by SQL inspection; the only test still never executes (8/8 skipped). |
| AS-026 | **FAIL (blocker)** | The new test seeds a project with default `visibility='workspace'`, so `is_project_visible_to()` returns true and the **pre-widening policy would have returned the row too**. The block is not "attached to a project the viewer cannot otherwise see". Non-discriminating. |
| AS-027 | PASS | `components/calendar/calendar-block-chip.tsx:118,125` renders `block.title` verbatim; `lib/queries/calendar-blocks.ts:76-78` selects `title` raw. No owner branch, no "Busy" placeholder anywhere in `components/`, `app/`, `lib/`. |
| AS-028 | INCONCLUSIVE | `is_active_workspace_member` is `security definer`, `search_path=''`, `status='active'` (`20260819065751_close_profiles_rls_gaps.sql:76-91`); policy is `to authenticated` only, no `anon` policy. Code correct; tests skipped. |
| AS-032 | INCONCLUSIVE | `calendar_blocks_update_own` (`20261107010000_calendar_blocks.sql:85-96`) and `_delete_own` (`:98-102`) remain `using (user_id = auth.uid())`; 010001 drops only the SELECT policy by name. Correct by inspection; tests skipped. |
| AS-038 | PASS | `20261128010002` drops index + column; `lib/supabase/database.types.ts:673-729` has no `task_id` and no `calendar_blocks_task_id_fkey`. No app code references `calendar_blocks.task_id`. |
| AS-039 | INCONCLUSIVE | True by Postgres semantics (`DROP COLUMN` removes no rows) but no before/after row-count check exists anywhere. |
| AS-041 | PASS | The `on delete cascade` lived on the `task_id` FK (`20261107010000:37`); dropping the column drops the constraint. Grep confirms no trigger or function deletes calendar_blocks on task delete. |
| AS-076 | PASS (weak) | `✓ No migration drift`. `scripts/check-migration-drift.mjs` compares migration *identifiers* only — it never diffs schema. Literal pass, thin evidence. Unchanged from pass 2. |

### Requested spot-checks

1. **AS-026 test exists, correctly named, incorrectly shaped** — see blocker 1 below.
2. **Network-failure path produces SKIP, not FAIL** — confirmed working, but
   over-broad. See blocker 2.
3. **`task_id` grep** — zero hits in calendar-block code. The 3,935 repo-wide
   hits are all unrelated tables (`comments.task_id`, `task_assignees`,
   `attachments`, `notifications`, …). `components/calendar/calendar-day-grid.tsx:288`
   uses a local `taskId` for the **task** drag-reschedule on the personal
   calendar, not the Planner, and touches no calendar block. Clean.
4. **Migrations present** at `20261128010001` and `20261128010002`, correctly ordered. Confirmed.
5. **`npx tsc --noEmit`** — clean, exit 0, zero output.
6. **`npm run migrations:check`** — clean.

## Blockers

### Blocker 1 — AS-026's test cannot fail (fixes nothing from pass 2)

`tests/integration/planner-block-rls.test.ts:198-206` seeds the project as:

```ts
.from("projects").insert({ workspace_id: workspaceId, name: "Private Project" })
```

`projects.visibility` is `not null default 'workspace'`
(`supabase/migrations/20260821140522_projects_visibility_column.sql:9`, constrained
to `('workspace','private')` at `:13`). The insert sets no `visibility`, so the
project is a **workspace-visible** project named "Private Project" — the name is
the only thing private about it.

`is_project_visible_to` (`20260821140526_project_visibility_rls_sweep.sql:44-61`)
returns true when `p.visibility = 'workspace'` **or** the caller is owner/admin
**or** the caller is in `project_members`. `otherClient` is an active member, so
the first branch alone returns true.

The superseded policy was
(`20261107010000_calendar_blocks.sql:60-67`):

```sql
using (
  (project_id is not null and public.is_project_visible_to(project_id))
  or (project_id is null and public.is_active_workspace_member(workspace_id))
)
```

With `visibility='workspace'`, the first branch is **true**, so the old policy
returns the row as well. Revert `20261128010001` and this test still passes.
That is precisely the defect pass 2 raised, unchanged.

The test's own justifying comment (`:192-197`) is factually wrong: it claims
"there is no project-membership table gating project visibility in this schema."
There is — `project_members`, queried at `20260821140526:55-59`.

The fix is one field: insert with `visibility: "private"` via `adminClient`
(service_role bypasses the `projects` field guard, which otherwise restricts
`visibility` to owner/admin), and keep `otherClient` at `role='member'` and out
of `project_members` — both already true (`:140`). With that change the old
policy denies the row and the new one admits it.

### Blocker 2 — the graceful skip swallows real RLS failures

`tests/integration/planner-block-rls.test.ts:85-168`:

```ts
} catch (e) {
  skipDueToNetwork = true;
}
```

The `try` wraps the **entire** seed: workspace creation, three `auth.admin.createUser`
calls, the `workspace_members` insert, three sign-ins, and — critically — the
member's own RLS-enforced `calendar_blocks` insert at `:151-162`, which throws on
`blockErr`. Any of those throwing for a non-network reason flips
`skipDueToNetwork` and turns all 8 cases green-by-skip.

Concretely: if a future migration broke `calendar_blocks_insert_visible` so that
a member could no longer insert their own block, the seed would throw, the suite
would report "1 passed / 8 skipped", and CI would be green. The variable is named
for a cause it never verifies. The caught error is discarded entirely (`e` is
bound and never read), so there is no recorded reason — pass 2's FU-C explicitly
asked for "an explicit recorded reason".

The mechanism itself (`beforeEach((ctx) => ctx.skip())` at `:170-172`) is the
right vitest idiom and does work — `npx vitest run tests/integration/planner-block-rls.test.ts`
exits 0 with "1 passed / 8 skipped". The problem is the breadth of the `catch`,
not the skip.

## Findings not tied to an assertion

1. **INSERT/UPDATE were not widened alongside SELECT** (major). `20261128010001`
   changed only the SELECT policy. `calendar_blocks_insert_visible`
   (`20261107010000:76-78`) and `calendar_blocks_update_own`'s WITH CHECK (`:93-95`)
   still carry the two-branch `is_project_visible_to` predicate. Live consequence:
   the **owner** of a block attached to a project they cannot see can SELECT it and
   can DELETE it (`using (user_id = auth.uid())` only), but every UPDATE — move,
   resize, rename — fails the WITH CHECK. Read yes, delete yes, write no. Undocumented.

2. **The widening is broader than its own comment claims** (major). The migration
   justifies itself with "no private projects exist", which addresses the
   *visibility* dimension only. `is_active_workspace_member` admits **every**
   active member regardless of role, whereas `is_project_visible_to` excluded
   `guest` and `client` roles unless they were `project_members`. So a `client`-role
   user can now enumerate staff calendar block titles, including
   `block_type = 'client_presentation'` blocks. This matches the precedent set by
   `time_off_entries` (`20261114010000:43`) so it may be intended, but it is an
   unstated privacy expansion and nothing in discovery 2.1b/2.2c covers roles.

3. **Stale baseline** (major, carried from pass 2, unfixed).
   `supabase/baseline/00000000000000_baseline.sql` still declares `task_id uuid`
   (`:119`), the `ON DELETE CASCADE` FK (`:6287`), `calendar_blocks_task_id_idx`
   (`:6444`) and the pre-widening SELECT policy (`:6904-6908`).

4. **`deleteCalendarBlock` treats an RLS-filtered zero-row delete as success**
   (minor, carried from pass 2, unfixed). `lib/actions/calendar-blocks.ts:318-326`
   checks `error === null`; RLS filtering yields no error. Masked today only by
   the app-layer owner check at `:314`.

5. **The CRUD suite's cross-member cases prove nothing about RLS** (minor, carried).
   `tests/integration/calendar-blocks-crud.test.ts:283-312, 348-373` are refused by
   the Server Action's own `block.userId !== user.id` guard
   (`lib/actions/calendar-blocks.ts:235-237, 314-316`) before the database is consulted.

6. **Redundant and unqualified DDL** (minor). `20261128010002:5`'s
   `drop index if exists calendar_blocks_task_id_idx` is redundant — the column
   drop removes the index — and is unqualified while the `alter table` two lines
   below is `public.`-qualified. Likewise `is_active_workspace_member` is called
   unqualified in `20261128010001:15` where the original policy used `public.`.
   Cosmetic: Postgres resolves policy expressions to OIDs at CREATE time.

7. **No explicit GRANT on `public.calendar_blocks`** (minor, carried). Access
   relies on Supabase platform default privileges for `authenticated`.

## Recommended follow-up features

**FU-G (blocker, supersedes FU-B; fixes AS-026).** Change the AS-026 test's
project seed in `tests/integration/planner-block-rls.test.ts` to insert with
`visibility: "private"` through `adminClient`, so the project is genuinely
invisible to `otherClient` — who is `role='member'`, not owner/admin, and is not
a row in `project_members`, making all three branches of `is_project_visible_to`
false. Correct the test's inline comment, which currently asserts the schema has
no project-membership table when `project_members` is exactly what gates project
visibility. Then prove the test discriminates: temporarily restore the
pre-widening two-branch SELECT policy in a scratch database, confirm the case
fails, restore the new policy, confirm it passes, and record both outcomes in
the handoff. Without that revert check the test is unfalsifiable regardless of
what it seeds.

**FU-H (blocker, new this pass).** Narrow the `beforeAll` try/catch in
`tests/integration/planner-block-rls.test.ts` so it only converts genuine
connectivity failures into skips. Wrap just the first network call (or inspect
the caught error and re-throw unless it is a `fetch failed` / `ECONNREFUSED` /
`ENOTFOUND` transport error), record the caught error's message in the skip
reason rather than discarding it, and let every seed failure that indicates a
real RLS or schema regression — especially the member's own `calendar_blocks`
insert — propagate as a suite failure. As written, a broken
`calendar_blocks_insert_visible` policy would present as a clean green run.

**FU-I (major).** Either widen `calendar_blocks_insert_visible` and
`calendar_blocks_update_own`'s WITH CHECK to `is_active_workspace_member(workspace_id)`
so all four verbs agree, or add a comment to `20261128010001` explaining why
writes stay project-gated while reads do not. Today a block owner can read and
delete a block on a project they cannot see but cannot move or rename it, and
nothing in the repo records that as deliberate.

**FU-J (major).** Decide and record whether `client`- and `guest`-role workspace
members should be able to read staff calendar blocks, which the widening now
permits and the migration comment does not mention. If they should not, add a
role predicate to the SELECT policy and a test seeding a `client`-role member.

**FU-K (major, carried as FU-D).** Regenerate
`supabase/baseline/00000000000000_baseline.sql` from the current remote schema.

**FU-L (minor, carried as FU-E).** Make `deleteCalendarBlock` and
`updateCalendarBlock` assert on affected-row count rather than `error === null`.

**FU-M (minor, carried as FU-C's remainder).** Integration-test connectivity is
still broken in this environment: `tests/setup/testing-library.ts` installs
dummy `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` defaults before each
integration file's own `loadDotEnv()`, and the `!(key in process.env)` guard
then ignores the real `.env`. Every M2 RLS assertion rests on reading SQL rather
than running anything. Fix the env precedence, or add executable `pg_policies`
introspection asserted in a test.

---

## Gate output

### `npx tsc --noEmit`
```
(exit 0 — no output)
```

### `npx eslint . --max-warnings=0`
```
(exit 0 — no output)
```

### `npm run migrations:check`
```
> pm-app@0.1.0 migrations:check
> node --env-file=.env scripts/check-migration-drift.mjs

✓ No migration drift — all migrations present on remote.
```

### `npx vitest run tests/integration/planner-block-rls.test.ts`
```
 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

 Test Files  1 passed (1)
      Tests  8 skipped (8)
   Start at  14:30:41
   Duration  185ms (transform 28ms, setup 52ms, import 24ms, tests 24ms, environment 0ms)
```
Nothing executed. Exit 0.

### `npx vitest run tests/unit`
```
 Test Files  41 failed | 466 passed | 1 skipped (508)
      Tests  133 failed | 3270 passed | 3 skipped (3406)
   Start at  14:31:27
   Duration  101.34s (transform 10.70s, setup 77.26s, import 122.31s, tests 72.50s, environment 80.71s)
```
133 failed across 41 files — identical to the F001 baseline recorded at
`run-log.md:24` ("Pre-existing test failures (133 tests, 41 files) are baseline
noise"). No M2 regression. Passing count rose 3266 → 3270.

### Migration files present
```
20261128010000_sitemaps.sql
20261128010001_calendar_blocks_workspace_wide_select.sql
20261128010002_calendar_blocks_drop_task_id.sql
```

### `grep -rn "task_id\|taskId" --include="*.ts" --include="*.tsx" lib/ app/ components/ tests/` — calendar-block scope
Zero hits against `calendar_blocks`. Remaining repo-wide hits belong to
`comments`, `comment_reactions`, `task_assignees`, `attachments`, `notifications`,
`time_entries`, `tasks.parent_task_id` and the generated `database.types.ts`
entries for those tables. `components/calendar/calendar-day-grid.tsx:288-309`
uses a local `taskId` for task drag-reschedule on the personal calendar and
touches no calendar block.

---

## Addendum — cross-milestone exposure opened by M2

These are not M2 assertions, but M2's migration shipped ahead of the milestones
that were supposed to contain its effects. Recording them so the window is visible.

8. **The widened SELECT opens a live AS-042/AS-043 defect now** (major).
   `components/calendar/week-time-grid.tsx:141` and
   `components/calendar/calendar-day-grid.tsx:147`:
   ```ts
   const canDrag = membership ? canWrite({ role: membership.role }) : true;
   ```
   `canDrag` derives from workspace **role** alone and never consults block
   ownership. Before `20261128010001`, a member largely could not see other
   members' blocks, so this was latent. Now any active member with a write role
   sees drag handles and resize grips on **every** other member's blocks, and the
   database correctly refuses the write — the UI offers an action that cannot
   succeed. The `: true` fallback also defaults to draggable when no membership
   provider is present. M5 owns the fix and is unstarted; the exposure exists in
   the tree today.

9. **M3/M4 are unstarted, so AS-029/030/031/033 are not yet in play** (context,
   not an M2 failure). There is no Planner route — only the task-centric
   `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx`. `?people=` is not read
   (`:63-69` types only `week/status/priority/assigneeId/projectId`), and
   `lib/queries/calendar-blocks.ts:66-82` takes no `userIds` and applies no
   `.in("user_id", …)`. Relevant to M2 only because it confirms nothing downstream
   currently constrains the widened read.

10. **`lib/calendar/people-selection.ts` and `lib/calendar/planner-layout.ts` are
    imported by nothing but their own tests** (major, M3 concern). Grep for
    importers returns only `tests/unit/planner-layout.test.ts` and
    `tests/unit/planner-people-selection.test.ts`. Around 29 unit tests exercise
    modules wired to no route. Also `lib/calendar/people-selection.ts:5` documents
    `resolve-filters.ts` as "deleted in F017" while that file still exists and is
    imported — a comment asserting a future state as fact.

11. **The AS-032 delete test lacks the corroboration its sibling has** (minor).
    `tests/integration/planner-block-rls.test.ts:302-318` asserts `data` is `[]`
    and the row survives. A `.delete()` matching zero rows for any unrelated
    reason — wrong id, renamed column — passes identically. The update case at
    `:281-300` is paired with the admin-bypass check at `:336-353`; the delete
    case is not.

12. **Additional silent-failure paths in `lib/actions/calendar-blocks.ts`**
    (minor, beyond finding 4 above). `:73-75` `loadProject` collapses a transient
    DB error into `"Project not found."`; `:100-102` `loadBlockForAuthz` does the
    same with `"Block not found."`; `:238-240` re-reads a row authz already proved
    exists and reports a read error as NOT_FOUND; `:120-129`
    `revalidateCalendarRoutes` swallows all failures into a log line and skips
    revalidation entirely with no log when `workspaceRow?.slug` is null, leaving a
    stale calendar after a successful write. By contrast
    `lib/queries/calendar-blocks.ts:79-81` correctly rethrows.

**FU-N (major, new).** Gate `canDrag` in `week-time-grid.tsx` and
`calendar-day-grid.tsx` on block ownership (`block.userId === currentUserId`) in
addition to the role check, and drop the `: true` fallback in favour of denying
drag when membership is unresolved, so the interface stops offering writes the
widened-read migration guarantees the database will reject.
