# Handoff: F095 — Fix server-only import leaking into client bundle

## Status
COMPLETE

## Assertions covered
This is a build-gate/infrastructure fix, not a behavioural feature; no assertion IDs from the validation contract were assigned in the feature spec. The spec's own gate is: `npx next build` MUST succeed.

## Files changed
lib/calendar/date-utils.ts (new)
lib/queries/time-off.ts
components/calendar/stacked-person-row.tsx
components/calendar/week-view.tsx
tests/unit/time-off-date-range.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx next build` (0)
`npx eslint . --max-warnings=0` (0)
`npx vitest run tests/unit/time-off-date-range.test.ts tests/unit/f034-time-off-strip.test.tsx tests/unit/f016-calendar-page-no-task-query.test.ts tests/unit/f015-remove-task-strips.test.tsx` (0, 18/18 passed)
`npx vitest run tests/unit` (full suite has 41 pre-existing failing files unrelated to this change — see Notes)

## Decisions made
- Moved `eachDateInRange` verbatim (no logic change) from `lib/queries/time-off.ts` into a new pure module `lib/calendar/date-utils.ts`, per the spec's Step 1. No Supabase or `next/headers` import exists in the new file.
- Updated both consumers (`components/calendar/stacked-person-row.tsx`, a Client Component, and `components/calendar/week-view.tsx`) to import `eachDateInRange` directly from `@/lib/calendar/date-utils` instead of re-exporting through `lib/queries/time-off.ts`.
- Added `import "server-only";` at the top of `lib/queries/time-off.ts` per the spec's optional-but-recommended Step 3, so any future accidental client import of that module fails the build immediately and loudly instead of silently ballooning the client bundle.
- Updated `tests/unit/time-off-date-range.test.ts` to import `eachDateInRange` from its new location so the existing unit tests keep exercising the same pure function without depending on the server-only module.

## Out-of-scope work needed
None identified within this feature's scope. Note: this session ran concurrently with other workers (F096, F097, F099) actively committing to shared files (`lib/queries/calendar-blocks.ts`, `tests/unit/f031-page-layout-derivation.test.tsx`, `tests/integration/calendar-blocks-crud.test.ts`). Several times mid-session the working tree was reset by those other processes, which momentarily reverted this feature's uncommitted edits and caused transient `tsc`/`next build` failures unrelated to F095's own change. Those transient states cleared once the other workers finished and committed; by the time this feature's own commit was made, `npx tsc --noEmit`, `npx next build`, and `npx eslint` all passed clean. No code from other in-flight features was touched or modified here.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: No re-export/backward-compat shim was left in `lib/queries/time-off.ts` for `eachDateInRange` — the spec explicitly said "or remove it if it's only re-exported," and since only two files imported it and both were updated to the new path directly, a shim would have been dead code.

## Notes for the next worker
- Root cause: `stacked-person-row.tsx` (Client Component) did a *value* import of `eachDateInRange` from `lib/queries/time-off.ts`, and that module value-imports `createClient` from `@/lib/supabase/server`, which imports `cookies` from `next/headers` — a Server Component/Route Handler-only API. Any future new pure calendar/date helper added to `lib/queries/*.ts` files should be considered for placement in `lib/calendar/*.ts` (pure, no Supabase/next/headers) from the start if a Client Component might need it, to avoid repeating this bug.
- The concurrent-worker file churn observed here (git status showing/losing modifications to `lib/queries/calendar-blocks.ts` and test files not touched by this feature) suggests the orchestrator's run loop may be spawning workers with overlapping working-tree windows rather than fully serial execution with clean commits between them. Worth checking `/mission-run`'s scheduling if this recurs and causes an actual lost-work incident rather than a self-recovered transient.
