# Audit fixes — applied 2026-09-14, branch `audit/2026-09-13`

Commits: `1668f984` (tier 1), `27545719` (cleanup), `9c941ece` (wave 1), `4e51641d` (wave 2), `20a0bdbd` (wave 3), plus the final lint-zero commit.

## Fixed (24 of 28 findings)

| ID | Fix |
|---|---|
| TL-001 | next 16.3.5, tiptap suite 3.x latest, sharp/fast-uri/js-yaml — `npm audit --omit=dev`: **0 vulnerabilities** |
| TL-002 | eslint now **0 errors, 0 warnings** (underscore convention taught to no-unused-vars; genuine dead imports/vars removed; one justified exhaustive-deps disable) |
| TL-003 | 10 verified-dead files deleted; `react-day-picker` and `@tiptap/extension-link` removed |
| TL-004 | `shadcn` moved to devDependencies |
| SEC-001 | `/dev-login` additionally requires `DEV_LOGIN_ENABLED=true` (set only in local `.env`) |
| SEC-003 (anon) | migration `20261126010000`: EXECUTE revoked from `anon` on all 18 predicates — **applied & verified** (`has_function_privilege` false) |
| SEC-005 | same migration: `workspace_slug_history` SELECT scoped to workspace members (both read paths verified compatible) |
| SEC-006 | verified: all mutations to the 13 no-UPDATE-policy tables go through the admin client with app-level checks — deny-by-default confirmed intentional, no change needed |
| NX-001 | baseline security headers in next.config.ts (X-Frame-Options DENY, HSTS, nosniff, Referrer-Policy, Permissions-Policy) |
| NX-002 | theme bootstrap moved to `public/theme-init.js` — no inline script; strict CSP no longer needs `unsafe-inline`; AS-148 XSS-audit test green again |
| NX-003 | zod-validated `lib/env.ts` (server + client-safe halves); supabase helpers and extension routes migrated; missing `EXTENSION_ID` logs loudly |
| NX-004 | `app/not-found.tsx`, workspace-segment `not-found.tsx`, `app/global-error.tsx` |
| NX-006 | `CanvasBoard` (@xyflow) and `MarkdownEditor` (tiptap) code-split via next/dynamic with layout-preserving skeletons; chat composer confirmed already lazy |
| NX-008 | zod schemas for `searchMessages` / `searchPalette` / `resolveRecentItems` (`lib/validation/palette-search.ts`); other 3 flagged modules were false positives (no `"use server"` or no args) |
| ARCH-001 | cached `getWorkspaceContext()`; 23 pages de-duplicated (5 sites intentionally left — different semantics, documented) |
| ARCH-002 | 142 hand-rolled `auth.getUser()` blocks → request-cached `getCurrentUser()` across 50 action files; eslint `no-restricted-syntax` guard added |
| ARCH-003 | `lib/format/` with stated UTC/locale contract; 36 local formatters deleted across 33 files; en-GB pinned (hydration fix) |
| ARCH-005 | portal.ts → 12 modules + barrel; architecture.ts → 4 modules + barrel; task-detail-sheet 2470→1165 LOC (fields + sections extracted). Public APIs unchanged |
| ARCH-006 | logger/attachments comments no longer claim a Sentry equivalent exists |
| ARCH-007 | per-user fixed-window rate limits on all three extension routes (60/300/30 per hour; 429 + Retry-After; fail-open on RPC error); migration `20261126020000` **applied**, DB types regenerated |
| ARCH-008 | `withExtensionAuth()` in `lib/api/extension-auth.ts`; triplication gone |
| ARCH-009 | render-phase prop resync in record-panel + notification-panel; board.tsx documented-skip (realtime reconciliation owns freshness) |
| ARCH-011 | `ActionResult<T>` / `ActionOutcome<T>` in authz.ts; 171/185 aliases converted (17 skipped — shapes genuinely differ) |
| TST-001 | tests fail fast against a hosted project (override `ALLOW_HOSTED_TESTS=1`); unit runs get localhost placeholders + dummy flag so live-DB suites skip instead of dialing |
| TST-002 | README Getting Started; `.env.example` completed. Also fixed 4 unit tests that were **already failing on main** (sidebar router mock, suspense-fallback count, palette no-navigate action, fts-tasks skip) |

## Deliberately not applied (4), with reasons

- **ARCH-004** (drop dead comments fetch in `getTaskDetail`): blocked — `tests/integration/task-detail-comment-read-path.test.ts` enforces immutable contract assertions AS-363/365/366 that require `getTaskDetail` to return comments. Needs a product decision (reinstate the Comments UI or retire those assertions through the mission process).
- **SEC-004** (merge 29 duplicate permissive policy pairs): skipped as risk-outweighs-benefit in a hardening sweep — rewriting 29 RLS policies without the local-stack integration suite runnable here risks a tenancy regression for a per-row perf win. Do it with `supabase start` + the RLS suites green before/after.
- **NX-005** (caching contradiction): resolved as a **decision, not a change** — keep `force-dynamic` + `revalidatePath`: under force-dynamic the revalidate calls still invalidate the client-side Router Cache (they are not no-ops), and the two broad `"layout"`/`"/"` scopes have documented reasons (workspace switcher/logo rendered on every page). Recorded here so it stops being re-litigated.
- **NX-007** (fetch-on-mount waterfalls): deferred — activity feed lives inside the client-mounted task sheet (server-rendering page 1 would thread data through the board/list→sheet chain for a minor win), and the portal request list is realtime-refreshed. Revisit if those views show up in real latency traces.

## Requires the user / dashboard (cannot be done from code)

1. **SEC-002**: enable leaked-password protection — Supabase Dashboard → Authentication → Passwords → "Prevent use of compromised passwords".
2. **ARCH-006 (transport half)**: wiring real error reporting needs a Sentry (or similar) DSN; the `emit()` seam in `lib/observability/logger.ts` is ready for it.
3. **NX-001 (CSP)**: baseline headers shipped and the inline-script blocker removed; enabling a full CSP should be done with a staging pass since third-party assets (Supabase storage images, fonts) need allowlisting.

## Final verification

- `npx tsc --noEmit` — clean
- `npx eslint .` — 0 errors, 0 warnings
- `npx vitest run --dir tests/unit` — 402 files passed, 2624 tests passed, 0 failed (main had 5 failing unit files before this work)
- `npm run build` — passes
- `npm audit --omit=dev` — 0 vulnerabilities
- Integration/e2e suites not run here (require a local Supabase stack; CI runs them — see `.github/workflows/ci.yml`)
- Live DB: both hardening migrations applied and verified via SQL (`anon` EXECUTE false; scoped slug-history policy present; `extension_rate_limits` + RPC in place)
