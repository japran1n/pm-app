# F258: drag-and-drop file upload

**Milestone:** M17 — UX polish
**Estimated worker time:** 45 minutes
**Depends on:** F135

## Assertion IDs covered
- AS-501: dropping a file on the task detail attaches it
- AS-502: the drop target is highlighted while dragging over it
- AS-503: multiple dropped files all upload

## Draft scope
- Dropzone wrapping the task detail sheet, using native drag events (not `@dnd-kit`, which is for sortables), with a window-level guard so a stray drop elsewhere does not navigate away.
- Files funnel into the existing upload action; the picker button stays for keyboard users.
- Concurrency cap so ten files do not open ten parallel uploads.

## Files (approximate)
components/task/attachment-dropzone.tsx (new), components/task/attachment-list.tsx, lib/actions/attachments.ts

## Notes for clarification
- Keyboard users must retain a non-drag path — drag-only would fail AS-523.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F258-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Keyboard users must retain a non-drag path — drag-only would fail AS-523.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-501, AS-502, AS-503) has a named test or a written verification note.
