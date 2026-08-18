# Handoff: F025 — db schema rls projects

## Status
COMPLETE

## Assertions covered
AS-028: PASS — test_AS-028 assertions in tests/integration/rls-projects.test.ts: "a user with no membership in workspace A gets zero rows querying workspace A's project directly", "...via a join-style query (projects -> workspaces)", "...cannot UPDATE workspace A's project", "...full list query scoped to workspace A returns zero rows for a non-member", and "a member of workspace A cannot INSERT a project claiming a workspace_id they don't belong to"

## Files changed
supabase/migrations/20260818004709_rls_projects.sql
tests/integration/rls-projects.test.ts

## Commands run
`supabase migration new rls_projects` (0)
`supabase db push --linked` (0)
`npx vitest run tests/integration/rls-projects.test.ts` (0) — 9/9 passing
`npm test` (0) — 21 files / 110 tests passing, incl. the new RLS integration tests against the live linked Supabase project (qcipqonnqajmazdbysow)
`npx tsc --noEmit` (0)
`npx eslint .` (0)
`npm run build` (0)

## Decisions made
- Reused F012's `public.is_active_workspace_member(target_workspace_id)` SECURITY DEFINER helper (from `20260817222822_rls_workspaces.sql`) for all three `projects` policies instead of writing a new inline `EXISTS` subquery — keeps the membership-check logic in one place per the mission's stated convention.
- SELECT policy filters `deleted_at is null` per the soft-delete convention (RLS-level, not just app-level), covering AS-027/AS-031 alongside this feature's assigned AS-028.
- INSERT and UPDATE policies both use `with check (public.is_active_workspace_member(workspace_id))` so a member cannot insert a project claiming a `workspace_id` they don't belong to, nor use an UPDATE to move a project into a workspace they aren't a member of.
- UPDATE policy is intentionally open to any active member (not admin-restricted), matching AS-029 ("edited... by any workspace member"), with the same `deleted_at is null` guard as SELECT.
- **No DELETE policy added.** Per the feature's own draft-scope note and tech-decisions.md's soft-delete convention, `projects` are archived via UPDATE (`deleted_at`, owned by F029/AS-030), never hard-deleted by the app. Absence of a DELETE policy means hard DELETE is denied by default under RLS for both `authenticated` and `anon`, which is the correct baseline; if a future admin/retention feature needs real hard-delete, it should add a narrowly-scoped policy then rather than this feature speculatively adding one now. This is a deliberate omission, not an oversight.
- Did not add `FORCE ROW LEVEL SECURITY`, same rationale as F012: the app never connects as the table owner for reads; privileged server-side access goes through the secret key, which bypasses RLS by design.

## Out-of-scope work needed
- F026 (create-project Server Action) still needs its own app-level membership re-check per tech-decisions.md's "Authorization" convention (RLS is the last line of defense, not the only one) — not part of this migration.
- F029 (archive/soft-delete) will need to confirm its UPDATE call (setting `deleted_at`) is covered by the `projects_update_active_members` policy added here — it is (same shape as any other UPDATE), but if F029's clarified spec restricts archiving to admin/owner only, that will require a narrower dedicated policy (or a `with check` role condition) beyond what this feature added; not built here since F025's scope is the baseline member-level RLS shape only.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Made the DELETE-policy question (left open by the spec as "your call, document it") by omitting a DELETE policy entirely, reasoning that projects are soft-deleted per F029 and RLS's default-deny for unmatched operations already gives the safe behavior (no accidental hard-delete path), matching the pattern's "absence of a policy = denied" precedent already established by F012 for `workspace_members` INSERT/UPDATE/DELETE.

## Notes for the next worker
- Live schema/policies were applied and verified via `supabase db push --linked` against project `qcipqonnqajmazdbysow` (the CLI's success output is the applied-migration evidence, consistent with F012's approach; Supabase MCP was available per mcp-registry but the CLI path was sufficient).
- `tests/integration/rls-projects.test.ts` mirrors `tests/integration/rls-workspaces.test.ts` exactly in structure/style: same `.env` loader, same `describe.skipIf` gating on `haveCoreCreds`/`haveAdminCreds`, same throwaway-user-via-admin-API pattern, same `afterAll` best-effort cleanup. It additionally seeds a *second* workspace (B) with its own active member so the "non-member of A" user is a real signed-in, real-member-somewhere-else user rather than an orphan account — a slightly stronger cross-workspace isolation proof than F012's single-workspace setup.
- Test file also positively exercises SELECT/INSERT/UPDATE success for a real member of workspace A (not just the negative case), directly per this feature's Definition of done ("member of workspace A can read/write workspace A's projects").
