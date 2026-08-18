# Connections manifest

_Mission: 20260818-213033 (v2)_ _Started: 2026-08-18_

Mission 1 already connected Supabase (CLI + credentials + MCP) and Playwright.
This mission re-verifies those and adds one new service: Resend.

| Service | Type | What I'll set up | What I need from you | Status |
|---|---|---|---|---|
| Supabase | database + auth + storage + MCP | Re-verify `.env` credentials reach the project; confirm CLI link to `qcipqonnqajmazdbysow`; MCP already registered in `.mcp.json` | nothing (carried over from mission 1) | PASS |
| Playwright | MCP (ux-validator only) | Already registered and Connected via `claude mcp list` | nothing | PASS |
| Resend | API (email send) + optional MCP | `npm install resend @react-email/components` (done) — env vars not written | **deferred by the user on 2026-08-18**: no API key provided; F213–F217 tagged [SKIPPED] | SKIPPED |
| pg_cron / pg_net | Postgres extensions on the existing Supabase project | Enabled by migration inside F178 / F212 / F217 (worker task, not a credential) | nothing | N/A |

## Notes

- **Resend MCP exists** (official, OAuth-based remote server) <!-- https://resend.com/docs/mcp-server, https://github.com/resend/resend-mcp — verified 2026-08-18 -->. It is an agent-side convenience for inspecting domains and sending test mail, not a substitute for the in-app SDK: the application itself must send through the `resend` npm package from server code. Registration is optional and requires a browser OAuth approval, so it is not a gate for `/mission-run`.
- **Supabase MCP shows "Pending approval"** in `claude mcp list`, exactly as it did in mission 1. Schema work proceeds through the Supabase CLI (`supabase db push`), which is linked and works. Workers must not block on MCP approval.
- **Sentry / Vercel** — still deferred; not required by any assertion in this mission (error monitoring was explicitly cut from scope).
