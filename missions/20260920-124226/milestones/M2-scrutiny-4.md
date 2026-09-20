# M2 Scrutiny — Pass 4

Verdict: **RED**. One blocker.

## Assertion table

| ID | Status | Reason |
|---|---|---|
| AS-025 | INCONCLUSIVE | Covered by `test_AS_028_active_workspace_member_can_read_another_members_block`; requires live DB creds (suite skipped locally). Accepted per mission note. |
| AS-026 | **FAIL (blocker)** | The test can never pass against a live DB: its own seed insert is rejected by RLS. See below. |
| AS-027 | PASS | Same test asserts `data?.[0]?.title === "Block on private project"`, i.e. the real title, not a placeholder — but inherits AS-026's seeding blocker. |
| AS-028 | INCONCLUSIVE | Non-member and anon cases are well-formed; live DB needed. Accepted. |
| AS-032 | INCONCLUSIVE | Update/delete/insert-forgery cases plus the admin-bypass corroboration are well-formed; live DB needed. Accepted. |
| AS-038 | PASS | `grep -r "task_id\|taskId" --include="*.ts" lib/ app/ components/ tests/` returns zero calendar-block hits. The only surviving mentions are unrelated domains (`task_dependencies.blocking_task_id`, `comments.task_id`, `client_deliverables.task_id`, `task_assignees.task_id`) plus two historical comments naming the migration file `20261128010002_calendar_blocks_drop_task_id.sql`. |
| AS-022 | PASS | Unaffected by F053; `toUtcMs` colon-offset fix from F049 still in place. |

## The blocker: AS-026's test cannot pass

Checks 1 and 2 from the pass-4 brief are satisfied:

- `tests/integration/planner-block-rls.test.ts` seeds the project with
  `.insert({ workspace_id: workspaceId, name: "Private Project", visibility: "private" })`.
- The `beforeAll` catch narrows correctly and ends with `throw e` for anything
  that is not `fetch failed` / `ECONNREFUSED` / `network`.

Check 3 is where it breaks. The reasoning in the brief is right about SELECT
but stops one policy short.

`supabase/migrations/20261128010001_calendar_blocks_workspace_wide_select.sql`
drops and recreates **only** `calendar_blocks_select_visible`. The INSERT
policy is untouched and still carries the original project-visibility gate from
`supabase/migrations/20261107010000_calendar_blocks.sql:69`:

```sql
create policy calendar_blocks_insert_visible
  on public.calendar_blocks
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and (
      (project_id is not null and public.is_project_visible_to(project_id))
      or (project_id is null and public.is_active_workspace_member(workspace_id))
    )
  );
```

`public.is_project_visible_to` (latest definition,
`supabase/migrations/20260908010000_pin_pg_temp_on_client_visibility_predicates.sql:37`)
returns true only when the caller's workspace role is not guest/client **and**
either `p.visibility = 'workspace'` or the role is `owner`/`admin`, **or** the
caller has an explicit `project_members` row.

In the test, `memberUserId` is seeded with `role: "member"`, the project is now
`visibility: "private"`, and no `project_members` row is ever created. So
`is_project_visible_to(project.id)` is **false for the seeding user**, and the
block insert performed through `memberClient` is rejected. The test then hits

```ts
if (blockErr || !block) {
  throw new Error(`Failed to seed project-attached block: ${blockErr?.message}`);
}
```

and fails inside the arrange step — before ever exercising the SELECT policy
it exists to prove. The pass-3 fix made the test discriminating and
simultaneously made it impossible to satisfy.

This was not caught in passes 3 or 4 because `describe.skipIf(!haveAdminCreds)`
silently skips all 8 tests without Supabase credentials in the environment
(`npx vitest run tests/integration/planner-block-rls.test.ts` → `8 skipped`).
An assertion whose test has never executed cannot be called PASS.

### Second-order finding (major, and arguably a real product bug)

The SELECT/INSERT asymmetry is itself suspicious. After F010, an active
workspace member can *read* a calendar block attached to a private project but
cannot *create* one there. Discovery (2.1b / 2.2c), as quoted in the migration's
own header comment, justified the widening with "no private projects exist and
the Team Planner needs unrestricted cross-member read." If private projects
genuinely do exist in this schema (they do — `projects.visibility` supports
`'private'`, and the whole point of the AS-026 fix was to use one), then the
INSERT policy is now inconsistent with the SELECT policy and a member will hit
an opaque RLS rejection when blocking time against a private project from the
Planner. No assertion currently covers this, and no test would catch it.

## Recommended follow-up features

**F054 — Seed AS-026's project-attached block via the admin client.** The AS-026
test must arrange its fixture with RLS bypassed and assert only on the read. Change
the project-attached block insert in
`tests/integration/planner-block-rls.test.ts` from `memberClient` to
`adminClient` (keeping `user_id: memberUserId` so ownership semantics are
unchanged), leaving the `visibility: "private"` project seed exactly as F053 left
it. The act/assert step — `otherClient` selecting the block by id — stays
untouched, so the test still discriminates: under the reverted
`20261128010001` policy, `is_project_visible_to` is false for `otherClient`
(role `member`, private project, no `project_members` row), the block is
filtered out, and the assertion `expect(data?.map(r => r.id)).toContain(block.id)`
fails. Under the new policy `is_active_workspace_member(workspace_id)` is true and
it passes. Verification must include actually running the suite with credentials
present, not merely observing a skip.

**F055 — Make the integration suite fail loudly when it silently skips.** The
`describe.skipIf(!haveAdminCreds)` guard currently means a broken integration
test is indistinguishable from an absent database, which is how this blocker
survived two review passes. Add a mechanism — an opt-in
`REQUIRE_INTEGRATION_DB=1` env flag honoured by the RLS suites, or extending the
existing `process.env.CI` hard-throw to any local run where a `.env` with
Supabase keys is present — so that validator runs cannot report green off a
skipped suite. Document in the milestone runbook that M2 sign-off requires the
integration suite to have actually executed.

**F056 — Reconcile the calendar_blocks INSERT policy with the widened SELECT
policy.** Decide, and record as a new assertion ID, whether an active workspace
member may create a calendar block against a project they cannot otherwise see.
If yes (consistent with the Planner's "unrestricted cross-member" stance), add a
migration widening `calendar_blocks_insert_visible`'s project branch to
`is_active_workspace_member(workspace_id)`, matching the SELECT policy, and add
a test covering the private-project insert path. If no, the Planner UI must
surface a comprehensible refusal rather than a raw RLS error, and that behaviour
needs its own assertion. Either way the current state — readable but not
writable, with nothing testing the gap — should not ship.

## Pre-existing failures outside M2

`npx vitest run tests/unit` reports **41 failed files / 133 failed tests**. All
are in the sitemap-builder and board/list surfaces
(`f003`–`f104`, `list-due-date-cell-*`) and none touch planner, calendar blocks,
or any M2 assertion. These predate M2 and are out of scope for this milestone,
but they mean the repo has no green baseline, which materially weakens any
"tests pass" claim made at a milestone boundary. Worth its own remediation
mission.

---

## Tooling output

### `npx tsc --noEmit`
Clean. No diagnostics, exit 0.

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
```
Clean. No findings, exit 0.

### `npx vitest run tests/integration/planner-block-rls.test.ts`
```
 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

 Test Files  1 passed (1)
      Tests  8 skipped (8)
   Duration  173ms
```
All 8 tests skipped — no Supabase credentials in the environment. Nothing in
this suite was actually verified by execution.

### `npx vitest run tests/unit`
```
 Test Files  41 failed | 466 passed | 1 skipped (508)
      Tests  133 failed | 3270 passed | 3 skipped (3406)
   Duration  85.41s
```
Failing files (all pre-existing, none M2-related):
f015-rename-section, list-due-date-cell-empty-state, f014-rename-page,
f060-discipline-estimate-schema, f250-list-inline-edit, f026-meta-bound-to-section,
f020-reorder-sections, f025-section-card-node-meta-icon, f081-board-performance,
f085-sortable-section-list-details-data, f044-page-column-slug-editor,
f084-keyboard-accessibility, f035-component-detail, f034-component-panel,
f096-invalidate-details-chain, f036-rename-delete-panel, f033-hover-highlighting,
f048-component-panel-dnd, f022-reorder-columns, f007-cms-badge-section-card,
f104-page-column-chain, f018-delete-page, f026-component-picker,
f003-page-client-visibility-toggle, f011-slug-proposal, f032-visual-distinction,
f027-instance-display, f017-delete-section, f023-keyboard-dnd,
f024-drag-cancellation, f016-change-page-kind, f008-section-card,
f045-create-page-dialog-page-kind, f006-section-card-menu-kind-row,
list-due-date-cell-optimistic, f003-section-client-visibility-toggle,
f009-board-layout, f013-create-section, f024-section-card-details-data,
f097-page-column-header-icon-state, f083-note-validation-ui.
