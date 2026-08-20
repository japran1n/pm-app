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

## Browser extension (QA feedback capture)

`extension/` is a separate Manifest V3 Chrome extension ("PM-App QA
Feedback") that lets a signed-in teammate capture a screenshot, a picked
page element, and/or recent console/network activity from any page and file
it as a pm-app task without leaving that page.

### Building it

From the repo root:

```bash
npm run build:extension
```

This runs `extension`'s own build chain (`cd extension && npm run build`,
i.e. sync the version from `extension/package.json` into `manifest.json` →
`vite build` → the no-secret-key guard → zip). It produces:

- `extension/dist/` — the unpacked build, used for local testing.
- `extension/dist.zip` — the store-ready zip artifact, used for Chrome Web
  Store submission.

The build fails (non-zero exit) if a Supabase secret key ever ends up in
the built bundle — see `extension/scripts/check-no-secret-key.mjs`.

### Loading it unpacked for testing

1. Run `npm run build:extension` from the repo root (or `npm run build`
   inside `extension/`) at least once.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked**.
5. Select the `extension/dist` folder (not `extension/` itself — that's the
   source, not the build output).
6. The extension's toolbar icon appears immediately; re-run the build and
   click the refresh icon on the extension's card in `chrome://extensions`
   to pick up changes (no reload of open tabs needed for popup-only
   changes; a full extension reload is needed after a background/content
   script change).

### Publishing it (human-only steps)

The orchestrator/AI running this project **cannot** register a Chrome Web
Store developer account or pay any associated fee — this requires a human
with a Google account and a payment method. What a human needs to do, in
order:

1. **One-time developer registration** at the Chrome Web Store Developer
   Dashboard (`chrome.google.com/webstore/devconsole`), which requires a
   one-time registration fee (documented as US$5 as of this project's
   `tech-decisions.md`, 2026-08-19; re-verified against
   `developer.chrome.com/docs/webstore/register`, 2026-08-21 — that page
   still describes a one-time registration fee with no amount change
   surfaced; confirm the exact current figure on the dashboard itself
   before paying, since Google can change it without notice).
2. **Upload** `extension/dist.zip` (produced by `npm run build:extension`
   above) to a new item in the dashboard.
3. **Fill in the listing** using `extension/store-listing.md` — it has the
   description, category, icon references, privacy-disclosure text (reused
   verbatim from `extension/PERMISSIONS.md`), and a screenshot placeholder
   note (this project cannot generate real product screenshots; the human
   publisher should take 1-3 before submitting).
4. **Choose visibility: Unlisted**, not Public, as the first step —
   installable only via direct link, not searchable, appropriate for this
   extension's actual audience (this project's own QA team) rather than the
   general public. See `extension/store-listing.md`'s "Distribution /
   visibility" section for the reasoning.
5. **Submit for review.** Review timing has historically run from a few
   days up to a few weeks; `tech-decisions.md` (2026-08-19) additionally
   noted reviews were running slow as of April 2026. Re-verify current
   timing on the dashboard's own status messaging at submission time, since
   this fluctuates and is not something this README can keep current.

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
