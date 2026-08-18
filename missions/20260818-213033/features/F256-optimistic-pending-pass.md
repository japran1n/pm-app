# F256: consistent optimistic and pending behaviour

**Milestone:** M17 — UX polish
**Estimated worker time:** 45 minutes
**Depends on:** F255

## Assertion IDs covered
- AS-497: every mutation shows an optimistic result or a pending state within 100ms
- AS-498: a failed mutation rolls back and explains what failed
- AS-499: the triggering control shows pending state and cannot be double-submitted

## Draft scope
- Audit every mutating control in the app against one documented pattern (`useOptimistic` / `useActionState` + disabled-while-pending + toast on failure).
- Extract the repeated bits into a small shared hook so new controls inherit the behaviour.
- Convert the stragglers found in the audit.

## Files (approximate)
lib/hooks/use-action-state.ts (new), components/**/* (audit-driven), docs in CLAUDE.md conventions

## Notes for clarification
- List the audited controls in the handoff so the validator can check the sweep was real and not spot-fixed.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: audit). Full rationale: `missions/20260818-213033/clarifications/F256-clarification.md`._

- read every file in the feature's Files scope, compare against the assigned assertions, fix in place, and list what was checked in the handoff.
- Validation: an automated test per assertion where feasible, plus a written enumeration of what was inspected for structural/negative assertions.
- Access control: only where an assigned assertion is about access; policy changes come with an RLS integration test.
- Failure handling: fix it inside this feature's file scope and record it in the handoff's Decisions Made; gaps outside scope go to Out-of-scope work needed.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - List the audited controls in the handoff so the validator can check the sweep was real and not spot-fixed.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-497, AS-498, AS-499) has a named test or a written verification note.
