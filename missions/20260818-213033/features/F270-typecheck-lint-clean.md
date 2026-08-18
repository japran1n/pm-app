# F270: type-check and lint clean

**Milestone:** M18 — Final QA
**Estimated worker time:** 30 minutes
**Depends on:** F269

## Assertion IDs covered
- AS-527: no type errors and no new `any` used to bypass one
- AS-528: no lint errors

## Draft scope
- `npx tsc --noEmit` and `npx eslint .` clean across the repo.
- Remove the deprecated columns' dead code paths left behind by the migrations (`tasks.status`, `tasks.assignee_id`, `tasks.description`) once nothing reads them, and drop the columns in a final migration.
- Regenerate `lib/supabase/database.types.ts` so types match the final schema.

## Files (approximate)
supabase/migrations/ (drop columns), lib/supabase/database.types.ts, repo-wide

## Notes for clarification
- The drop migration must be last and must be preceded by a grep proving no reader remains.
- MCP at run: Supabase MCP.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: audit). Full rationale: `missions/20260818-213033/clarifications/F270-clarification.md`._

- read every file in the feature's Files scope, compare against the assigned assertions, fix in place, and list what was checked in the handoff.
- Validation: an automated test per assertion where feasible, plus a written enumeration of what was inspected for structural/negative assertions.
- Access control: only where an assigned assertion is about access; policy changes come with an RLS integration test.
- Failure handling: fix it inside this feature's file scope and record it in the handoff's Decisions Made; gaps outside scope go to Out-of-scope work needed.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - The drop migration must be last and must be preceded by a grep proving no reader remains.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-527, AS-528) has a named test or a written verification note.
