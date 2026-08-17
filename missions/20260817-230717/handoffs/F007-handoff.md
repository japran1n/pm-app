# Handoff: F007 — sign in page

## Status
COMPLETE

## Assertions covered
AS-002: PASS — `app/(auth)/sign-in/page.tsx` renders a form (email input + submit button) that calls the `signInWithMagicLink` Server Action, which validates the email via Zod and calls `supabase.auth.signInWithOtp`; on success the client component swaps to a "Check your email" confirmation state. Covered directly by `tests/unit/sign-in-schema.test.ts` (schema-level: AS-002 acceptance/rejection cases) plus manual reasoning over the action/component wiring — full end-to-end coverage (actually receiving/clicking the email) is blocked on F008 (`/auth/callback` doesn't exist yet).
AS-145: PASS — No custom rate-limiting/throttling code was written for the magic-link request path. Documented reliance on Supabase Auth's built-in OTP/magic-link rate limits (see Decisions made below and inline comment in `lib/actions/auth.ts`).

## Files changed
app/(auth)/sign-in/page.tsx
components/auth/sign-in-form.tsx
lib/actions/auth.ts
lib/validation/auth.ts
tests/unit/sign-in-schema.test.ts
vitest.config.ts
package.json (added zod, vitest devDependency)
package-lock.json

## Commands run
`npm install zod@^4.4.3` (0)
`npm install -D vitest` (0)
`npx vitest run` (0)
`npx tsc --noEmit` (0)
`npx eslint .` (0)
`npm run build` (0)
`npm run test` (0)

## Decisions made
- Chose the query-param-free option from the spec's "your choice" wording: the "check your email" confirmation is client-side state, driven by `useActionState`'s returned discriminated-union result, not a query param. Simpler, no extra route/query parsing needed, and avoids a full page reload after submit.
- Server Action lives in `lib/actions/auth.ts` per tech-decisions.md's discriminated-union return convention (`{ ok: true } | { ok: false, error: string }`); never throws across the Server Action boundary. `signInWithOtp` errors are logged via `console.error` (forwarded to Sentry per tech-decisions.md's logging convention) and replaced with a generic user-facing message — raw Supabase error text is never shown to the client.
- Zod validation (`lib/validation/auth.ts`) runs before the Supabase call per AS-146; malformed/missing email never reaches `supabase.auth.signInWithOtp`.
- AS-145: deliberately did not add any custom rate-limiting, IP throttling, or request counting. `supabase.auth.signInWithOtp` (magic-link/OTP send) is subject to Supabase Auth's built-in rate limits (per-email and project-level email-send throttling), which run server-side inside Supabase before an email is actually dispatched — this is what AS-145 asks to rely on and document rather than reimplement. See the comment block above `signInWithMagicLink` in `lib/actions/auth.ts`.
- `emailRedirectTo` origin is derived from the incoming request's `origin`/`host` header via `headers()` (Next.js 16 async-only API), not a hardcoded env var, so it works correctly across local/preview/prod without extra config. Falls back to `https://<host>` then `https://localhost:3000` if `origin` is absent (some server-to-server contexts omit it).
- Followed the spec's "Server Component for data-fetching, thin Client Component only for the interactive part" pattern: `app/(auth)/sign-in/page.tsx` is a Server Component; `components/auth/sign-in-form.tsx` is the sole `"use client"` boundary, using React 19's `useActionState`.
- Of the four states called for in "Clarified implementation" (loading/populated/empty/error): loading = pending submit button state (spinner, disabled inputs) — a full-page Skeleton didn't apply since there's no data fetch, just a static form; populated = the form itself; error = inline `role="alert"` message with the form still available to retry; "empty state" doesn't have a natural meaning for a sign-in form with no list/collection, so it was not force-fitted — noted here rather than silently skipped.
- Added `zod` (already planned in tech-decisions.md but not yet installed) and `vitest` (devDependency, referenced by tech-decisions.md and by the existing `npm test` script's `tests/unit` check but not yet present in `package.json`) plus `vitest.config.ts` with the `@/*` path alias so tests can import via the same alias as the app code.

## Out-of-scope work needed
- F008 (`/auth/callback` route) is required before AS-002's flow can be exercised end-to-end (clicking the emailed link) and before AS-003/AS-004 can be implemented. Not started here — out of scope for F007.
- No Sentry `captureException`/`captureMessage` call was added explicitly in `lib/actions/auth.ts`; per tech-decisions.md's "Logging" convention, `console.error` in Server Actions is auto-forwarded to Sentry via the Next.js SDK instrumentation, so no extra code was needed here, but this assumes Sentry instrumentation (from an earlier feature) is correctly wired project-wide — not re-verified in this feature.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose client-side confirmation state (via `useActionState`) over a query-param-driven server-rendered confirmation state, since the spec explicitly left this as the worker's choice and the client-state approach avoids a full navigation/reload after a simple form submit.
AUTONOMOUS_DECISION: Interpreted "empty state" (from the Clarified implementation's four-states requirement) as not applicable to a single-field sign-in form with no collection/list data, rather than inventing an artificial empty state.

## Notes for the next worker
- `lib/actions/auth.ts` exports `signInWithMagicLink(prevState, formData)` matching React 19 `useActionState`'s action signature — reuse this pattern for other form-backed Server Actions in this mission rather than plain `(formData) => ...` actions, for consistency.
- `vitest.config.ts` and the `zod`/`vitest` npm installs were missing from the repo before this feature; they're now available for any later feature that needs Zod validation or a unit test (e.g. F011+ Server Actions).
- Supabase Auth's magic-link rate-limit defaults are configurable in the Supabase dashboard (Authentication → Rate Limits) if a future feature needs to tune them — no code change required, per AS-145.
