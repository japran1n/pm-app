# F197: edit a comment

**Milestone:** M15 — Collaboration: activity, comments, mentions, notifications, email
**Estimated worker time:** 30 minutes
**Depends on:** F174

## Assertion IDs covered
- AS-362: an author can edit their own comment
- AS-364: a user cannot edit someone else's, including via direct API

## Draft scope
- Migration: `comments.edited_at timestamptz`.
- Update action checking authorship server-side and via RLS UPDATE policy (`author_id = auth.uid()`), writing the new rich-text body and `edited_at`.
- Inline edit mode in the comment list reusing the shared editor; Escape cancels, Cmd+Enter saves.

## Files (approximate)
supabase/migrations/ (new), lib/actions/comments.ts, components/task/comment-list.tsx

## Notes for clarification
- Admins deliberately cannot edit other people's words — only delete. Confirm that reading of AS-364.
- MCP at run: Supabase MCP.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: action). Full rationale: `missions/20260818-213033/clarifications/F197-clarification.md`._

- a Server Action in lib/actions/<domain>.ts returning `{ok:true,data} | {ok:false,error}`, never throwing across the boundary.
- Validation: Zod at the action boundary, permission predicate from lib/auth/permissions.ts immediately after, then the database constraints as the final gate.
- Access control: re-verified server-side against the caller's membership and role via lib/auth/permissions.ts, even though RLS also enforces it.
- Failure handling: expected failures map to specific user-facing messages; unexpected ones are logged and returned as a generic message, never a raw database error.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Admins deliberately cannot edit other people's words — only delete. Confirm that reading of AS-364.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-362, AS-364) has a named test or a written verification note.
