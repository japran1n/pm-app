# F261: paste an image into a comment

**Milestone:** M17 — UX polish
**Estimated worker time:** 30 minutes
**Depends on:** F260, F174

## Assertion IDs covered
- AS-508: an image pasted from the clipboard uploads as an attachment

## Draft scope
- Paste handler on the comment editor intercepting image clipboard items, uploading them through the attachment action, and inserting a reference into the comment body.
- Upload progress shown inline in the composer; failure leaves the typed text intact.
- Non-image clipboard content keeps the F172 paste behaviour.

## Files (approximate)
components/editor/rich-text-editor.tsx, lib/editor/paste-rules.ts, lib/actions/attachments.ts

## Notes for clarification
- Whether the image renders inline in the comment or only as an attachment row changes the schema in F171's allow-list — decide before implementing.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F261-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Whether the image renders inline in the comment or only as an attachment row changes the schema in F171's allow-list — decide before implementing.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-508) has a named test or a written verification note.
