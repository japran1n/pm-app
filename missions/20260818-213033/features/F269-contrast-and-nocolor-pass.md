# F269: contrast and colour-independence audit

**Milestone:** M18 — Final QA
**Estimated worker time:** 45 minutes
**Depends on:** F268

## Assertion IDs covered
- AS-525: status, priority, and indicators carry an icon or text, not colour alone
- AS-526: new surfaces meet WCAG AA contrast in light and dark themes

## Draft scope
- Check every new indicator (blocked, recurring, over-estimate, subtask count, completion, swimlane headers, custom status chips, user colours) for a non-colour cue.
- Measure contrast for both themes, including the user-colour palette and the status colour palette offered in F219.
- Constrain palettes rather than fixing individual instances.

## Files (approximate)
app/globals.css, lib/user-color.ts, components/**/* (audit-driven)

## Notes for clarification
- Custom status colours are user-chosen — the picker must only offer AA-safe values, which is a design constraint, not a runtime check.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: audit). Full rationale: `missions/20260818-213033/clarifications/F269-clarification.md`._

- read every file in the feature's Files scope, compare against the assigned assertions, fix in place, and list what was checked in the handoff.
- Validation: an automated test per assertion where feasible, plus a written enumeration of what was inspected for structural/negative assertions.
- Access control: only where an assigned assertion is about access; policy changes come with an RLS integration test.
- Failure handling: fix it inside this feature's file scope and record it in the handoff's Decisions Made; gaps outside scope go to Out-of-scope work needed.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Custom status colours are user-chosen — the picker must only offer AA-safe values, which is a design constraint, not a runtime check.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-525, AS-526) has a named test or a written verification note.
