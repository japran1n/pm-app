# Connection Manifest

_Generated: 2026-08-17T22:00:00Z_

| # | Service | Type | What I'll set up | What I need from you | Status |
|---|---------|------|------------------|----------------------|--------|
| 1 | Supabase | mcp + database | Registered MCP (project-scoped, project_ref-locked); CLI linked to qcipqonnqajmazdbysow; .env written and verified (publishable + secret key both current sb_ format, both reach the project) | Project URL, publishable key, secret key — all received | PASS — CLI linked (primary path for migrations: `supabase db push`); MCP tool access pending your in-session approval (bonus/optional, not blocking) |
| 2 | Playwright | mcp | Register Playwright MCP via `claude mcp add playwright npx @playwright/mcp@latest` | Nothing — fully automated | PASS |
| 3 | Sentry | api | SDK install happens in F001-adjacent setup; DSN wiring deferred | DSN — not required for /mission-run; app runs and all assertions are testable without it. Paste when you create a sentry.io project, or skip entirely for v1 | DEFERRED (not blocking) |
| 4 | GitHub | cli-tool | Local git repo already initialized (this repo); CI workflow file is written by F004 as local YAML — it only runs once pushed to a GitHub remote | Nothing now. A GitHub repo URL only if/when you want me to push and see CI run | PASS (local git only; remote push deferred) |
| 5 | Vercel | (deferred) | Not required for `/mission-run` to complete — deploy is a post-mission step per tech-decisions.md | Nothing now. When you're ready to deploy, Vercel account + `vercel` CLI login (browser-based) | DEFERRED |
