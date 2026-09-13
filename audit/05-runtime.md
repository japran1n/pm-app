# Phase 5 — Runtime health

1. **Prod build passes** (`npm run build`, exit 0, no warnings, no hydration-mismatch or "Dynamic server usage" errors in output). **Prod mode boots**: `next start` on :4123 served requests within ~6 s.
2. Route sweep (curl, cold prod server):

| Route | Status | Time |
|---|---|---|
| `/` | 200 | 0.04 s |
| `/sign-in` | 200 | 0.04 s |
| `/w/x` (protected) | 307 → /sign-in | 0.002 s |
| `/portal/x` (protected) | 307 → /sign-in | 0.002 s |
| `/dev-login` | **404** | 0.02 s |
| `/api/extension/tasks` (GET) | 405 | 0.02 s |
| `/nonexistent` | 404 | 0.005 s |

No 500s, no redirect loops, nothing slow. The two important runtime confirmations: **protected trees are enforced server-side in proxy.ts** (307 before any page code), and **the `/dev-login` NODE_ENV guard actually returns 404 in production mode** (SEC-001 remains a latent, not live, risk).

3. Authenticated-page checks (Playwright/lighthouse over signed-in flows) not run: no test credentials were used against the live project to keep the audit read-only and avoid the Auth rate-limit the test suite already triggers (see phase 6). Deeper interior-route latency was covered by the recent perf mission's own assertions and is not re-verified here.
4. Server stopped after the sweep.

Limits: unauthenticated surface only; all `/w/*` and `/portal/*` interiors exercised only as redirects.
