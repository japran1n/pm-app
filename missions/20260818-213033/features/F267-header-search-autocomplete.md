# F267: header search with autocomplete

**Milestone:** M17 — UX polish
**Estimated worker time:** 45 minutes
**Depends on:** F242

## Assertion IDs covered
- AS-519: a search input is available in the header on every workspace page
- AS-520: typing shows matching tasks and projects in a dropdown without leaving the page
- AS-521: selecting a result navigates to it
- AS-522: Enter opens the full search page with the same query

## Draft scope
- Top bar containing search plus the notification bell (F208) and the user menu, added to the workspace layout.
- Search input shares the palette's query action (F242) so ranking and permissions stay identical.
- `/` focuses it (F244); Escape clears and closes the dropdown.

## Files (approximate)
components/nav/app-header.tsx (new), components/nav/header-search.tsx (new), app/(workspace)/w/[workspaceSlug]/layout.tsx

## Notes for clarification
- Two search entry points must not become two search implementations — one query module, two surfaces.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F267-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Two search entry points must not become two search implementations — one query module, two surfaces.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-519, AS-520, AS-521, AS-522) has a named test or a written verification note.
