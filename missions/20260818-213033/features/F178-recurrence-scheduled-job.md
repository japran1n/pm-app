# F178: scheduled occurrence generation

**Milestone:** M14 — Rich text, recurrence, templates, bulk actions & trash
**Estimated worker time:** 45 minutes
**Depends on:** F177

## Assertion IDs covered
- AS-322: due occurrences are generated without anyone opening the app

## Draft scope
- Enable `pg_cron`; schedule a job calling a security-definer SQL function that generates occurrences whose next date has arrived for date-driven rules.
- The function shares the F176 date logic (implemented in SQL, verified against the TypeScript unit tests' cases).
- Job registration lives in a migration so it is reproducible on a fresh project, not clicked into the dashboard.

## Files (approximate)
supabase/migrations/ (extension + function + cron.schedule)

## Notes for clarification
- pg_cron is enabled by default on Supabase; still enable it explicitly in the migration so a fresh project reproduces. <!-- https://supabase.com/docs/guides/cron -->
- MCP at run: Supabase MCP.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: logic). Full rationale: `missions/20260818-213033/clarifications/F178-clarification.md`._

- a pure, side-effect-free module under lib/ with an explicit exported API, unit-tested independently of React and Supabase.
- Validation: unit tests per assertion, including the boundary cases the feature spec names (DST, month-end, concurrency, actor exclusion, overflow).
- Access control: no — it is pure; permission checks stay in the action layer that calls it, so both cannot drift.
- Failure handling: invalid input returns a typed error or null rather than throwing, and the caller decides how to surface it.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - pg_cron is enabled by default on Supabase; still enable it explicitly in the migration so a fresh project reproduces. <!-- https://supabase.com/docs/guides/cron -->

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-322) has a named test or a written verification note.
