# F172: paste behaviour

**Milestone:** M14 — Rich text, recurrence, templates, bulk actions & trash
**Estimated worker time:** 30 minutes
**Depends on:** F171

## Assertion IDs covered
- AS-308: pasted formatting is preserved where supported and dropped where not

## Draft scope
- Configure Tiptap's paste rules so Word/Google Docs/HTML pastes map onto the allowed schema and unsupported markup degrades to plain text rather than being dropped silently.
- Plain-text paste with Cmd/Ctrl+Shift+V.
- Unit test over representative pasted HTML fragments.

## Files (approximate)
components/editor/rich-text-editor.tsx, lib/editor/paste-rules.ts (new)

## Notes for clarification
- "Degrade" must never mean "lose the text" — the words always survive even when the styling does not.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F172-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - "Degrade" must never mean "lose the text" — the words always survive even when the styling does not.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-308) has a named test or a written verification note.
