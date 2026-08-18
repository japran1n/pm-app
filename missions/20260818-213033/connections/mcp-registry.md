# MCP registry

_For workers: which MCP tools to use, and for what._ _Mission: 20260818-213033 (v2)_

| Service | MCP server name (CLI) | Tool prefix | Worker use | Notes |
|---|---|---|---|---|
| Supabase | `supabase` | `mcp__supabase__*` | Optional | Primary path for schema changes remains the Supabase CLI (`supabase db push`; project `qcipqonnqajmazdbysow` is linked and ACTIVE_HEALTHY, verified 2026-08-18). `claude mcp list` currently reports the MCP as "Pending approval" — if it is Connected at run time, workers may additionally use it to introspect live schema, RLS policies, and Realtime publications before or after a migration. **Never block a feature on MCP approval.** |
| Playwright | `playwright` | `mcp__playwright__*` | Yes (ux-validator only) | Connected. Used by the ux-validator at milestone boundaries and by workers writing `.spec.ts` files for e2e assertions. |
| Resend | — | — | No | **Not connected.** The user deferred it on 2026-08-18. The `resend` and `@react-email/components` packages are installed, but no `RESEND_API_KEY` exists in `.env`. Features F213–F217 are `[SKIPPED]`. A worker must never attempt an email send or invent a key. |

## Non-MCP service access

- **Supabase credentials** (`.env`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_PROJECT_REF` — verified reachable 2026-08-18 (`connections/verify/supabase.sh` → PASS, HTTP 200).
- **Supabase CLI**: linked and authenticated. Workers use `supabase migration new <name>` and `supabase db push` directly.
- **pg_cron / pg_net**: enabled by migration inside F178 (recurrence) and F212 (overdue sweep). F217 (digest schedule) is skipped with the rest of the email set.
- **Sentry / Vercel**: out of scope for this mission.
