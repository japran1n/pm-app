# Handoff: F010 — proxy auth guard

## Status
COMPLETE

## Assertions covered
AS-001: PASS — unit test `tests/unit/proxy-auth-guard.test.ts` (6 cases on the extracted `requiresAuth` helper) plus manual curl verification: unauthenticated `GET /w/test-workspace` returns `307` with `location: /sign-in`; `/` and `/sign-in` remain `200` unauthenticated.

## Files changed
proxy.ts
tests/unit/proxy-auth-guard.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0)
`npm test` (0 — 3 files, 13 tests passed, including the 6 new proxy tests)
`npm run build` (0 — build output lists `ƒ Proxy (Middleware)`, confirming the file is detected)
`npm run dev` + `curl -sD - http://localhost:3000/w/test-workspace` → `307 Temporary Redirect`, `location: /sign-in` (dev server stopped afterward, verified no `next dev` process remains)

## Decisions made
- **Placed the file at repo-root `proxy.ts`, not `app/proxy.ts`.** The feature spec listed `app/proxy.ts` under "Files (approximate)" and tech-decisions.md's file-layout diagram shows it nested under `app/`, but that is not how Next.js 16 actually resolves the convention: `node_modules/next/dist/lib/constants.js` defines `PROXY_LOCATION_REGEXP = "(?:src/)?proxy"` — i.e. project root (or `src/`) only, exactly mirroring where `middleware.ts` always lived, never inside `app/`. I confirmed this empirically: with the file at `app/proxy.ts`, `npm run build` produced no "Proxy (Middleware)" line and `curl /w/test-workspace` returned a plain `404` (the guard never ran). Moving the file to root `proxy.ts` made `next build` report `ƒ Proxy (Middleware)` and made the redirect work. Kept the exported function name `proxy` (not `middleware`) per tech-decisions.md's actual breaking-change rule, which is unaffected by the location correction.
- `requiresAuth(pathname)` is exported as a standalone pure function from `proxy.ts` specifically so the redirect condition (AS-001) can be unit tested without constructing a `NextRequest`/`NextResponse`. Matches `/w` and `/w/*`.
- Redirect only fires when `requiresAuth(pathname)` is true AND `user` (from `updateSession()`) is null/undefined; otherwise the refreshed `supabaseResponse` from `lib/supabase/proxy-helpers.ts` is returned unchanged, so session cookies still get synced on every matched request, authenticated or not.
- `config.matcher` uses the standard Next.js exclusion pattern for `_next/static`, `_next/image`, `favicon.ico`, and public image extensions (svg/png/jpg/jpeg/gif/webp), so the guard runs on all real page/route requests without re-processing static assets.

## Out-of-scope work needed
- No actual `/w/[workspaceSlug]` route exists yet (F0xx builds the workspace layout/pages per tech-decisions.md's file layout) — today the redirect fires correctly, but there's nothing behind it yet for an authenticated user to land on. Not a blocker for AS-001, which only requires the redirect-when-unauthenticated behavior.

## Blockers
(none)

## Autonomous decisions
AUTONOMOUS_DECISION: Deviated from the spec's/tech-decisions' stated `app/proxy.ts` path to the correct repo-root `proxy.ts`, because the documented path does not work with Next.js 16's actual proxy-file resolution (verified against the installed `next` package's own constants and confirmed by a failing manual test before the move, and a passing one after). This is a documentation correction, not a design choice — tech-decisions.md's file-layout diagram should be updated to show `proxy.ts` at repo root rather than under `app/`.

## Notes for the next worker
- If you touch auth/session logic again, remember `proxy.ts` must stay at the repo root — do not move it back under `app/`, it silently stops being invoked (no build error, just a missing "Proxy (Middleware)" line in `next build` output and 404s instead of redirects).
- `lib/supabase/proxy-helpers.ts`'s `updateSession()` (from F006) does the cookie-sync/session-refresh; `proxy.ts` only adds the AS-001 redirect branch on top, as F006's handoff anticipated.
