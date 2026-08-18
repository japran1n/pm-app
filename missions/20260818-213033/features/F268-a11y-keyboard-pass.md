# F268: keyboard and accessible-name audit

**Milestone:** M18 — Final QA
**Estimated worker time:** 45 minutes
**Depends on:** F267

## Assertion IDs covered
- AS-523: every new interactive control is keyboard-operable
- AS-524: every new icon-only control has an accessible name

## Draft scope
- Walk every surface added by this mission with the keyboard only: palette, shortcuts, editor, checklist drag, swimlanes, calendar, timeline, lightbox, dropzone, inline cells, notification panel.
- Fix missing labels, focus traps, unreachable controls, and lost focus on close.
- Record the walked list and the fixes in the handoff.

## Files (approximate)
components/**/* (audit-driven)

## Notes for clarification
- Mission 1 ran the same pass for its surfaces (F085/F086); reuse its checklist so standards do not drift.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: audit). Full rationale: `missions/20260818-213033/clarifications/F268-clarification.md`._

- read every file in the feature's Files scope, compare against the assigned assertions, fix in place, and list what was checked in the handoff.
- Validation: an automated test per assertion where feasible, plus a written enumeration of what was inspected for structural/negative assertions.
- Access control: only where an assigned assertion is about access; policy changes come with an RLS integration test.
- Failure handling: fix it inside this feature's file scope and record it in the handoff's Decisions Made; gaps outside scope go to Out-of-scope work needed.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Mission 1 ran the same pass for its surfaces (F085/F086); reuse its checklist so standards do not drift.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-523, AS-524) has a named test or a written verification note.
