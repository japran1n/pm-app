# F260: image thumbnails and lightbox

**Milestone:** M17 — UX polish
**Estimated worker time:** 45 minutes
**Depends on:** F258

## Assertion IDs covered
- AS-505: image attachments show a thumbnail instead of a generic icon
- AS-506: clicking one opens a full-size preview closable with Escape

## Draft scope
- Detect image MIME types and render a thumbnail from the signed URL, with a non-image fallback icon.
- Lightbox dialog with next/previous across the task's images, Escape to close, focus restored on close.
- Signed URL expiry handled by refreshing on open rather than caching a stale link.

## Files (approximate)
components/task/attachment-list.tsx, components/task/image-lightbox.tsx (new), lib/actions/attachments.ts

## Notes for clarification
- Thumbnails from full-size images are heavy; decide whether to add a size-constrained transform or accept it for v2.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F260-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Thumbnails from full-size images are heavy; decide whether to add a size-constrained transform or accept it for v2.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-505, AS-506) has a named test or a written verification note.
