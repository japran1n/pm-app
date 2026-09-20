# Run deferred

## AS-170, AS-171, AS-174 — deferred after 2 passes (environment constraint)
_Assertions: AS-170, AS-171, AS-174_ _As of: 2026-09-20_

These require Docker (for `supabase db diff --use-migra`) and live Supabase CI
credentials to run `db:gen-types` in a pipeline step. Neither is available in
the offline dev environment. Migrations:check is already green; types file is
manually verified clean (columns absence confirmed by m9-migration-check.test.ts).
