# Handoff: F097 — onboarding membership gate

## Status
COMPLETE

## Assertions covered
AS-005: PASS — `app/(workspace)/onboarding/page.tsx` now performs its own server-side membership check (via the shared `getDefaultWorkspaceSlug` helper) and redirects any user who already has an active workspace membership to that workspace instead of rendering the create-workspace form. Verified by `tests/unit/onboarding-membership-gate.test.ts`, both directions (redirect-with-membership, form-with-none).

## Files changed
lib/queries/workspaces.ts (new)
app/(workspace)/onboarding/page.tsx
app/(auth)/auth/callback/route.ts
tests/unit/onboarding-membership-gate.test.ts (new)
missions/20260817-230717/handoffs/F097-handoff.md

## Commands run
`npx vitest run tests/unit` (0)
`npx tsc --noEmit` (0)
`npx eslint .` (0)
`npm run build` (0)
`npm test` (1 — see Notes: one pre-existing, unrelated live-DB integration test failure, not caused by this change)

## Decisions made
- Chose interpretation (a) from the feature spec's draft scope (redirect to default workspace when an active membership already exists), matching AS-005's literal wording and the spec's default recommendation. Multi-workspace creation via a "create new workspace" affordance is not in scope for this route per the spec's own reasoning (the switcher only lists existing memberships, no "create new" UI exists yet).
- Extracted `getDefaultWorkspaceSlug(supabase, userId)` into `lib/queries/workspaces.ts` rather than duplicating the "most-recently-created active membership → its workspace slug" query in the onboarding page. `app/(auth)/auth/callback/route.ts` was refactored to call the same helper instead of inlining the query, so the "which workspace is default" rule now lives in exactly one place (this was flagged as a drift risk in the M2 scrutiny report's AS-003 finding, and this refactor incidentally reduces that risk, though it does not itself address AS-003's other findings).
- The helper takes the RLS-respecting client (not the admin client), consistent with both original call sites — this is a read of the current user's own rows, which RLS already permits.
- Did not add an explicit `if (!user) redirect("/sign-in")` branch in the onboarding page body: `/onboarding` is already covered by `proxy.ts`'s global matcher (`"/((?!_next/static|_next/image|favicon.ico|...).*)"`), so an unauthenticated request never reaches this Server Component in practice. The `user` null-check is still present as a defensive guard (skips the membership lookup rather than crashing) but does not redirect on its own, matching the "layout/proxy is the primary guard, this page is defense in depth" pattern already used in `app/(workspace)/w/[workspaceSlug]/page.tsx`.

## Out-of-scope work needed
- `npm test` (full run, including live-DB integration tests) shows one unrelated failure: `tests/integration/change-member-role.test.ts` fails with `JWT issued at future` — a clock-skew error from the live Supabase project's JWT validation, not a regression from this change (confirmed unrelated to onboarding/membership-gate code paths; F097 touched no files in that test's scope). This looks environmental (sandbox clock vs. Supabase project clock) rather than a code defect; worth a follow-up if it recurs, but out of scope here.
- The M2 scrutiny report's other AS-003 findings (DB-error branches on membership/workspace lookup silently treated as "no membership"; unguarded `activateInvitedMemberships` call; implicit vs. explicit "default workspace" flag) are not addressed by this feature — F097's scope was specifically AS-005's onboarding-page gate. `follow-up-callback-route-tests-and-hardening` in M2-scrutiny.md already covers these separately.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Extracted the shared `getDefaultWorkspaceSlug` helper (see Decisions made) rather than duplicating the query, since the feature spec explicitly suggested reusing/extracting the auth callback's existing logic rather than duplicating it.

## Notes for the next worker
- `getDefaultWorkspaceSlug` in `lib/queries/workspaces.ts` is now the single source of truth for "which workspace does this user land on by default." Any future feature that needs the same answer (e.g. a "switch to default workspace" action) should call this helper rather than re-querying.
- Test pattern used: `tests/unit/onboarding-membership-gate.test.ts` mocks `@/lib/supabase/server`'s `createClient` with a minimal chainable query-builder stub (only the methods actually called: `select/eq/order/limit/maybeSingle` for `workspace_members`, `select/eq/maybeSingle` for `workspaces`) and mocks `next/navigation`'s `redirect` to throw (matching the existing `tests/unit/sign-out.test.ts` convention), so it runs without a live Supabase connection.
