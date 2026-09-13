# pm-app — Codebase Audit (2026-09-13)

## 1. Verdict

**A foundation to build on, after a focused one-to-two-week hardening pass.** This is far above typical AI-generated quality: strict TypeScript with zero errors, RLS on all 69 tables with real tenancy predicates, disciplined server-action error handling, a CI gate stronger than most professional repos. The data layer and auth design would pass a senior review. What needs the pass: missing security headers, a vulnerable Next.js version, no real observability, no rate limiting, and a convention-drift problem (auth boilerplate ×150, workspace lookup ×26, date formatting ×40) that will compound if not centralized now. Not a rewrite candidate in any part.

## 2. Scorecard

| Area | Score | Why |
|---|---|---|
| Security (RLS + app auth + secrets) | **7** | RLS/storage/secrets handling near-exemplary; docked for no security headers (NX-001), vulnerable Next (TL-001), dev-login landmine (SEC-001), 71 exposed SECURITY DEFINER RPCs (SEC-003). |
| Data layer correctness | **9** | 260/260 migrations applied, no drift, deny-by-default policies, self-authorizing RPCs, typed queries, drift-checker in repo. |
| Architecture & boundaries | **6** | Real layering that components respect, but the query layer is bypassed by 26 pages and the authz abstraction lost to copy-paste. |
| Code quality & consistency | **7** | 14 `as any` in 161k LOC, zero TODO debt, consistent naming — but 40× duplicated formatters with disagreeing timezone behavior. |
| Next.js usage | **7** | Correct proxy/session/SSR patterns, near-complete error/loading coverage; contradictory caching strategy, missing not-found/global-error, uneven code-splitting. |
| Performance | **6** | Recent perf mission shows in batched queries; eager tiptap/xyflow bundles, dead comments-fetch on task open, duplicate permissive policies. |
| Test coverage of risk | **8** | 4833 tests including direct RLS integration suites — the right tests; docked because the local run is red for environmental reasons. |
| Developer experience | **6** | Strong CI, working scripts; README has no setup path, `npm test` red locally, no pre-commit hooks, ~10 min suite. |
| **Overall health** | **7** | Solid with known debt. |

## 3. Top 10 findings

1. **[NX-001] No security headers anywhere** — high · security · next.config.ts:1 / proxy.ts. No CSP, HSTS, frame-ancestors, nosniff on a fully-authed app rendering user rich text. Fix: `headers()` block now, nonce-CSP next. Effort S–M.
2. **[TL-001] Next.js 16.3.1 in a critical advisory range** — high · security · package.json. Unauthenticated RCE advisories (AVIF image-optimization path is platform-independent); tiptap prototype-pollution sits in the user-content path. Fix: `npm audit fix` → next 16.3.5 + tiptap patches. Effort S.
3. **[ARCH-001] 26 pages bypass the query layer with a copy-pasted membership check** — high · architecture · settings/page.tsx:52 et al. One missed edit site during a future authz change = silent privilege bug. Fix: shared cached `getWorkspaceContext()`. Effort M.
4. **[ARCH-002] Auth boilerplate hand-rolled ~150× while `withAuthz` exists** — high · architecture · lib/actions/authz.ts:155 vs 52 action files. Consistency of the security path + per-call Auth round trips. Fix: migrate + lint-enforce. Effort L.
5. **[SEC-001] `/dev-login` mints sessions for any email behind a single NODE_ENV check** — medium · security · app/dev-login/route.ts:21. Verified 404 in prod today; one env misconfiguration from account takeover of arbitrary users. Fix: explicit `DEV_LOGIN_ENABLED` gate. Effort S.
6. **[ARCH-007] No rate limiting, including bearer-token extension routes accepting 10 MB uploads** — medium · security · app/api/extension/*. Fix: token bucket + upload cap. Effort M.
7. **[SEC-003] 71 SECURITY DEFINER RPCs exposed via PostgREST, 18 to `anon`** — medium · security · public schema. Sampled functions self-authorize, but the surface is one forgotten `auth.uid()` from a cross-tenant write. Fix: revoke anon on all 18; audit authenticated set. Effort M.
8. **[ARCH-006] Observability is a console wrapper; comments claim Sentry-equivalence** — medium · maintainability · lib/observability/logger.ts. No one learns when actions start failing in prod. Fix: real transport at the existing `emit` seam. Effort M.
9. **[ARCH-003] Date/duration formatting duplicated ~40× with disagreeing UTC/locale behavior** — medium · correctness · 20+ files. Off-by-one-day class on due dates; hydration-mismatch risk. Fix: one `lib/format/`. Effort M.
10. **[TST-001] `npm test` runs (and partially mutates) against the shared hosted Supabase project and fails on Auth rate limits** — medium · dx · tests/integration/*. Red local suite trains developers to ignore failures. Fix: default to local stack. Effort M.

## 4. Finding counts

| Severity | count | | Area | count |
|---|---|---|---|---|
| critical | 0 | | security | 10 |
| high | 5 | | architecture | 3 |
| medium | 12 | | performance | 5 |
| low | 9 | | correctness | 4 |
| info | 2 | | maintainability | 5 |
| **total** | **28** | | dx | 3 |

## 5. Fix plan

**Tier 1 — before anything else (~2–3 days):**
1. TL-001 — `npm audit fix` (next 16.3.5, tiptap, sharp, fast-uri, js-yaml); rerun build + suite.
2. NX-001 — baseline security headers (frame-ancestors, HSTS, nosniff, referrer-policy).
3. SEC-001 — explicit dev-login env gate.
4. SEC-003 (anon half) — `REVOKE EXECUTE FROM anon` on the 18 predicates.
5. SEC-002 — enable leaked-password protection (dashboard toggle).

**Tier 2 — next two weeks (~5–8 days):**
6. ARCH-001 — `getWorkspaceContext()`; replace 26 inline blocks.
7. ARCH-002 — migrate actions to `withAuthz`; lint rule against raw `getUser()`.
8. ARCH-007 — rate limiting + upload caps on extension routes.
9. ARCH-006 — wire a real error-reporting transport; delete misleading comments.
10. TST-001 — point local tests at the local stack.
11. NX-003 — zod-validated `lib/env.ts`; fix silent EXTENSION_ID CORS failure.
12. NX-004 — not-found.tsx + global-error.tsx.
13. ARCH-003 — `lib/format/` consolidation.
14. SEC-003 (authenticated half) — audit `create_notification`, `write_audit_log_entry`, `ensure_task_type` internals.

**Tier 3 — when touching the area:**
NX-005 (caching decision), NX-006 (code-split xyflow/tiptap), NX-007 (fetch-on-mount), NX-008 (5 unvalidated actions), ARCH-004 (dead comments fetch — cheap, do early), ARCH-005 (split god files), ARCH-008 (extension auth helper), ARCH-009 (state resync convention), ARCH-010 (SVG uploads), ARCH-011 (ActionResult<T>), SEC-004 (merge policy pairs), SEC-005 (slug-history scope), TL-002/003/004 (lint zero, dead code, shadcn dep), TST-002 (README setup). Rough total: ~2 weeks spread across normal work.

## 6. What is fine — keep as-is

- **The RLS/policy architecture** (named per-op policies, SECURITY DEFINER predicates, deny-by-default, pinned search_path, storage policies) — do not "simplify" this.
- **The four-client Supabase helper structure** and the server-only admin discipline (zero client-component leaks, extension bundle secret-scanner).
- **`proxy.ts` auth enforcement** with the documented no-cookie fast path.
- **Server-action error contract** (`{ok,error}` union, no DB errors leaking) and the extension route handlers' auth pattern.
- **The realtime layer's React-free factoring** (subscribe/reconcile modules) — genuinely well designed.
- **The integration test suites that assert RLS directly** — the most valuable tests in the repo.
- **UI-from-DB type separation** — zero components import database.types.
- CI pipeline shape (typecheck → lint → ephemeral stack → build → three test tiers).

## 7. Unverified concerns

- The 13 tables without UPDATE policies (e.g. `time_entries`, `project_members`) are *presumed* mutated only via RPCs/admin paths; each should be individually confirmed (SEC-006).
- Of the 53 authenticated-callable SECURITY DEFINER functions, only one was source-audited; `create_notification`/`write_audit_log_entry` forging is plausible if internal checks are missing.
- Generated DB types freshness was not diffed against the live schema (would need CLI typegen against the project).
- Whether CI on main is currently green (3 local eslint errors suggest it may not be).

## 8. Method & limits

Ran: tsc, next build, eslint, npm audit, knip (spot-verified), `next start` + curl sweep, full vitest suite, Supabase MCP (`get_advisors` security+performance, SQL against pg_policies/pg_proc/storage.buckets, migration-count drift check), homemade import graph, manual secret grep of tracked files and `.env*` history. Failed tools: gitleaks (no binary/npx package), dependency-cruiser (resolved 0 modules twice — replaced with the homemade graph). Phases 3 and 4 delegated to read-only review subagents; all their claims carry file:line citations and their raw reports were verified for evidence before inclusion. Not checked: authenticated interior routes at runtime (no credentials used; kept read-only), Supabase dashboard-only auth settings (signup/email confirmation), Lighthouse (Chrome-headless run skipped after route sweep showed no unauthenticated surface to score meaningfully), Vercel/prod deployment config.
