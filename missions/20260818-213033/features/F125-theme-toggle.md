# F125: light / dark / system theme toggle

**Milestone:** M10 — Foundation v2 & identity primitives
**Estimated worker time:** 30 minutes
**Depends on:** F119

## Assertion IDs covered
- AS-211: a visible toggle offers light, dark, and system
- AS-212: the choice persists across reload and new tabs
- AS-213: no flash of the wrong theme on first paint

## Draft scope
- Wire the already-installed `next-themes` provider into `app/layout.tsx` with `suppressHydrationWarning` and a blocking inline script so first paint matches the stored choice.
- Toggle control in the sidebar footer next to sign-out, keyboard-operable, with an accessible name.
- Audit `app/globals.css` dark tokens against the surfaces added by this mission.

## Files (approximate)
app/layout.tsx, components/theme-provider.tsx (new), components/theme-toggle.tsx (new), components/nav/app-sidebar.tsx

## Notes for clarification
- The palette also needs to satisfy AS-526 later; fix contrast here rather than deferring to M18.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: action). Full rationale: `missions/20260818-213033/clarifications/F125-clarification.md`._

- a Server Action in lib/actions/<domain>.ts returning `{ok:true,data} | {ok:false,error}`, never throwing across the boundary.
- Validation: Zod at the action boundary, permission predicate from lib/auth/permissions.ts immediately after, then the database constraints as the final gate.
- Access control: re-verified server-side against the caller's membership and role via lib/auth/permissions.ts, even though RLS also enforces it.
- Failure handling: expected failures map to specific user-facing messages; unexpected ones are logged and returned as a generic message, never a raw database error.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - The palette also needs to satisfy AS-526 later; fix contrast here rather than deferring to M18.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-211, AS-212, AS-213) has a named test or a written verification note.
