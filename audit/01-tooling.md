# Phase 1 — Deterministic tooling (interpretation)

Raw outputs in `audit/01-tooling/`.

## Results at a glance

| Tool | Result |
|---|---|
| `tsc --noEmit` | **0 errors** (strict mode on) |
| `npm run build` | **passes**, no warnings; all routes dynamic (ƒ) — expected for a fully-authed app. Next 16/Turbopack build output prints no per-route bundle sizes, so the >300 kB first-load check could not be done from build output (see phase 5). |
| ESLint | 3 errors, 38 warnings — 37× `no-unused-vars`, 3× `no-explicit-any`, 1× `exhaustive-deps`. No rules disabled in config that hide problems ([eslint.config.mjs](eslint.config.mjs) is stock next/core-web-vitals + TS; only `extension/` is ignored, which has its own config). |
| knip | 49 "unused files", 105 unused exports, unused deps `@tiptap/extension-link`, `react-day-picker`; unlisted `pngjs`, `@dnd-kit/utilities` |
| npm audit (prod) | 1 critical, 4 high, 32 moderate |
| gitleaks | **could not run** (no binary; npx package unavailable). Substitute: `git grep` for `sk-ant-`, `sb_secret_`, JWT prefixes, AWS keys, private-key blocks across tracked files — only comments/checker-scripts matched. No secret material in the repo or in `.env*` history. |
| depcruise | **failed** (v17 `--no-config` run resolved 0 modules against this tsconfig; two attempts). Substitute: homemade `@/` import graph, below. |

## Type-escape counts (app+lib+components, ~161 k LOC)

`as any`: 14 · `: any`: 15 · `@ts-ignore`/`@ts-expect-error`: 0 · non-null `!.`: 26. For a codebase this size these numbers are excellent.

### [TL-001] Dependency vulnerabilities: Next.js 16.3.1 sits in a critical advisory range
- Severity: high
- Area: security
- Location: package.json (`next: 16.3.1`)
- Evidence: `npm audit --omit=dev`: critical on `next` 16.0.0–16.3.2 ("Unauthenticated RCE on Windows-hosted servers", "Unauthenticated RCE in Image Optimization API when AVIF files are used"); fix = 16.3.5 (semver-patch). Also high: `@tiptap/core` (prototype-pollution via `mergeAttributes`, ReDoS), `fast-uri`, `js-yaml`, `sharp` (libheif).
- Verified by: ran `npm audit --omit=dev --json` (audit/01-tooling/npm-audit.json)
- Why it matters: the Next advisories are unauthenticated and network-reachable. Deployment is presumably Linux (Vercel), which blunts the Windows RCE, but the image-optimization AVIF path is platform-independent, and tiptap renders user-authored content (task descriptions, chat, docs) — prototype pollution in `mergeAttributes` is directly in the user-content path.
- Fix: bump `next` to ≥16.3.5 and the tiptap suite to the patched minors; `npm audit fix` covers all five without a semver-major.
- Effort: S
- Confidence: high

### [TL-002] `npm run lint` never fails — 3 errors and 38 warnings are live on main
- Severity: low
- Area: maintainability
- Location: repo-wide (eslint.json); e.g. 37× unused vars
- Evidence: `npx eslint .` exits with errors present; CI gating checked in phase 6.
- Verified by: ran eslint, counted by rule
- Why it matters: small today, but unused-var noise is exactly the debris AI generation accretes; without a clean baseline the count only grows.
- Fix: fix the 3 errors, autofix/prune the warnings once, keep lint blocking in CI.
- Effort: S
- Confidence: high

### [TL-003] Dead files and exports (knip, spot-verified)
- Severity: low
- Area: maintainability
- Location: e.g. components/brief/question-list-sortable.tsx, components/portal/portal-coming-soon.tsx, components/ui/scroll-area.tsx, lib/queries/status-note.ts, scripts/gen-baseline-schema.mjs; 105 unused exports
- Evidence: knip.json; spot-check of 6 flagged files by grep found ~half genuinely unimported (question-list-sortable, portal-coming-soon, scroll-area: 0 importers) and the rest false positives from knip's lack of workspace config for `extension/` (its configs/scripts are all flagged). False-positive rate is real — verify each before deleting.
- Verified by: knip + per-file grep of 6 samples
- Why it matters: ~20 genuinely dead app files and 105 dead exports mislead readers about what is in use.
- Fix: add a knip config with `extension/` as a workspace, then delete what survives verification.
- Effort: M
- Confidence: medium

### [TL-004] `shadcn` CLI is a production dependency
- Severity: info
- Area: maintainability
- Location: package.json (`"shadcn": "^4.18.0"` in `dependencies`)
- Evidence: shadcn is a code generator invoked via CLI, never imported at runtime (0 imports found).
- Fix: move to devDependencies or remove.
- Effort: S · Confidence: high

## Import-graph summary (homemade; depcruise failed)

Most-imported modules: `lib/supabase/server` (164), `components/ui/button` (140), `lib/observability/logger` (130), `lib/utils` (93), `lib/auth/permissions` (83), `lib/supabase/admin` (72), `lib/queries/portal` (60). Coupling concentrates exactly where it should — infra helpers and UI primitives — not in feature-to-feature imports.
Most outgoing imports: `components/task/task-detail-sheet.tsx` (52 internal imports, 2470 LOC) is the clear god-component; then task-list-table (29), board.tsx (25), workspace layout (25). Detailed in phase 4.
