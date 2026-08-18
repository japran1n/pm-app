# F171: safe rendering of rich text

**Milestone:** M14 — Rich text, recurrence, templates, bulk actions & trash
**Estimated worker time:** 45 minutes
**Depends on:** F170

## Assertion IDs covered
- AS-307: formatting survives a reload
- AS-309: a pasted script tag never executes when rendered

## Draft scope
- Render stored JSON through Tiptap's read-only renderer with a strict allow-list of nodes and marks — never `dangerouslySetInnerHTML` on stored HTML.
- Link marks get `rel="noopener noreferrer"` and are restricted to http/https/mailto; `javascript:` URLs are stripped.
- Unit tests feeding hostile documents (script node, javascript: href, on* attribute) and asserting they render inert.

## Files (approximate)
components/editor/rich-text-renderer.tsx (new), lib/editor/schema.ts (new), tests/unit/editor-sanitise.test.ts (new)

## Notes for clarification
- The allow-list is the security boundary; it must be defined once and shared by editor, renderer, and any server-side projection.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F171-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - The allow-list is the security boundary; it must be defined once and shared by editor, renderer, and any server-side projection.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-307, AS-309) has a named test or a written verification note.
