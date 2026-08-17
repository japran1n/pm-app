# Handoff: F013 — onboarding create workspace

## Status
COMPLETE

## Assertions covered
AS-005: PASS — auth callback route redirects a zero-membership user to /onboarding; onboarding page renders the create-workspace form (verified via build's static route output and `tests/unit/create-workspace-schema.test.ts`/manual code read; no dedicated Playwright test added per DoD — this milestone's "manual verification: none beyond automated test" answer and AS-005's own nature as a routing/UI-presence assertion, not a data-mutation one).
AS-006: PASS — `tests/integration/create-workspace-owner.test.ts` "AS-006: creating a workspace makes the creating user its owner (active)" ran against the real linked Supabase project and asserts the resulting `workspace_members` row has `role: "owner"`, `status: "active"`, and the creating user's `user_id`.

## Files changed
app/(workspace)/onboarding/page.tsx
components/onboarding/create-workspace-form.tsx
lib/actions/workspaces.ts
lib/validation/workspaces.ts
lib/supabase/admin.ts
app/(auth)/auth/callback/route.ts
tests/unit/create-workspace-schema.test.ts
tests/integration/create-workspace-owner.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0)
`npm run test` (0) — 6 files / 34 tests passed, including the new AS-006 integration tests against the real Supabase project (not skipped — `.env` has admin creds)
`npm run build` (0) — `/onboarding` compiles as a static route, `/auth/callback` as dynamic

## Decisions made
- **Orphan-prevention strategy (spec-required choice):** chose "catch the second insert's failure and roll back the workspace insert manually" over a Postgres RPC/transaction function. `createWorkspace` inserts the workspace row, then the `workspace_members` owner row; if the membership insert fails, it explicitly `delete`s the just-created workspace row (compensating action, logged to console/Sentry-forwarded on both the original and rollback-failure paths) rather than leaving an orphaned, memberless workspace. Rationale: this mission has no other RPC/stored-procedure precedent in `supabase/migrations/`, and a two-insert bootstrap sequence with an explicit compensating delete is simple enough not to need one — an RPC would be the better choice if this pattern needed to repeat elsewhere, but it doesn't yet.
- **Both inserts use the secret-key admin client (`lib/supabase/admin.ts`), not the cookie-bound RLS client.** F012's RLS migration deliberately left `workspace_members` with no INSERT policy (see its comment: "Server-side flows that must write before a membership policy exists ... use the secret-key server client"). The `workspaces` table does have an `insert ... with check (true)` policy for any authenticated user, but using the admin client for both keeps the two inserts symmetric and lets `findAvailableSlug`'s uniqueness check see every workspace, not just ones RLS would let the caller (who isn't a member of anything yet) see.
- **`slugify`/`findAvailableSlug` live in `lib/validation/workspaces.ts`, not `lib/actions/workspaces.ts`.** A `"use server"` file requires every export to be an async Server Action; `slugify` is a plain sync helper, so it (and its sibling `findAvailableSlug`) were placed in the validation module instead. This also made them directly unit-testable without invoking the Server Action machinery.
- **Slug collision handling:** case-insensitive base slug + `LIKE 'base%'` lookup against all workspaces, then first unused `-2`, `-3`, ... suffix. The `workspaces.slug` column already has a `unique` constraint (F011 migration) as the final backstop against a race between the check and the insert.
- **Auth callback (F008's "temporary" resolution):** looks up the most recently created `active` `workspace_members` row for the signed-in user (via the ordinary RLS-respecting server client, not the admin client — a user's own membership rows are visible under the F012 SELECT policy) and redirects to that workspace's slug; zero memberships redirects to `/onboarding`. Two-step query (membership row, then workspace row by id) instead of a `workspace_members` → `workspaces` embedded select, because the generated `Database` type marks that FK as `isOneToOne: false`, so the embedded select's TypeScript type is an array and `tsc` rejected `.slug` access on it directly.
- **`lib/supabase/admin.ts` does not import the `server-only` package** (it isn't a project dependency) — relies instead on this file only ever being imported from `"use server"` action modules, matching how `lib/supabase/server.ts` (also server-only in practice) is handled elsewhere in the codebase.

## Out-of-scope work needed
- No dedicated Playwright/E2E test was added for AS-005's UI-presence behavior (form renders, route reachable). Per the DoD's "manual verification: none beyond the automated test" and this milestone's Q26 answer (critical paths only), and because AS-005 is a routing/presence assertion rather than a data-mutation one, this was judged adequately covered by the build's route-generation output plus the callback route's logic. If a future milestone wants stronger evidence, an E2E test navigating a fresh zero-membership session to `/auth/callback` and asserting it lands on `/onboarding` with the form visible would close that gap.
- The `/w/[workspaceSlug]` layout/page (workspace switcher, membership guard) referenced by this feature's redirect target does not exist yet — it's listed in tech-decisions.md's file layout but not yet built by any prior feature. `createWorkspace`'s `redirect(/w/${slug})` and the callback route's redirect will 404 until that route lands; this is expected and out of this feature's scope (not an F013 defect).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Workspace name validation caps length at 80 characters. The spec said "reasonable length" without a number; 80 matches common product conventions (e.g. GitHub org name limits) and is enforced both in the Zod schema (`lib/validation/workspaces.ts`) and via the form input's `maxLength` attribute.

## Notes for the next worker
- `createWorkspace` is a `useActionState`-driven Server Action following the same shape as F009's `signInWithMagicLink` (discriminated union result, `_prevState` first param, generic error message on unexpected failure, real error `console.error`'d for Sentry forwarding). `components/onboarding/create-workspace-form.tsx` mirrors `components/auth/sign-in-form.tsx`'s structure closely.
- The integration test (`tests/integration/create-workspace-owner.test.ts`) mocks `@/lib/supabase/server`'s `createClient()` so `auth.getUser()` resolves to a real throwaway Supabase Auth user without a live Next.js request/cookie context, and mocks `next/navigation`'s `redirect()` to throw a catchable marker instead of using Next's internal redirect signal — everything downstream (both inserts, the slug collision logic) runs against the real database via the same admin client the action itself uses. It creates and cleans up its own throwaway users/workspaces in `afterAll`, following the pattern from F012's `tests/integration/rls-workspaces.test.ts`.
- MCP used: none (no Supabase MCP tool access was available in this worker's session; verification was done by running the real integration tests against the linked project via `.env` credentials instead, which is why they weren't skipped).
