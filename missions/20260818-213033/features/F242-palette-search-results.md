# F242: palette search results

**Milestone:** M17 — UX polish
**Estimated worker time:** 45 minutes
**Depends on:** F241, F147

## Assertion IDs covered
- AS-460: searches projects, tasks, and members, grouped by type
- AS-461: selecting a result navigates to it
- AS-466: an empty result set shows an explicit no-results state

## Draft scope
- Debounced server search reusing the existing FTS query plus the F147 key resolver, returning grouped results with a small per-group cap.
- Rows show a type icon, title, task key, and project context.
- In-flight state is visible without the list jumping around.

## Files (approximate)
components/command/command-palette.tsx, lib/queries/search.ts, lib/actions/palette-search.ts (new)

## Notes for clarification
- Results must obey project visibility — the palette is a new read surface and needs the same RLS scrutiny as search.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F242-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Results must obey project visibility — the palette is a new read surface and needs the same RLS scrutiny as search.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-460, AS-461, AS-466) has a named test or a written verification note.
