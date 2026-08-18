# F123: profile settings page

**Milestone:** M10 — Foundation v2 & identity primitives
**Estimated worker time:** 45 minutes
**Depends on:** F121, F122

## Assertion IDs covered
- AS-202: display name replaces the email everywhere a person is rendered

## Draft scope
- `/w/[workspaceSlug]/settings/profile`: display name, avatar upload with live preview, timezone select, theme preference link.
- Server Action updating the caller's own profile only, Zod-validated, discriminated-union result, toast on success/failure.
- Name resolution helper: display_name → email local part → email, used everywhere a person is labelled (replaces `lib/queries/assignee-names.ts` usage).

## Files (approximate)
app/(workspace)/w/[workspaceSlug]/settings/profile/page.tsx (new), components/profile/profile-form.tsx (new), lib/actions/profile.ts, lib/queries/assignee-names.ts

## Notes for clarification
- Timezone list source: `Intl.supportedValuesOf('timeZone')` rather than a hard-coded list.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: ui). Full rationale: `missions/20260818-213033/clarifications/F123-clarification.md`._

- Server Component for data loading, Client Component only for interaction, shadcn/ui primitives already in components/ui, Tailwind v4 tokens — no new design system.
- Validation: client-side for immediate feedback, re-validated by the action's Zod schema server-side; the client check never stands alone.
- Access control: controls are hidden or disabled through lib/auth/permissions.ts, with a tooltip where absence would confuse; the server still rejects the call.
- Failure handling: the optimistic change reverts and a sonner toast states what failed in plain language; the control returns to an actionable state.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Timezone list source: `Intl.supportedValuesOf('timeZone')` rather than a hard-coded list.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-202) has a named test or a written verification note.
