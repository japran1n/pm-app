# F141: audit log viewer

**Milestone:** M12 — Workspace admin, audit log & archive
**Estimated worker time:** 45 minutes
**Depends on:** F140

## Assertion IDs covered
- AS-246: readable by owners and admins only
- AS-248: filterable by actor and action type

## Draft scope
- `/w/[workspaceSlug]/settings/audit`: reverse-chronological table with actor avatar, human-readable action sentence, target link, timestamp.
- Filters for actor and action type via URL search params, matching the existing list-view filter conventions.
- Load a bounded window (e.g. most recent 100) with a load-more control.

## Files (approximate)
app/(workspace)/w/[workspaceSlug]/settings/audit/page.tsx (new), components/audit/audit-table.tsx (new), lib/queries/audit.ts (new)

## Notes for clarification
- Action strings must render as sentences, not raw keys — keep the mapping in one place.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: audit). Full rationale: `missions/20260818-213033/clarifications/F141-clarification.md`._

- read every file in the feature's Files scope, compare against the assigned assertions, fix in place, and list what was checked in the handoff.
- Validation: an automated test per assertion where feasible, plus a written enumeration of what was inspected for structural/negative assertions.
- Access control: only where an assigned assertion is about access; policy changes come with an RLS integration test.
- Failure handling: fix it inside this feature's file scope and record it in the handoff's Decisions Made; gaps outside scope go to Out-of-scope work needed.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Action strings must render as sentences, not raw keys — keep the mapping in one place.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-246, AS-248) has a named test or a written verification note.
