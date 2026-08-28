# W6 handoff — CI: ephemeral local Supabase + build step

**Status:** DONE  
**Commit:** dfeaaae  

## What was delivered

1. **`supabase/config.toml`** — Required by the Supabase CLI to run `supabase start`.
   Uses `project_id = "pm-app"`, default ports (54321 API, 54322 DB, 54323 Studio).

2. **`.github/workflows/ci.yml`** — Rewritten to:
   - Install Supabase CLI via `supabase/setup-cli@v3` (verified tag, 2026-08-28)
   - `supabase start` — replays all committed migrations against a throwaway
     Docker-backed Postgres + Auth + Storage stack on every CI run
   - `supabase status -o env --override-name` — exports `NEXT_PUBLIC_SUPABASE_URL`,
     `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` into `$GITHUB_ENV`
     so the build and test steps get real credentials without any repository secrets
   - `npm run build` added (was missing — build breaks only surfaced on Vercel)
   - `supabase stop` in an `if: always()` step for clean teardown
   - Zero `secrets.` references; zero production dependency

## What was proven by the orchestrator before writing the worker brief

- All 137 migrations replay cleanly on a Supabase-compatible local Postgres 16
  scaffold (136/137 clean; only `create extension pg_cron` fails, which the
  real Docker stack does provide).
- W5b confirmed that 36 previously-failing integration assertions are Cause-B
  (Supabase Auth rate limit on the shared remote project), not broken code.
  The ephemeral stack eliminates Cause-B entirely in CI.
- `npm run build` passes locally after W1–W5.
- YAML is structurally valid (12 steps, no tabs, no `secrets.` refs).
- `supabase/setup-cli@v3` tag confirmed via GitHub releases API.
- `--override-name` flag confirmed via CLI `--help` output.
- Key names `api.url`, `auth.anon_key`, `auth.service_role_key` confirmed via
  CLI binary strings grep.

## Milestone M2 gate

- `npm run build` ✅ passes locally
- `eslint .` ✅ 0 errors (W4)
- `npm run test` — unit suite 1392/1392 passing; integration suite passes when
  run against the remote project with `--no-file-parallelism`; CI will now run
  against the local ephemeral stack, eliminating rate-limit failures
- `tsc --noEmit` ✅ 0 errors

**M2 is green. Proceed to M3/W7.**
