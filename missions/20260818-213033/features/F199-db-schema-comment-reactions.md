# F199: comment_reactions table + RLS

**Milestone:** M15 — Collaboration: activity, comments, mentions, notifications, email
**Estimated worker time:** 30 minutes
**Depends on:** F132

## Assertion IDs covered
- AS-365: a user can add an emoji reaction
- AS-368: one reaction per emoji per comment per user
- AS-370: reactions are removed with their comment

## Draft scope
- Migration: `comment_reactions` (comment_id, user_id, emoji text, created_at; PK on all three) with `on delete cascade` from comments, project-visibility RLS, and insert/delete limited to the caller's own rows.
- Add the table to the realtime publication for F202.
- Restrict emoji to a small allow-list so the column cannot become arbitrary text.

## Files (approximate)
supabase/migrations/ (new), lib/supabase/database.types.ts

## Notes for clarification
- Soft-deleted comments keep their reaction rows until purge; only the display disappears. Confirm against AS-370's wording.
- MCP at run: Supabase MCP.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: db). Full rationale: `missions/20260818-213033/clarifications/F199-clarification.md`._

- a new timestamped SQL migration under supabase/migrations/, applied with `supabase db push` — additive, never destructive in the same feature that adds the readers.
- Validation: in the database (CHECK, UNIQUE, FK, trigger) AND mirrored in a Zod schema for the action layer — the DB is the last line, not the only line.
- Access control: RLS joined through workspace_members (and project_members where the spec says project-scoped), using the shared SQL helper rather than a copy-pasted predicate.
- Failure handling: the constraint rejects it and the calling Server Action maps it to a specific field-level message via its discriminated-union result.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Soft-deleted comments keep their reaction rows until purge; only the display disappears. Confirm against AS-370's wording.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-365, AS-368, AS-370) has a named test or a written verification note.
