# Handoff: F100 — project name check constraint

## Status
COMPLETE

## Assertions covered
AS-026: PASS — `projects_name_not_empty` CHECK (`btrim(name) <> ''`) added via migration `20260818013108_project_name_not_blank_constraint.sql`, applied to the remote DB with `supabase db push`. New integration tests insert directly via the admin/service-role client (bypassing Zod and the Server Action) with `name: ""` and `name: "   "` and assert Postgres rejects both.

## Files changed
supabase/migrations/20260818013108_project_name_not_blank_constraint.sql
tests/integration/create-project.test.ts

## Commands run
`supabase migration new project_name_not_blank_constraint` (0)
`supabase db push` (0)
`npx vitest run tests/integration/create-project.test.ts` (0) — 8/8 passed
`npx tsc --noEmit` (0)
`npm run lint` (0)
`npm test` (0) — 29 files, 153 tests passed
`npm run build` (0)

## Decisions made
- Added the CHECK constraint in a brand-new migration rather than editing `20260818004413_create_projects.sql`, since applied migrations are immutable (per the feature spec's explicit instruction).
- Used `btrim(name) <> ''` (matches the exact form suggested in both the feature spec and M3-scrutiny's recommended follow-up), rejecting both empty-string and whitespace-only names in one constraint.
- Put the two new DB-level tests in the existing `tests/integration/create-project.test.ts` file (same file M3-scrutiny pointed at, alongside the existing AS-035 direct-insert bypass test it patterns off of) rather than a new file, to keep the workspace/project test fixtures shared instead of duplicating `beforeAll` setup.
- Left the original migration's inaccurate comment untouched (immutable) and instead documented the correction in the new migration's header comment, as directed by the spec.

## Out-of-scope work needed
None identified beyond this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
(none — spec was unambiguous)

## Notes for the next worker
- The remote Supabase project already had `supabase link` configured from a prior session; `supabase db push` worked without any additional setup.
- `npm test` currently runs everything under `tests/unit` per its script guard, not `tests/integration`; the 8 create-project tests (including the 2 new ones) were verified directly with `npx vitest run tests/integration/create-project.test.ts` and also passed as part of the full `npm test` / `npm run build` run.
