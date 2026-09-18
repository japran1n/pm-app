# Connections manifest

_Mission: 20260917-170249_

Per `tech-decisions.md`'s "External services needed" section: **none**. This
feature is a stateless HTML/CSS/JS → Webflow payload converter with no
database, no auth provider beyond pm-app's own existing Supabase session, no
third-party API, no MCP-backed service. It uses two npm libraries
(`node-html-parser`, `postcss`) that are installed as ordinary dependencies
in Foundation milestone feature F001 — that is a `package.json` change made
by a worker, not a connection requiring credentials or verification here.

| Service | Type | What I'll set up | What I need from you | Status |
|---|---|---|---|---|
| (none) | — | — | — | N/A |

No rows to process. Nothing to verify. Nothing added to `.env`.
