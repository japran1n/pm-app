# Connections — Mission 20260902-212300

## Summary

**No new external service is introduced by this mission.** It is a brownfield
change to an app whose only external dependency (Supabase) is already
connected, credentialed and in daily use. No package is installed, no MCP
server is registered, no `.env` key is added.

## Services

| Service | Status | How it is reached | Worker use |
|---|---|---|---|
| Supabase (Postgres, Auth, Realtime, Storage) | **Connected, verified** | `@supabase/supabase-js` ^2.112.3 via `lib/supabase/{client,server,admin}.ts`; Management API via `SUPABASE_ACCESS_TOKEN` for migrations | yes — SDK only |
| Supabase MCP server | **Not authorised in this session** | OAuth pending; non-interactive session cannot complete the flow | **no** |
| Resend (email) | Connected, untouched by this mission | `resend` ^6.20.0 | no |

## Supabase MCP: deliberate non-blocker

The Supabase MCP server is listed as requiring authentication and this session
is non-interactive, so it cannot be authorised here. This does not block the
mission:

- No feature requires live schema introspection through MCP.
- The two places this mission touches the live project — reading the migration
  ledger (F001) and reading/altering the `supabase_realtime` publication (F002,
  F006) — go through the Management API with `SUPABASE_ACCESS_TOKEN`, which is
  present in `.env` and was **exercised successfully during planning** (the
  publication membership query in `tech-decisions.md` was run this way).
- Migrations are applied with the repo's own `npm run db:apply`, not MCP.

Workers must use the SDK and the existing script conventions. A worker that
finds itself wanting an MCP tool should report BLOCKED rather than improvise.

## Environment (already present in `.env`, gitignored)

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SECRET_KEY`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`,
`EXTENSION_ID`, `EXTENSION_HANDOFF_SECRET`.

No value is reproduced here. Scripts added by this mission read these from the
environment and are contractually forbidden (AS-003) from printing them.

## Verification performed during planning

| Check | Command | Result |
|---|---|---|
| Supabase CLI present | `npx supabase --version` | 2.116.0 |
| Linked project reachable | `supabase migration list --linked` | 145 migrations, all applied |
| Management API credential valid | `pg_publication_tables` query | 10 published tables returned |

All three passed. No verifier scripts remain to delete.
