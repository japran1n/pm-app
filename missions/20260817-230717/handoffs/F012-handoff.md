# Handoff: F012 — db schema rls workspaces

## Status
COMPLETE

## Assertions covered
AS-010: PASS — test_AS_010_a_signed_in_non_member_cannot_view_a_workspace_they_dont_belong_to (tests/integration/rls-workspaces.test.ts)
AS-011: PASS — test_AS_011_anon_publishable_key_direct_client_call_for_workspaces_is_rejected_by_RLS and test_AS_011_a_signed_in_non_members_direct_client_call_for_that_workspaces_members_is_rejected_by_RLS
AS-137: PASS — test_AS_137_RLS_is_enabled_on_workspaces_and_workspace_members
AS-138: PASS — test_AS_138_anon_publishable_key_with_no_session_reading_workspaces_returns_zero_rows and test_AS_138_anon_publishable_key_with_no_session_reading_workspace_members_returns_zero_rows
AS-139: PASS — test_AS_139_anon_key_join_style_query, test_AS_139_a_signed_in_non_member_gets_zero_rows_via_a_join_style_query, test_AS_139_a_signed_in_non_member_cannot_see_the_workspace_row_via_a_join

## Files changed
supabase/migrations/20260817222822_rls_workspaces.sql
tests/integration/rls-workspaces.test.ts

## Commands run
`supabase migration new rls_workspaces` (0)
`supabase db push` (0)
`npm test` (0) — 22/22 passing, incl. 9 new RLS integration tests against the live linked Supabase project (qcipqonnqajmazdbysow)
`npx tsc --noEmit` (0)
`npm run lint` (0)
`npm run build` (0)

## Decisions made
- Used a `SECURITY DEFINER` helper function (`public.is_active_workspace_member`) instead of an inline `EXISTS` subquery on `workspace_members` inside the `workspace_members` SELECT policy itself. A self-referencing policy that queries its own table under RLS re-evaluates the policy on the inner query too; `SECURITY DEFINER` with a pinned `search_path` runs the membership check with the function owner's privileges, sidestepping RLS entirely for that internal lookup while still gating on `auth.uid()`. Reused the same helper for the `workspaces` SELECT policy for consistency, and added a second helper `public.is_workspace_admin` (role IN owner/admin) for `workspaces` UPDATE/DELETE.
- `workspaces` INSERT policy is `with check (true)` for any `authenticated` user — RLS does not gate workspace creation itself, per the feature spec's explicit ordering note. This creates a real but accepted gap: between `INSERT` returning and F013 inserting the creator's `owner` membership row, no one (not even the creator) can SELECT/UPDATE/DELETE the new workspace row under these policies, because the membership-gated SELECT/UPDATE/DELETE policies require an active membership row that doesn't exist yet. **F013 must create the owner membership row as part of the same creation flow, before returning to the client**, or the workspace will appear to vanish from the creator's own view.
- `workspace_members` gets a SELECT policy only in this feature. No INSERT/UPDATE/DELETE policies were added — those are owned by F013 (creator-owner bootstrap), the invite-accept flow, and F020/F021 (remove/delete member). Per the feature spec's note ("this feature's job is just the baseline RLS shape, don't over-build role-specific business logic here"), those writes are denied by default under RLS until the owning features add scoped policies. Any server-side write needed before those policies exist (e.g. F013's owner-bootstrap insert) must go through the secret-key server client (`lib/supabase/server.ts` pattern using `SUPABASE_SECRET_KEY`), which bypasses RLS by design and never reaches the browser (AS-140).
- `workspaces` SELECT/UPDATE policies also filter `deleted_at is null`, per tech-decisions.md's soft-delete convention (RLS enforces this, not just app queries). DELETE policy does not filter on `deleted_at` since deleting an already-soft-deleted row for cleanup is a reasonable admin action, not a security gap.
- Did not add `FORCE ROW LEVEL SECURITY`: the app never connects to Postgres as the table owner for reads (all app traffic is either the publishable key, subject to RLS as a non-owner role, or the secret key which is meant to bypass RLS by design for legitimate server-side privileged operations). Adding FORCE would only matter if a table owner role were used for normal queries, which it isn't per tech-decisions.md's client patterns.
- Verification test creates two throwaway Supabase Auth users via the Admin API (secret key, server-side only in the test file, never printed/logged) to prove a real non-member authenticated user gets zero rows — not just the anon-key case. Cleans up both users and the seeded workspace/membership row in `afterAll`. The secret-key-gated describe block uses `describe.skipIf` so the test suite still runs (and the anon-key coverage still executes) in any environment missing `SUPABASE_SECRET_KEY`.

## Out-of-scope work needed
- F013 (creator-owner bootstrap) must insert the `workspace_members` `owner`/`active` row for the creator immediately after `workspaces` INSERT, in the same request — this is a hard dependency created by this migration's RLS shape, not optional.
- F013 or the invite-accept flow must add the `workspace_members` INSERT policy (e.g. "an active owner/admin of the workspace may insert new members" plus a narrower self-service policy for invite acceptance flipping `status` to `active`). Not added here per this feature's stated scope.
- F020/F021 own the specific remove-member / delete-workspace business logic (e.g. preventing removing the last owner); the baseline `workspaces` UPDATE/DELETE policies added here (owner/admin only) are intentionally generic and may need additional `with check` refinement when those features land.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Added a second SECURITY DEFINER helper (`is_workspace_admin`) beyond what the spec's Draft scope literally listed, to implement the "UPDATE/DELETE on workspaces: only for members with role IN ('owner','admin')" requirement from the assignment cleanly and consistently with the AS-010/AS-011 anti-recursion pattern already established for SELECT, rather than inlining a second differently-shaped subquery.
AUTONOMOUS_DECISION: Granted `execute` on both helper functions to `anon` as well as `authenticated` (not just `authenticated`) so that RLS policy evaluation for `anon`-role queries doesn't itself error on a permissions-denied function call — an `anon` caller has no `auth.uid()`, so the helper simply evaluates to `false`/no rows, preserving "filtered not errored" behavior (AS-138).

## Notes for the next worker
- Live schema/policies were verified via `supabase db push` against project `qcipqonnqajmazdbysow` (no separate MCP introspection call was made beyond the CLI push+success output, since the CLI already confirmed application; Supabase MCP was available per mcp-registry but the CLI path was sufficient and matches the "Pattern" in the Clarified implementation section).
- `tests/integration/rls-workspaces.test.ts` reads `.env` directly (simple parser, no new dependency added) since this repo doesn't already depend on `dotenv` and vitest doesn't auto-load `.env`. If a future feature adds a shared test-env-loading dependency, this file's `loadDotEnv()` can be swapped for it.
- Running `npm test` now hits the live Supabase project every run (creates/deletes 2 throwaway auth users + 1 workspace in the admin-key describe block). This is intentional per the task's requirement for real RLS evidence, but worth knowing if test runs should ever be rate-limited or gated behind a `CI`-only flag in a later feature.
