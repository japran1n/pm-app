# MCP registry

_For workers: which MCP tools to use, and for what._

| Service | MCP server name (CLI) | Tool prefix | Worker use | Notes |
|---|---|---|---|---|
| Supabase | `supabase` | `mcp__supabase__*` | Optional | Primary path for schema changes is the Supabase CLI (`supabase db push` — already linked to project `qcipqonnqajmazdbysow`, works today). If the MCP shows Connected at run time (`claude mcp list`), workers may additionally use it to introspect live schema/RLS/Realtime config before or after a migration. If it still shows "Pending approval", proceed via CLI only — do not block a feature on MCP approval. |
| Playwright | `playwright` | `mcp__playwright__*` | Yes (ux-validator only) | Used exclusively by the ux-validator subagent for milestone behavioral testing. Workers do not need it except F090's e2e test authoring, which can also be written directly as a `.spec.ts` file without live MCP interaction. |

## Non-MCP service access

- **Supabase credentials** (`.env`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_PROJECT_REF` — all verified reachable (see `connections/manifest.md`).
- **Supabase CLI**: linked and authenticated (`supabase link --project-ref qcipqonnqajmazdbysow` already run). Workers use `supabase db push`, `supabase db diff`, `supabase migration new <name>` directly.
- **Sentry**: deferred, not required for `/mission-run`.
- **Vercel**: deferred, not required for `/mission-run`.
