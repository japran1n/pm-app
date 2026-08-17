# Connection Manifest

_Generated: 2026-08-17T22:00:00Z_

| # | Service | Type | What I'll set up | What I need from you | Status |
|---|---------|------|------------------|----------------------|--------|
| 1 | Supabase | mcp + database | Register Supabase MCP (`claude mcp add`, project-scoped, read_only for orchestrator); install `@supabase/ssr` + `@supabase/supabase-js`; write `.env` (URL + publishable + secret key); run `supabase link` | Project URL, publishable key (`sb_publishable_*`), secret key (`sb_secret_*`) | PENDING |
| 2 | Playwright | mcp | Register Playwright MCP via `claude mcp add playwright npx @playwright/mcp@latest` | Nothing — fully automated | PENDING |
| 3 | Sentry | api | Install `@sentry/nextjs`, run its setup wizard non-interactively where possible, write `SENTRY_DSN`/`SENTRY_AUTH_TOKEN` to `.env` | DSN (public), and an auth token for source-map upload (optional — can be skipped for local dev, added before Vercel deploy) | PENDING |
| 4 | GitHub | cli-tool | Init git remote, verify `gh`/`git` CLI works for CI pipeline pushes | Nothing for `/mission-run` itself — a GitHub repo URL only if/when you want me to push | PENDING |
| 5 | Vercel | (deferred) | Not required for `/mission-run` to complete — deploy is a post-mission step per tech-decisions.md | Nothing now. When you're ready to deploy, Vercel account + `vercel` CLI login (browser-based) | DEFERRED |
