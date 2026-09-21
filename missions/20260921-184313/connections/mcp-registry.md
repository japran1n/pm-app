# MCP Registry — Mission 20260920-124226

## Supabase

- **Server name (from `claude mcp list`):** `claude.ai Supabase`
- **Tool prefix:** `mcp__supabase__*`
- **Purpose:** Live schema introspection, RLS policy management, migration apply, type generation
- **Worker use:** yes — M2 migration features (F006, F007) use `mcp__supabase__apply_migration`; F012 uses `mcp__supabase__execute_sql` to verify RLS; other features use standard file edits only
- **Auth:** Connected via claude.ai connector (no credentials needed in .env)
