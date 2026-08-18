# F246: task deep-link route

**Milestone:** M17 — UX polish
**Estimated worker time:** 45 minutes
**Depends on:** F146

## Assertion IDs covered
- AS-473: every task has its own URL
- AS-474: that URL renders the task in a fresh tab
- AS-477: an inaccessible task URL returns not-found rather than revealing existence

## Draft scope
- Route `/w/[workspaceSlug]/projects/[projectId]/tasks/[taskKey]` (or a workspace-level `/t/[taskKey]`) resolving by key, server-rendered with the full task detail.
- Access failures return `notFound()`, never a distinguishable "forbidden".
- Canonical URL surfaced by a copy-link control in the task header.

## Files (approximate)
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/tasks/[taskKey]/page.tsx (new), lib/queries/tasks.ts, components/task/task-detail-sheet.tsx

## Notes for clarification
- Pick one canonical URL shape now: notifications, emails, and the palette all link to it.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F246-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Pick one canonical URL shape now: notifications, emails, and the palette all link to it.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-473, AS-474, AS-477) has a named test or a written verification note.
