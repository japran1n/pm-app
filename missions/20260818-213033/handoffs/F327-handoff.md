# Handoff: F327 — restore project-lead column management (regression introduced by F326)

## Status
COMPLETE

## Assertions covered
AS-404: PASS — a project lead (workspace role `member`, `project_members.project_role = 'lead'`) can add, rename, reorder and remove a board column through the real Server Actions, and can insert/update/delete a `project_statuses` row directly via PostgREST under their own session. Verified by `tests/integration/f327-project-lead-column-management.test.ts` (10/10 passing).
AS-405: PASS — colour/category validation is unaffected; the lead's add/rename went through the same `addColumnSchema`/`updateColumnSchema` path unchanged, exercised in the same test file.
AS-414: PASS — the regression is fixed (project lead can now write, both via the Server Action and the direct PostgREST path) while the negative cases are preserved: a viewer, a guest, and a plain (non-lead) workspace member still cannot write `project_statuses` via either path, and DB state is asserted unchanged in every negative case. A workspace owner/admin still can, via both paths. All in `tests/integration/f327-project-lead-column-management.test.ts`; the pre-existing `tests/integration/f219-status-management.test.ts` and `tests/integration/f326-rls-hardening.test.ts` suites still pass unchanged (40/40 across the regression slice).

## Files changed
`supabase/migrations/20260829010000_fix_project_statuses_rls_lead_regression.sql` (new)
`tests/integration/f327-project-lead-column-management.test.ts` (new)

## Commands run
`supabase db push` (0) — applied `20260829010000_fix_project_statuses_rls_lead_regression.sql` to the linked project `qcipqonnqajmazdbysow`
`npx tsc --noEmit` (0) — literal output: no output, exit 0
`npx eslint .` (0) — literal output:
```
/Users/sasajapranin/Desktop/pm-app/lib/queries/search.ts
  280:27  warning  '_titleMatches' is defined but never used  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/tests/unit/invite-member-pagination.test.ts
  186:22  warning  '_columns' is defined but never used  @typescript-eslint/no-unused-vars

✖ 2 problems (0 errors, 2 warnings)
```
Both warnings pre-existing/untouched by this feature (same two F326 reported).
`npx vitest run tests/integration/f327-project-lead-column-management.test.ts` (0) — 10/10 tests passed
`npx vitest run tests/integration/f219-status-management.test.ts tests/integration/f220-status-delete-reassign.test.ts tests/integration/f325-status-rename-sync.test.ts tests/integration/f326-rls-hardening.test.ts tests/integration/f327-project-lead-column-management.test.ts` (0) — 5 files, 40 tests passed
`npx vitest run tests/integration/f221-board-custom-columns.test.ts` (0) — 7 passed
`npx vitest run tests/integration/f222-status-category-semantics.test.ts` (0) — 8 passed
`npx vitest run tests/integration/f223-status-integration-list-search-dashboard.test.ts` (0) — 7 passed
`npx vitest run tests/integration/f224-board-swimlane-grouping.test.ts` (0) — 2 passed
`npx vitest run tests/integration/f225-swimlane-drag-reassign.test.ts` (0) — 11 passed
`npx vitest run tests/integration/f226-swimlane-collapse-persist.test.ts` (0) — 6 passed
`npx vitest run --dir tests/unit` (0 exit code from vitest, non-zero test count) — 129 files (128 passed, 1 known pre-existing failure `tests/unit/trash-list.test.tsx`), 995 tests (993 passed, 2 known pre-existing failures — same 2 tests F326's handoff already documented as pre-existing M14 failures, unrelated to this migration/RLS predicate)

## Decisions made
- **Reused the existing `is_project_lead_or_workspace_admin(project_id)` helper verbatim** (`supabase/migrations/20260821140520_project_members.sql`) rather than writing a new one. It already expresses exactly the rule `canManageColumns` (`lib/auth/permissions.ts:69-73`) encodes in application code — workspace owner/admin OR an existing project lead — and it already has the SECURITY DEFINER / `set search_path = public` / narrow-grant (`authenticated, anon`) shape the assignment required of a new helper. `project_members`'s own insert/delete policies already use it for the identical rule, so nothing new was duplicated.
- **New timestamped migration** (`20260829010000_...`), applied via `supabase db push`. F326's applied migration (`20260828040000`) was left untouched — the false claim in its header (that every real write path goes through `createAdminClient()`) is corrected in the new migration's own header instead, since an applied migration cannot be edited.
- **`is_project_workspace_admin` (F326's helper) left in place, unused** by the three rewritten policies, rather than dropped. Dropping it isn't required to fix the bug and nothing else references it — out of this feature's narrow scope.
- **Audited every `project_statuses` writer** (per the assignment's explicit ask):
  - `lib/actions/statuses.ts`'s `addColumn` (insert, ~line 226), `updateColumn` (update, ~308), `reorderColumn` (update via a second `.update({position})` call, ~404), and `removeColumn` (delete, ~503) ALL perform their actual mutation through the request-scoped, RLS-respecting `supabase` client (`createClient()` from `lib/supabase/server.ts`), not the admin client. This is the false claim F326's migration header made — corrected. All four are now covered by the fixed RLS predicate.
  - `removeColumnWithReassignment` (the real UI removal path) calls `admin.rpc("reassign_and_delete_project_status", ...)` — genuinely bypasses RLS, unaffected by this or F326's change either way.
  - F218's `seed_default_project_statuses_on_insert` trigger (`AFTER INSERT ON projects`) — `security definer`, bypasses RLS, unaffected.
  - F220's `reassign_and_delete_project_status` RPC (`20260824040000_status_delete_reassign_rpc.sql`) — `security definer`, bypasses RLS, unaffected.
  - F325's `sync_tasks_status_on_column_rename` trigger (`20260828030000`) — `security definer`, bypasses RLS, unaffected.
  So the RLS predicate change affects exactly the four real RLS-scoped write paths in `statuses.ts`, restoring project-lead access to all of them, and the direct-PostgREST path any test or malicious client could hit.
- **Application-layer `canManageColumns` gate left as the primary authorization check**, RLS as defense-in-depth (unchanged convention) — `authorizeColumnManagement` in `lib/actions/statuses.ts` already calls `isProjectVisibleToCaller` from `lib/actions/project-visibility.ts` before every admin-client read/write in that file; no new copy was introduced.
- **Cascade check re-verified**, not just assumed: a new test creates a project, confirms F218's seed trigger populated default columns, then hard-deletes the project via the admin client and confirms the columns cascade away — proving the widened predicate doesn't interact badly with F219's guard-vs-cascade lesson.
- **Test colour/category values corrected during authoring**: an early draft used hex values not in `COLUMN_COLOR_PALETTE` (`lib/board/column-colors.ts`), which caused false-negative `addColumn` failures unrelated to RLS (Zod validation, not authorization) — caught by a first test run, fixed by using only palette-approved hex values (`#3b82f6`, `#16a34a`, `#ea580c`, `#64748b`).

## Out-of-scope work needed
None identified beyond this single blocker. `is_project_workspace_admin` (F326) is now dead code from these three policies' point of view but was left in place rather than dropped, per the "narrow scope" instruction — a future cleanup pass could drop it if nothing else starts using it, but nothing currently does and leaving it costs nothing.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Reused `is_project_lead_or_workspace_admin` (already defined in `20260821140520_project_members.sql`) verbatim rather than writing a new composing helper, since it already expresses the exact rule needed and already has the required SECURITY DEFINER/search_path/grant shape — this was the "genuinely new helper" fallback the assignment allowed, but it turned out unnecessary because the correct helper already existed.
AUTONOMOUS_DECISION: Did not drop `is_project_workspace_admin` (F326's now-unused-by-these-policies helper) — left as inert dead code rather than risk an out-of-scope migration touching anything beyond the three policies this bug requires fixing.

## Notes for the next worker
- New migration: `supabase/migrations/20260829010000_fix_project_statuses_rls_lead_regression.sql`, applied to the linked Supabase project `qcipqonnqajmazdbysow` via `supabase db push` (no MCP tool call was needed or used — `mcp-registry.md` marks Supabase MCP "Optional" and the CLI push output confirmed a clean apply with no warnings).
- Did not regenerate `lib/supabase/database.types.ts` — this migration changes no table/column/RPC signature, only which existing SECURITY DEFINER helper the three `project_statuses` write policies call.
- If a future worker wants to fully retire `is_project_workspace_admin`, grep confirms (as of this commit) it is referenced nowhere else in `supabase/migrations/*.sql` outside its own definition in `20260828040000_...sql` — safe to drop in a dedicated cleanup migration, but that migration is not this one.
