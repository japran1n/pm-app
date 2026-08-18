# F118: install v2 dependencies

**Milestone:** M10 — Foundation v2 & identity primitives
**Estimated worker time:** 30 minutes
**Depends on:** none

## Assertion IDs covered
- none (foundation)

## Draft scope
- Install Tiptap 3.x (`@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-mention`, `@tiptap/extension-link`, `@tiptap/extension-task-list`, `@tiptap/extension-task-item`).
- `resend` ^6.20 and `@react-email/components` ^1.0 were already installed by the orchestrator during the connect phase — verify, do not reinstall.
- `cmdk` arrives via `npx shadcn@latest add command` in F119, not a direct install.
- `RESEND_API_KEY` / `RESEND_FROM_EMAIL` are already written to `.env` by the connect phase; ensure `.env.example` lists both key names with empty values.
- Verify `npm run build`, `npx tsc --noEmit`, and `npx eslint .` are still clean after the install.

## Files (approximate)
package.json, package-lock.json, .env.example

## Notes for clarification
- Versions must be re-verified at install time, not copied from tech-decisions verbatim.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F118-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Versions must be re-verified at install time, not copied from tech-decisions verbatim.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
