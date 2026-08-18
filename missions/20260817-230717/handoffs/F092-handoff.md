# Handoff: F092 — readme docs

## Status
COMPLETE

## Assertions covered
AS-159: PASS — README.md documents how to run the app locally (`npm install` + `npm run dev`), how to run tests (`npm run test && npx playwright test`), and every environment variable in `.env.example` in a table with description + where to obtain it. All commands were actually executed during this task, not just copied.

## Files changed
README.md

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0, 1 warning, 0 errors — pre-existing unused var in lib/queries/search.ts, unrelated to this feature)
`npm run test` (0 — 83 files / 436 tests passed)
`npx playwright test` (0 — 1 passed)
`npm run build` (0 — production build succeeds)

## Decisions made
- Replaced the Exexutor mission-scaffold README (about the orchestration system itself) with documentation for the actual pm-app product, per the task instructions — the scaffold content was no longer relevant to someone using this app.
- Node version documented as "20+ (tested against Node 26)" since no `engines` field exists in package.json and tech-decisions.md doesn't pin a version; verified the currently installed Node (v26.1.0) works.
- Environment variable table follows `.env.example`'s exact order and section comments (Supabase public, Supabase server-only, Sentry) and pulls descriptions directly from that file's inline comments.
- Known Limitations section pulled directly from description.md's stated v1 scope: no Timeline/Gantt, single-assignee, English-only, no multi-tenant billing, no periodic fractional-position rebalance (explicitly called out in tech-decisions.md's Position/ordering convention).
- Setup steps include `supabase link` and `supabase db push` (CLI confirmed installed locally, v2.114.0) as the "apply migrations" step, since that's the standard Supabase CLI workflow and migrations already exist under `supabase/migrations/`.

## Out-of-scope work needed
- lib/queries/search.ts:159 has an unused `_titleMatches` variable producing an ESLint warning (not an error, doesn't block AS-158 which only requires zero errors). Could be cleaned up in a future polish pass but is out of scope for this docs-only feature.

## Blockers
(none — status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Documented Node "20+" as the prerequisite rather than pinning an exact version, since neither package.json nor tech-decisions.md specifies one and the spec only asked for "prerequisites (Node version, Supabase account)" — chose a permissive LTS floor consistent with `@types/node: ^20` in package.json rather than over-specifying.

## Notes for the next worker
- All four verification commands (tsc, eslint, test, playwright) were run live against the real linked Supabase project (`.env` already populated) and all passed — the README's documented commands are confirmed accurate as of this commit.
- Playwright's e2e suite boots a real `next dev` server on port 3100 against the live Supabase project; it takes ~10-15s including server boot.
