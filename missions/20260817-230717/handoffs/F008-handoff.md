# Handoff: F008 — auth callback route

## Status
COMPLETE

## Assertions covered
AS-003: PASS — Verified via `npm run build` (route `/auth/callback` compiles and registers as a dynamic Route Handler) plus manual code inspection of the exchange/redirect logic; no live-Supabase integration test was written (see Notes below for rationale).

## Files changed
app/(auth)/auth/callback/route.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0)
`npm run build` (0)
`npm test` (0)

## Decisions made
- Implemented `GET` as a plain Route Handler (not a Server/Client Component) since a magic-link callback has no UI of its own — it only needs to exchange the code and issue a redirect. This is the standard Supabase Next.js App Router pattern.
- Used `createClient()` from `lib/supabase/server.ts` (already implemented in F007) exactly as-is — no changes to that file — so cookies set during `exchangeCodeForSession` flow through the existing cookie-adapter.
- Missing `code` query param and a failed `exchangeCodeForSession` call are both treated the same way: redirect to `/sign-in?error=auth_failed` rather than throwing. This satisfies the feature spec's explicit failure-handling requirement and keeps behavior consistent with the rest of the app's "never throw across a user-facing boundary" convention in tech-decisions.md.
- **Redirect target on success is `/` (temporary), not "the user's default workspace."** Per the orchestrator's explicit instruction: `workspaces`/`workspace_members` tables don't exist yet (F011/F012 land later in this milestone), so the draft scope's "redirect to the user's default workspace, or onboarding if none" cannot be implemented against real data yet. This is a deliberate, documented placeholder — not a silently dropped requirement. See Out-of-scope section.

## Out-of-scope work needed
- Once F011 (workspaces table), F012 (workspace_members table), and F013 land, this route's final redirect line (`return NextResponse.redirect(new URL("/", requestUrl.origin));`) needs a follow-up: query the signed-in user's workspace memberships and redirect to their default workspace (e.g. `/w/[workspaceSlug]`) if one exists, or `/onboarding` if none. A `TODO(F011-F013)` comment is left directly above that line in the route file to make this easy to find.
- No dedicated onboarding page exists yet (`/onboarding` route from the file layout in tech-decisions.md is not built) — out of scope for F008, needed for the eventual real redirect logic above.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Did not write a dedicated unit test file for this route. The route's only logic is (1) read a query param, (2) call `supabase.auth.exchangeCodeForSession`, (3) build a `NextResponse.redirect`. There is no pure/extractable helper function — pulling the 3-line branching logic into a standalone function purely to unit-test it would mean testing a mock of `NextResponse.redirect`/`URL` construction rather than real behavior, and would still not exercise the actual Route Handler wiring. Full integration testing against a live/local Supabase instance (real magic-link code exchange) is out of scope at the unit-test level per the definition-of-done's own guidance ("integration test for Server Actions touching Supabase" — this is a Route Handler, not a Server Action, and doing so would require a running Supabase project + real auth flow, which the mission's test tooling — vitest, no Supabase local stack configured — isn't set up for). Verified instead via `npx tsc --noEmit`, `npx eslint .`, and `npm run build`, which confirms the route compiles, type-checks (including the `NextRequest`/`NextResponse` and Supabase client types), and is correctly registered as `ƒ /auth/callback` in the Next.js build output.

## Notes for the next worker
- Build output confirms the route exists and is dynamic (server-rendered on demand): `ƒ /auth/callback` in `npm run build` output.
- `lib/supabase/server.ts` (from F007) already handles the Next.js 16 async `cookies()` requirement — no changes needed there.
- The route file has an inline `TODO(F011-F013)` comment marking exactly where the future default-workspace redirect logic goes.
- If a future worker wants an integration test for this route, it would need a way to mint a valid Supabase magic-link `code` (e.g. via Supabase's admin API in a test setup) — consider that when F011-F013 revisit this file.
