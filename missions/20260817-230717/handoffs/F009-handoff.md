# Handoff: F009 — expired link handling

## Status
COMPLETE

## Assertions covered
AS-004: PASS — `app/(auth)/sign-in/page.tsx` now awaits `searchParams`, and when `error=auth_failed` (set by F008's callback route on an expired/already-used code) it renders "This link has expired or was already used. Enter your email below to request a new one." directly above the existing `SignInForm` — no separate dead-end page. Covered by `tests/unit/sign-in-expired-link.test.ts` (3 tests: shown on `auth_failed`, absent with no error, absent on unrelated error values).
AS-145: PASS — Confirmed by reading the code (grep across `app/`, `lib/`, `middleware.ts`) that no custom rate-limiter/throttle exists anywhere in the sign-in flow. The reliance-on-Supabase-throttling comment already existed in `lib/actions/auth.ts` (lines 14-20) from F007, so no new comment was needed — verified it is present, explicit, and correctly documents AS-145.

## Files changed
app/(auth)/sign-in/page.tsx
tests/unit/sign-in-expired-link.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0)
`npm test` (0) — 2 test files, 7 tests passed
`npm run build` (0)

## Decisions made
- Kept the error banner inside the same Server Component page rather than a separate route/component, per the spec's explicit instruction ("not a separate dead-end page") — the existing `SignInForm` client component needed no changes since it doesn't need to know about the error state; the page composes both directly.
- Used `role="alert"` on the error banner (matches the existing inline field-error pattern in `SignInForm`) for accessibility/consistency.
- Only `error=auth_failed` triggers the message (exact match), so unrelated/unknown `?error=` values don't show a misleading "expired link" message — added a test to lock this in.
- Tested the async Server Component directly via `react-dom/server`'s `renderToStaticMarkup` in the existing node-environment vitest setup, rather than adding Playwright/jsdom infra (not yet present in the repo) — appropriate given the DoD's "test appropriate to feature type" guidance and that no E2E/Playwright config exists yet in this milestone.

## Out-of-scope work needed
None — F008's callback route already redirects with `?error=auth_failed` for both the missing-code and exchange-error cases, so no changes were needed there.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: No comment was added to `lib/actions/auth.ts` for AS-145 because F007 already added one (lines 14-20) that fully documents reliance on Supabase Auth's built-in throttling. Adding a second, redundant comment would have added noise without changing behavior, so I verified the existing one instead of duplicating it.

## Notes for the next worker
- The sign-in page is now a dynamic route (`ƒ /sign-in` in the build output) because it reads `searchParams`; this is expected and matches Next.js 16 behavior for pages that consume request-time data.
- No Playwright/E2E test infra exists yet in this repo (only `tests/unit` + vitest, node environment, no jsdom/RTL). If a future feature needs real DOM/interaction testing, that infra will need to be set up first.
