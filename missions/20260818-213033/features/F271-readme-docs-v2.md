# F271: documentation update

**Milestone:** M18 — Final QA
**Estimated worker time:** 45 minutes
**Depends on:** F270

## Assertion IDs covered
- AS-529: the README documents every new feature area, env var, and scheduled job

## Draft scope
- README: new feature sections, `RESEND_API_KEY` / `RESEND_FROM_EMAIL` setup, the three pg_cron jobs (recurrence, overdue sweep, digest) with their schedules, and the role/permission matrix.
- `.env.example` complete and accurate.
- A short "what changed since v1" section so an existing reader can orient quickly.

## Files (approximate)
README.md, .env.example, DOCS.md

## Notes for clarification
- The cron jobs are invisible infrastructure; undocumented, they become a mystery in six months.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: audit). Full rationale: `missions/20260818-213033/clarifications/F271-clarification.md`._

- read every file in the feature's Files scope, compare against the assigned assertions, fix in place, and list what was checked in the handoff.
- Validation: an automated test per assertion where feasible, plus a written enumeration of what was inspected for structural/negative assertions.
- Access control: only where an assigned assertion is about access; policy changes come with an RLS integration test.
- Failure handling: fix it inside this feature's file scope and record it in the handoff's Decisions Made; gaps outside scope go to Out-of-scope work needed.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - The cron jobs are invisible infrastructure; undocumented, they become a mystery in six months.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-529) has a named test or a written verification note.
