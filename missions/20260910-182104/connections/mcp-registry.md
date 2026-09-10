# MCP registry

_Mission: 20260910-182104 · verified 2026-09-10_

This mission adds **no external service and no credential**. `/mission-connect`
had nothing to install. The only verification performed was that the
Supabase MCP responds and the target project is healthy.

| Service | MCP server | Project / scope | Worker use | Notes |
|---|---|---|---|---|
| Supabase | registered, responding | `qcipqonnqajmazdbysow` (ProjectManagement, eu-west-1, PG 17.6, ACTIVE_HEALTHY) | **yes** | Schema introspection, `apply_migration` for DDL, `execute_sql` for RLS probes and negative tests |
| Playwright | registered | local browser | **yes — UX validator only** | Behavioural assertions at milestone boundaries |
| Figma | registered | — | **no** | Out of scope (discovery answer 26) |
| Webflow | registered | — | **no** | Out of scope (discovery answer 28) |
| ClickUp | registered | — | **no** | Out of scope (discovery answer 28) |
| Google Drive | registered | — | **no** | Out of scope |

## Rules for workers

- Use the Supabase MCP to read the live schema before writing a migration.
  Never cite an existing table, column, policy or function from memory.
- Apply DDL through `apply_migration`, and ALSO commit the same SQL as a
  file under `supabase/migrations/` so the repo stays the source of truth.
- Never call the Figma, Webflow, ClickUp or Drive MCP. This mission has no
  external sync; that was an explicit scope decision.
- No `.env` change is required by this mission. Do not create or edit one.

## Credentials

None requested, none stored. Nothing to put in `.env`.
