# Handoff: F006 — supabase clients

## Status
COMPLETE

## Assertions covered
(none — foundation/infra feature per feature spec)

## Files changed
lib/supabase/client.ts
lib/supabase/server.ts
lib/supabase/proxy-helpers.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0)
`npm run build` (0)

## Decisions made
- Replaced F003's stub `lib/supabase/client.ts` and `lib/supabase/server.ts` with real `@supabase/ssr` implementations, matching the package version already installed (`@supabase/ssr@0.12.4`).
- `client.ts` uses `createBrowserClient` with `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (new key format per tech-decisions.md), no secret key.
- `server.ts` uses `createServerClient` with `await cookies()` (Next.js 16 async-only API) and the standard `getAll`/`setAll` cookie adapter, wrapping `setAll` in try/catch since Server Components can't set cookies directly (session refresh is deferred to proxy.ts). Uses the same publishable key, not the secret key — per spec, this is the RLS-respecting client for application logic.
- `proxy-helpers.ts` exports `updateSession(request: NextRequest)`, following @supabase/ssr's documented Next.js middleware cookie-sync pattern (rebuild `NextResponse.next()` inside `setAll`, mirror cookies onto both `request.cookies` and the response). It returns `{ supabaseResponse, user, supabase }` so F010's `app/proxy.ts` can build its auth-guard redirect logic on top without duplicating the cookie-sync boilerplate. The actual exported `proxy` function is explicitly left for F010, per the feature spec's scope boundary.
- Did not touch `app/proxy.ts` — out of scope for this feature (F010's job).

## Out-of-scope work needed
- F010 (proxy-auth-guard) must create `app/proxy.ts` exporting `proxy(request: NextRequest)`, call `updateSession(request)` from `lib/supabase/proxy-helpers.ts`, and add sign-in/redirect logic plus the `config.matcher`.

## Blockers
(none)

## Autonomous decisions
AUTONOMOUS_DECISION: No unit/integration test written for these files — they are thin factory functions wrapping `@supabase/ssr` with no branching logic to assert beyond "it compiles and builds," which `tsc`/`eslint`/`next build` already verify. Per the feature's own "Clarified implementation" section, this feature covers no assertion IDs and its defined success proof is the tech-decisions.md "how to run" commands exiting 0, which all passed.

## Notes for the next worker
- `@supabase/ssr` cookie pattern used: https://supabase.com/docs/guides/auth/server-side/nextjs (createBrowserClient / createServerClient with getAll/setAll cookie adapters), adapted to Next.js 16's async `cookies()` and the `proxy.ts` filename/export rename per tech-decisions.md.
- Real Supabase credentials are already present in `.env` (from F003); did not print or inspect their values, only referenced the env var names.
