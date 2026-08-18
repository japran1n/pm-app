# F180: duplicate a task

**Milestone:** M14 — Rich text, recurrence, templates, bulk actions & trash
**Estimated worker time:** 30 minutes
**Depends on:** F176

## Assertion IDs covered
- AS-324: duplication produces a copy with a marked title
- AS-325: it copies description, priority, assignees, tags, checklist, estimate
- AS-326: it does not copy comments, attachments, logged time, or the key
- AS-327: it lands in the same project and status, positioned right after the original

## Draft scope
- Duplicate action reusing F176's `clone-fields` allow-list so copy rules exist in exactly one place.
- New task gets its own key/number from F145's atomic counter and a fractional position between the original and its successor.
- Menu entry on the card and in the detail sheet; integration test asserting the excluded fields are absent.

## Files (approximate)
lib/actions/tasks.ts, lib/recurrence/clone-fields.ts, components/task/task-card.tsx

## Notes for clarification
- Title marking convention ("Copy of X" vs "X (copy)") — pick one and use it for project duplication too.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: action). Full rationale: `missions/20260818-213033/clarifications/F180-clarification.md`._

- a Server Action in lib/actions/<domain>.ts returning `{ok:true,data} | {ok:false,error}`, never throwing across the boundary.
- Validation: Zod at the action boundary, permission predicate from lib/auth/permissions.ts immediately after, then the database constraints as the final gate.
- Access control: re-verified server-side against the caller's membership and role via lib/auth/permissions.ts, even though RLS also enforces it.
- Failure handling: expected failures map to specific user-facing messages; unexpected ones are logged and returned as a generic message, never a raw database error.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Title marking convention ("Copy of X" vs "X (copy)") — pick one and use it for project duplication too.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-324, AS-325, AS-326, AS-327) has a named test or a written verification note.
