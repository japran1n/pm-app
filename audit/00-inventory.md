# Phase 0 — Inventory

Audit date: 2026-09-13. Branch: `audit/2026-09-13`. Read-only audit; all output under `audit/`.

Project: **pm-app** — an agency project-management app (workspaces, projects, boards, tasks, chat, docs, time tracking, client portal) built almost entirely by AI-agent "missions" (see `missions/` and `CLAUDE.md`). Users: internal team + external clients via the `(portal)` route group. Supabase project ref: `qcipqonnqajmazdbysow` (MCP configured in `.mcp.json`).

## Stack

| Item | Value |
|---|---|
| Next.js | 16.3.1, App Router only (`app/`), Turbopack dev; `proxy.ts` (Next 16's middleware replacement) |
| React | 19.2.8 |
| TypeScript | ^5, `strict: true`, target ES2017, `skipLibCheck: true` |
| Package manager | npm (package-lock.json); node v26.8.1 locally, no `.nvmrc` / `engines` |
| Styling | Tailwind CSS v4 (postcss), `tw-animate-css`, shadcn-style components in `components/ui` |
| UI libs | @base-ui/react, cmdk, sonner, lucide-react, dnd-kit, @xyflow/react, tiptap (editor) |
| State mgmt | No global state lib — React state + server components; realtime via `lib/realtime` |
| Forms/validation | zod v4 (`lib/validation/` — 40+ schema files) |
| Data layer | raw `supabase-js` v2 + `@supabase/ssr` 0.12; no ORM. Generated types in `lib/supabase/database.types.ts` (135 kB) |
| Auth | `@supabase/ssr` — `lib/supabase/{client,server,admin,proxy-helpers}.ts`; session refresh in `proxy.ts` |
| Testing | Vitest 4 (unit/integration/realtime configs), Playwright 1.62 (e2e), Testing Library |
| CI | `.github/` exists — contents checked in phase 6 |
| Observability | `lib/observability/`; SENTRY_* in .env.example but no sentry package in dependencies (checked in phase 4) |

## Size

- `app` + `components` + `lib`: **839 TS/TSX files, ~161 k LOC** (excludes `extension/`, `scripts/`, `tests/`)
- Routes: **71 `page.tsx`**, route groups `(auth)`, `(portal)`, `(workspace)`, plus `app/dev-login`
- Route handlers: **6 `route.ts`** (all under `app/api/extension/`)
- Server Actions: **83 files with `"use server"`** — `lib/actions/` alone has 62 action modules
- `"use client"` files: **321** of 839
- Components: 352 `.tsx` under `components/`
- Supabase: **260 migrations** + a 335 kB baseline SQL; `supabase/config.toml`, `seed.sql`; no `supabase/functions` dir seen (edge functions checked in phase 2)
- Separate workspace: `extension/` — Chrome MV3 QA-feedback extension with its own package.json/lockfile/tests (excluded from root tsconfig + eslint)

## Folder notes (depth ~2)

- `app/` — App Router: `(auth)` sign-in/up, `(workspace)` the main app, `(portal)` client portal, `api/extension/*` the only REST surface, `dev-login` a dev-only login shortcut (risk-checked in phase 2/3).
- `components/` — ~30 feature folders + `ui/` primitives; feature components largely mirror `lib/` domains.
- `lib/` — domain logic: `actions/` (server actions), `queries/`, `validation/`, `supabase/` (4 client helpers), plus per-domain folders (board, chat, portal, tasks…).
- `missions/` — AI-orchestration state (specs, run logs, handoffs). Not app code. 419 kB run-log is the largest committed file after the lockfile.
- `docs/` — 24 planning/review markdown docs, mostly AI-written plans.
- `supabase/` — migrations + baseline + seed.
- `scripts/` — operational scripts (migration apply/drift-check, type-gen, seeding) reading `.env`.
- `tests/` — e2e, integration, unit, realtime, helpers, setup.
- `extension/` — separate MV3 build.
- `.claude/` — agents, commands, hooks, skills for the mission system.

## Dependencies

Runtime: focused and modern (supabase, tiptap suite, dnd-kit, xyflow, zod, date-fns, cmdk, sonner, next-themes, cva/clsx/tailwind-merge).
Suspicious / notable:
- `shadcn` **^4.18.0 as a runtime dependency** — this is the CLI generator, not a runtime lib; belongs in devDependencies at most.
- `server-only` 0.0.1 — fine (official marker package).
- `lucide-react ^1.31.0`, `react-day-picker ^10`, `zod ^4`, `vitest ^4`, `@testing-library/jest-dom ^7` — version plausibility not from memory; no red flags from install state.
- Sentry referenced in `.env.example` but no `@sentry/nextjs` dependency — likely vestigial or hand-rolled observability.

## Environment

Vars read in code (`process.env.*`): `ALLOW_USERNAME_LOGIN`, `EXTENSION_HANDOFF_SECRET`, `EXTENSION_ID`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NODE_ENV`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_SECRET_KEY`, `TZ`.

vs `.env.example`: **missing from example**: `NEXT_PUBLIC_APP_URL`, `SUPABASE_ACCESS_TOKEN`. **In example but unread by app code**: `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (explicitly marked not-connected). `NEXT_PUBLIC_` vars: only the two Supabase publishable ones + APP_URL — correct split. No runtime env validation library; usage-site handling checked in phase 3.

Local `.env` / `.env.local` exist and are **not tracked**; `.env.local` also holds an `ANTHROPIC_API_KEY` (unused by app code — tooling key).

## Git

- 1471 commits, **single contributor** (japran1n), repo age ~4 weeks (first commit 2026-08-17).
- No `.env` files in history (only `.env.example`s). Gitleaks run in phase 1.
- Largest tracked files: package-lock (494 kB), a mission run-log (419 kB), the Supabase baseline SQL (335 kB), generated DB types (136 kB).
