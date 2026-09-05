# MCP registry for workers

_Generated: 2026-08-30T22:55:00Z_
_Source: claude mcp list output_

## MCP servers

| Service | MCP server name (CLI) | Tool prefix | Worker use | Use during run for |
|---------|----------------------|-------------|------------|-------------------|
| Supabase | supabase | mcp__supabase__* | yes | migrations (F032), schema inspection |
| Playwright | playwright | mcp__playwright__* | no | UX validator only |

**Note:** Supabase MCP shows "Pending approval" in non-interactive sessions — this is normal. Workers running in `claude --dangerously-skip-permissions` mode will have it available. For F032 (migration), workers may also use `npx supabase db push` via Bash as fallback.

## Non-MCP services (SDK / env only)

| Service | Env vars (names only) | SDK / notes |
|---------|----------------------|-------------|
| Sentry | SENTRY_DSN, SENTRY_AUTH_TOKEN | Already integrated |
| Resend | RESEND_API_KEY, RESEND_FROM_EMAIL | Already integrated |
