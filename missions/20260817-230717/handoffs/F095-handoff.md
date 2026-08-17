# Handoff: F095 — workspace insert RLS hardening

## Status
COMPLETE

## Assertions covered
AS-006: PASS — `tests/integration/create-workspace-owner.test.ts` (5 tests, all passing against the live linked Supabase project): happy-path owner creation, slug-collision handling, unauthenticated rejection, a new test proving a signed-in authenticated user's bare direct `INSERT` on `workspaces` is now rejected (the RLS-bypass orphan path scrutiny found), and a new test proving `create_workspace_with_owner` is atomic (forced slug-collision failure inside the RPC leaves neither a partial workspace row nor a membership row).

## Files changed
supabase/migrations/20260817234323_workspace_create_rpc.sql (new)
lib/actions/workspaces.ts
lib/supabase/database.types.ts (regenerated via `supabase gen types typescript --linked`)
tests/integration/create-workspace-owner.test.ts

## Commands run
`supabase db push --yes` (0) — applied the new migration to the linked project (qcipqonnqajmazdbysow)
`supabase gen types typescript --linked` (0) — regenerated database.types.ts to include the new RPC's types
`npx tsc --noEmit -p tsconfig.json` (0)
`npm run lint` (0)
`npx vitest run` (0) — 87/87 tests passed (17 files)
`npm run build` (0)

## Decisions made
- Chose the "revoke direct INSERT grant, force through a SECURITY DEFINER RPC" approach explicitly named as the preferred option in the spec, over a background-reconciliation-job alternative: it closes the hole structurally (impossible, not just detected-and-cleaned-up) and needs no new scheduled infra.
- The new `create_workspace_with_owner(p_name text, p_slug text)` function is `security definer` `language plpgsql`, does the workspace insert then the `workspace_members` owner insert, and returns `table(id uuid, slug text)`. A single PL/pgSQL function body executes in one implicit transaction, so a failure in the second insert rolls back the first automatically — no manual compensating delete needed, and no window exists where the workspace row exists without its owner row.
- The function reads the owner's user id from `auth.uid()` (not from an argument), so it must be invoked via a client carrying the caller's real session — I changed `createWorkspace` to call `supabase.rpc(...)` on the request-scoped user session client (`@/lib/supabase/server`'s `createClient()`), not the admin/service-role client. This also means a caller can never pass someone else's id as the new owner.
- Dropped `workspaces_insert_authenticated` (`with check (true)`) and ran `revoke insert on workspaces from authenticated`. In Postgres, table-level grant checks happen before RLS policies are even consulted, so this closes the bypass regardless of any current or future INSERT policy — a bare `authenticated`-role `.from("workspaces").insert(...)` now fails at the grant-check stage. No replacement INSERT policy was added since the RPC (running as the function's elevated owner role) doesn't need one.
- `findAvailableSlug` still runs via the admin client (SELECT-only, unaffected by the revoked INSERT grant) exactly as before; `createWorkspace` still resolves the slug before calling the RPC, so slug-collision UX (append `-2`, `-3`, ...) is unchanged. The RPC's own unique-constraint violation remains the final backstop for races, same as before, now inside the atomic function instead of the old app-level try/rollback.
- Regenerated `lib/supabase/database.types.ts` via `supabase gen types typescript --linked` per tech-decisions.md's "generated types, not hand-written" convention; diffed it before overwriting and confirmed the only change was the new `Functions` entries for `create_workspace_with_owner` (plus the two pre-existing helper functions, which were already live but had never been reflected in the checked-in types file — harmless, additive).
- Rewrote `tests/integration/create-workspace-owner.test.ts`'s mock of `@/lib/supabase/server` to add an `rpc()` that delegates to a *real*, signed-in (password-auth) publishable-key client for the current throwaway test user, since the RPC needs a genuine `auth.uid()` — a fabricated user id string (the old mock's approach) isn't sufficient once the write path goes through a session-scoped RPC instead of the admin client.

## Out-of-scope work needed
None beyond what's already tracked in M2-scrutiny.md's other follow-up items (sole-owner atomic guard, onboarding membership gate, etc. — separate features, not touched here).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
None — the spec's fix approach (SECURITY DEFINER RPC + revoke grant) was explicit and was followed as written.

## Notes for the next worker
- The migration file is `supabase/migrations/20260817234323_workspace_create_rpc.sql`; it's already been pushed to the linked project via `supabase db push --yes`, so the live schema and this repo's migration history are in sync — no further action needed there.
- If a future feature needs to seed a workspace directly for test fixtures, keep using the admin/service-role client (`lib/supabase/admin.ts`) as every other integration test in this repo already does — it bypasses RLS and table grants by design (service_role is not `authenticated`), so the revoked INSERT grant does not affect it.
- The new atomicity test (`F095/AS-006: create_workspace_with_owner is atomic...`) forces the failure by pre-seeding a colliding slug via the admin client, then calling the RPC directly with that same slug so its internal `workspaces` INSERT hits the unique constraint and raises. This is a real forced-failure test of the transaction boundary, not a mock.
