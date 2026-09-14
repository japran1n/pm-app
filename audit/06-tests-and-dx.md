# Phase 6 — Tests & developer experience

## 1. Tests

What exists: **700 test files / 4833 tests** — 404 unit files, 261 integration files, 14 Playwright e2e specs, plus a separate serialized realtime suite (`vitest.realtime.config.ts`) and extension tests. Integration tests are the real thing: they sign in as seeded users against a Supabase stack and assert **RLS behavior directly** (e.g. `tests/integration/client-comments-rls.test.ts`, `client-requests-rls.test.ts`) — exactly the risk area that matters most in this app.

Local run result: `npm test` → **4083 passed, 106 failed (110 files), 57 errors, 588 s**.

### [TST-001] The local test run fails against the shared Supabase project — Auth rate limits
- Severity: medium
- Area: dx
- Location: e.g. tests/integration/assignee-ids-query-wiring.test.ts:211 — `Failed to sign in member: Request rate limit reached` (the dominant error across the 110 failing files)
- Evidence: failures are overwhelmingly `Request rate limit reached` on `signInWithPassword` against the hosted project; CI avoids this by starting an ephemeral local stack (`supabase start`, ci.yml "W6" comment), but `npm test` locally points at whatever `.env` holds — the shared production project.
- Verified by: ran `npm test`, read failure output; read ci.yml
- Why it matters: locally the suite is red for environmental reasons, so developers learn to ignore failures — which is how a real regression slips through. There is also a nastier implication: integration tests run against the production project mutate it (CI's own comment notes catalog suites "briefly mutate the REAL hosted Supabase project" and once corrupted a concurrent run).
- Fix: make `npm test` default to the local stack (fail fast with a clear message if `supabase start` isn't running), and reserve the hosted project for the explicitly-named catalog suites only.
- Effort: M · Confidence: high

Risk-area coverage: auth flows (covered: sign-in, dev-login-equivalent e2e session minting, extension token handoff tests), permission checks (covered heavily — the RLS integration suites are the best part of the whole test estate), data mutations (covered per-domain: bulk delete/restore, board reorder, archive), payments/billing (n/a — none exists). The genuine gap: **nothing exercises the app with security headers / CSP assumptions (there are none to test — NX-001), and nothing covers the rate-limit/abuse cases (ARCH-007)**.

## 2. CI
`.github/workflows/ci.yml`: on push + PR, serialized per-branch, Node 24. Steps: typegen → **tsc → eslint → local Supabase stack → build → unit+integration → realtime (serial) → Playwright e2e**. This is a stronger gate than most professional repos. One note: eslint currently has 3 errors locally (TL-002), so either CI is red on main or the errors are newer than the last push.

## 3. Scripts
All `package.json` scripts reference files that exist (checked `scripts/`). `seed:demo`, `db:apply`, `db:gen-types`, `migrations:check`, `realtime:check` all point at real files reading `.env`.

## 4. README
18 kB, organized by mission milestones (feature catalog) — good product inventory, but there is **no setup section**: no "clone → env → install → run" path, no mention of the local Supabase stack that tests need. A new dev would reconstruct setup from `.env.example` comments and CI yaml.
- **[TST-002]** Severity: low · Area: dx · Location: README.md:1 · Fix: add a 10-line Getting Started (env vars, `supabase start`, `npm run dev`, how to run tests locally). Effort: S · Confidence: high

## 5. `.env.example` completeness
Missing `NEXT_PUBLIC_APP_URL` and `SUPABASE_ACCESS_TOKEN` (both read by code/scripts); contains four vars nothing reads (`SENTRY_*`, `RESEND_*` — the latter documented as intentionally not connected). Effort S; fold into TST-002.

## 6. Git hooks
No husky/lint-staged (`.husky` absent). Repo relies on the mission system's own `.claude/hooks` (worker-exit gates) — fine for the agent workflow, but humans get no pre-commit lint.

## 7. Local dev loop
`next dev --turbopack`; dev boot not separately timed (prod boot ~6 s). `tsconfig.tsbuildinfo` (672 kB) and `test-results/` are committed-adjacent noise; `.next/` correctly ignored. `npm test` takes ~10 min locally and is red (TST-001) — the biggest DX drag.
