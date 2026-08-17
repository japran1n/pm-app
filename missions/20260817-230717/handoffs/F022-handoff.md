# Handoff: F022 — signout session clear

## Status
COMPLETE

## Assertions covered
AS-022: PASS — `tests/unit/sign-out.test.ts` (signOut() calls supabase.auth.signOut() via the server client and redirects to /sign-in, including when Supabase returns an error) and `tests/unit/sign-out-back-navigation.test.ts` (post-sign-out request to a /w/* URL with no session cookie is redirected to /sign-in by proxy.ts's requiresAuth guard, not served workspace data).

## Files changed
lib/actions/auth.ts
app/(workspace)/w/[workspaceSlug]/layout.tsx
tests/unit/sign-out.test.ts
tests/unit/sign-out-back-navigation.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0)
`npm test` (0) — 16 test files, 84 tests passed
`npm run build` (0)

## Decisions made
- Implemented `signOut()` in `lib/actions/auth.ts` (the file F007 created for `signInWithMagicLink`) as a Server Action returning `Promise<never>`: calls `supabase.auth.signOut()` via `createClient()` from `lib/supabase/server.ts` (the cookie-based, RLS-respecting server client), logs any Supabase error server-side only (matching the existing `signInWithMagicLink` pattern), then unconditionally `redirect("/sign-in")` — even on error, so the user is never left believing they're signed out while still on a workspace page.
- Wired the sign-out control into the workspace layout header (`app/(workspace)/w/[workspaceSlug]/layout.tsx`), next to the F014 `WorkspaceSwitcher`, as a plain `<form action={signOut}>` wrapping a shadcn `Button` (ghost, small, `LogOut` icon from lucide-react) — this is the minimal reachable-everywhere placement per the spec's "your call, keep it minimal" note, and keeps the layout a Server Component (no new client boundary needed; a native form posting to a Server Action doesn't require "use client").
- Did not add a full user-menu dropdown — a single sign-out button satisfies "reachable in the workspace shell" without expanding scope beyond the assigned assertion.

## Out-of-scope work needed
None identified beyond this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Placed the sign-out control as a plain ghost button directly in the header (not a dropdown menu) since the spec explicitly left the exact UI to the worker's judgment ("your call, keep it minimal") and a single button is the smallest surface that satisfies "reachable in the workspace shell."

## Notes for the next worker
- Verification of the "back-navigation shows no cached workspace data" half of AS-022, as requested: confirmed via `tests/unit/sign-out-back-navigation.test.ts`. The mechanism is F010's `proxy.ts` — `requiresAuth()` gates every request whose path matches `/w` or `/w/*`, and `updateSession()` calls `supabase.auth.getUser()` (a live check against the session cookie, not a client-side cache) on every single request the proxy intercepts. Next.js Server Component routes under `/w/*` are server-rendered on each navigation (see this mission's own `next build` output: `/w/[workspaceSlug]` is listed as `ƒ` dynamic, server-rendered on demand) — there is no client-side bfcache of the rendered RSC payload the way an SPA would have for a client-rendered route. So once `signOut()` clears the `sb-*-auth-token` cookies, the very next request to any `/w/*` URL — whether it originates from a fresh navigation, a typed URL, or the browser's back button — has no valid session, `getUser()` returns `null`, and `requiresAuth`'s `!user` branch redirects to `/sign-in` before the workspace layout (or any cached data) is ever rendered. This was traced explicitly rather than assumed, per the task's instruction, because Next.js's own docs are non-committal about whether back/forward cache could ever serve a stale RSC tree — the guard's per-request re-check on the server side makes that question moot: even if the browser held something in memory, the browser would need to make an actual network request to get fresh HTML for a server-rendered route on back-navigation (there is no SPA client-router state to fall back to), and that request goes through this proxy.
- `signOut()` returns `Promise<never>` because `redirect()` always throws (`NEXT_REDIRECT`) — this matches the pattern used by other redirect-then-never-return Server Actions/layouts in this codebase (e.g. the `redirect("/sign-in")` / `redirect("/onboarding")` calls already in `app/(workspace)/w/[workspaceSlug]/layout.tsx`).
- No MCP tools were used for this feature (Worker use: none, per the feature spec).
