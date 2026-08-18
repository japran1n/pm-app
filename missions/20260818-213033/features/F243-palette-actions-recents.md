# F243: palette actions and recents

**Milestone:** M17 — UX polish
**Estimated worker time:** 30 minutes
**Depends on:** F242

## Assertion IDs covered
- AS-462: actions such as create task, create project, toggle theme
- AS-465: recent items appear when the query is empty

## Draft scope
- Action registry mapping labels to handlers, filtered by the caller's permissions (F127) so a viewer never sees "Create task".
- Recents tracked client-side per workspace (last visited tasks and projects), shown as the default list.
- Actions carry their keyboard shortcut hint where one exists (F244).

## Files (approximate)
components/command/actions.ts (new), components/command/command-palette.tsx, lib/hooks/use-recent-items.ts (new)

## Notes for clarification
- Recents in localStorage is acceptable; note it so nobody expects cross-device sync.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: action). Full rationale: `missions/20260818-213033/clarifications/F243-clarification.md`._

- a Server Action in lib/actions/<domain>.ts returning `{ok:true,data} | {ok:false,error}`, never throwing across the boundary.
- Validation: Zod at the action boundary, permission predicate from lib/auth/permissions.ts immediately after, then the database constraints as the final gate.
- Access control: re-verified server-side against the caller's membership and role via lib/auth/permissions.ts, even though RLS also enforces it.
- Failure handling: expected failures map to specific user-facing messages; unexpected ones are logged and returned as a generic message, never a raw database error.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Recents in localStorage is acceptable; note it so nobody expects cross-device sync.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-462, AS-465) has a named test or a written verification note.
