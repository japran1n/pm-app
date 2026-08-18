# F122: avatar component with deterministic colour

**Milestone:** M10 — Foundation v2 & identity primitives
**Estimated worker time:** 30 minutes
**Depends on:** F121

## Assertion IDs covered
- AS-204: initials avatar uses a colour derived deterministically from the user id
- AS-214: avatars appear on task cards, members list, comments, and assignee pickers

## Draft scope
- `components/user-avatar.tsx`: image when `avatar_url` exists, otherwise initials on a colour picked by hashing the user id against a fixed palette (WCAG-AA text contrast in both themes).
- `lib/user-color.ts`: pure hash → palette index function, unit-tested.
- Replace every current name/email rendering of a person with this component: task card, task detail, comments, members list, assignee select, dashboard table.

## Files (approximate)
components/user-avatar.tsx (new), lib/user-color.ts (new), components/task/*, components/dashboard/*, app/(workspace)/w/[workspaceSlug]/settings/members/page.tsx

## Notes for clarification
- The palette must be shared with swimlane/grouping colours later (F224) — keep it in one module.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F122-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - The palette must be shared with swimlane/grouping colours later (F224) — keep it in one module.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-204, AS-214) has a named test or a written verification note.
