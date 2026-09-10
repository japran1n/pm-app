# Baseline schema

`00000000000000_baseline.sql` is the squashed equivalent of the 246 incremental
migrations in `../migrations/`. It exists so a new Supabase project can be stood
up from a single file instead of replaying six months of history.

It is **not** applied to the current project — that project's ledger already
records all 246 migrations, and `npm run migrations:check` verifies that.

## What it contains

Generated from the live catalog of the linked project, in dependency order:

| Section | Count |
|---|---|
| extensions | 6 |
| enum types | 1 |
| tables | 64 |
| functions | 121 |
| constraints (PK / UNIQUE / EXCLUDE / CHECK / FK) | 361 |
| indexes (not constraint-backed) | 184 |
| triggers | 48 |
| RLS policies | 226 |
| realtime publication members | 12 |

All three fixes from `20261120*` are already folded in: no policy calls
`auth.uid()` unwrapped, every project function has a pinned `search_path`, and
every foreign key has a supporting index.

## Ordering

The section order is not cosmetic. There is a dependency cycle:

- five functions return or declare table row types, so **tables** must come
  before **functions**;
- nine CHECK constraints call project functions (`looks_like_credential`,
  `is_valid_timezone`, `is_valid_link_kind`), so **functions** must come before
  **constraints**.

Hence: tables (columns only) → functions → constraints. `check_function_bodies
= off` is set at the top because function bodies reference tables in ways the
parser would otherwise reject at create time.

## How it was verified

Applied to a scratch PostgreSQL database with Supabase stubs (the `anon`,
`authenticated`, `service_role` roles, an `auth` schema with `auth.uid()`,
`auth.jwt()`, `auth.role()` and `auth.users`, and an empty `supabase_realtime`
publication):

- **0 errors** on apply;
- per-table parity against the live database on columns, policies, constraints,
  triggers and RLS flag — identical across all 64 tables;
- per-table index counts — identical.

Three extensions are stripped for the local check only because they do not
exist outside Supabase: `pg_cron`, `supabase_vault`, `pg_stat_statements`.

## Regenerating

    node --env-file=.env scripts/gen-baseline-schema.mjs supabase/baseline/00000000000000_baseline.sql

Reads `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` from `.env` and goes
through the Management API query endpoint, because this project is remote-only:
there is no local stack and the database password (which `supabase db dump` and
`pg_dump` both need) is not in `.env`.

## Known gaps

- Role grants beyond RLS are not emitted; Supabase's defaults plus the
  `f016i_revoke_default_execute` event trigger cover what this project relies on.
  The event trigger itself is **not** in the baseline — it lives in
  `../migrations/20261007010000*` and must be re-applied separately on a new
  project, along with its `f016i_gated_function_oids` bookkeeping.
- `auth`, `storage` and `realtime` schemas are Supabase-managed and excluded.
- No row data. Seeding is `npm run seed:full-demo`.
