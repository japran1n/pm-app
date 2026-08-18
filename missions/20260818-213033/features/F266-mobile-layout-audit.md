# F266: no accidental horizontal scroll

**Milestone:** M17 — UX polish
**Estimated worker time:** 30 minutes
**Depends on:** F265

## Assertion IDs covered
- AS-517: no primary view scrolls horizontally on a phone except deliberately scrollable containers

## Draft scope
- Sweep every view at 375px in the browser preview: dashboard, list, search, my tasks, calendar, timeline, trash, archive, settings, templates, notifications, audit.
- Wide content (tables, timeline, board) is confined to its own `overflow-x:auto` container rather than pushing the page.
- Fix what the sweep finds; report the list of fixes in the handoff.

## Files (approximate)
components/task/task-list-table.tsx, components/dashboard/*, app/(workspace)/w/[workspaceSlug]/**/page.tsx

## Notes for clarification
- This is a verification-driven feature: the evidence is screenshots at 375px, not a claim.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: audit). Full rationale: `missions/20260818-213033/clarifications/F266-clarification.md`._

- read every file in the feature's Files scope, compare against the assigned assertions, fix in place, and list what was checked in the handoff.
- Validation: an automated test per assertion where feasible, plus a written enumeration of what was inspected for structural/negative assertions.
- Access control: only where an assigned assertion is about access; policy changes come with an RLS integration test.
- Failure handling: fix it inside this feature's file scope and record it in the handoff's Decisions Made; gaps outside scope go to Out-of-scope work needed.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - This is a verification-driven feature: the evidence is screenshots at 375px, not a claim.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-517) has a named test or a written verification note.
