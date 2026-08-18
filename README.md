# pm-app

A collaborative project management tool (Jira/Linear-style), built with
Next.js and Supabase. Organizations/workspaces contain projects; projects
contain tasks with status, priority, single assignee, due date, comments,
and attachments. Includes a drag-and-drop Kanban board, a list/table view,
full-text search, and a home dashboard with charts (tasks by status/priority).

## Prerequisites

- Node.js 20+ (repo developed and tested against Node 26; anything 20 LTS or
  newer should work)
- npm (ships with Node)
- A [Supabase](https://supabase.com) account and project (Postgres + Auth +
  Storage)
- [Supabase CLI](https://supabase.com/docs/guides/cli) (`brew install
  supabase/tap/supabase` or see docs) for linking the project and applying
  migrations

## Setup

```
git clone <repo-url>
cd pm-app
npm install
supabase link --project-ref <your-project-ref>
supabase db push
cp .env.example .env
```

Then fill in `.env` with the values described below.

## How to run the app

```
npm install
npm run dev
```

## How to run tests

```
npm run test && npx playwright test
```

`npm run test` runs the Vitest unit/integration suite. `npx playwright test`
runs the end-to-end suite; it boots a real `next dev` server against the
Supabase project configured in `.env`, so `.env` must be filled in first.

## How to run linter

```
npx eslint .
```

## How to run type-check

```
npx tsc --noEmit
```

## Environment variables

All variables live in `.env` (gitignored); `.env.example` lists the required
keys with empty values.

| Variable | Description | Where to get it |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public URL of your Supabase project (safe to expose to the browser) | Supabase dashboard → Project Settings → Data API |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public/publishable API key (safe to expose to the browser) | Supabase dashboard → Project Settings → API Keys |
| `SUPABASE_SECRET_KEY` | Server-only secret key — never expose to the browser or commit a real value | Supabase dashboard → Project Settings → API Keys |
| `SUPABASE_PROJECT_REF` | Project reference ID, used by the Supabase CLI (`supabase link`) and server-side tooling | Supabase dashboard → Project Settings → General, or the URL of your project dashboard |
| `SENTRY_DSN` | Data Source Name Sentry uses to receive error reports; optional at local-dev time, required before a Vercel deploy | Sentry dashboard → Project Settings → Client Keys (DSN) |
| `SENTRY_AUTH_TOKEN` | Auth token Sentry's build tooling uses to upload source maps; optional at local-dev time, required before a Vercel deploy | Sentry dashboard → Settings → Auth Tokens |

## Known limitations (v1)

- No Timeline/Gantt view — out of scope for v1, deferred from the reference
  app's feature set as low MVP value.
- Single assignee per task only — no multi-assignee support.
- English-only UI, no i18n/localization.
- No multi-tenant billing or plan tiers.
- No periodic rebalance of Kanban card fractional positions — a very long
  column could theoretically exhaust position precision over time; documented
  as a known limitation rather than silently unhandled.
- This is a solo-built MVP, not a hardened multi-team/enterprise system.
