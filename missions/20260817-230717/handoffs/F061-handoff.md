# Handoff: F061 — delete comment action

## Status
COMPLETE

## Assertions covered
AS-098: PASS — `deleteComment` (lib/actions/comments.ts) lets the comment's own author delete it; covered by tests/integration/delete-comment.test.ts "AS-098: the comment's own author can delete their own comment".
AS-099: PASS — a different regular member (not author, not admin/owner) is rejected server-side; covered by "AS-099: a different regular member (not author, not admin/owner) cannot delete someone else's comment". UI side: components/task/comment-list.tsx's `canDelete()` only renders the delete button when `currentUserId` matches the comment's author or `currentUserRole` is admin/owner.
AS-100: PASS — a workspace admin/owner can delete any comment in their workspace; covered by "AS-100: a workspace admin/owner can delete another member's comment".

## Files changed
lib/actions/comments.ts
lib/validation/comments.ts
components/task/comment-list.tsx
components/task/task-detail-sheet.tsx
supabase/migrations/20260818041550_rls_comments_delete_update.sql
tests/integration/delete-comment.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint lib/actions/comments.ts lib/validation/comments.ts components/task/comment-list.tsx components/task/task-detail-sheet.tsx` (0)
`npx vitest run tests/integration/delete-comment.test.ts` (0, 6 passed)
`npx vitest run` (0, 330 passed / 60 files)
`npm run build` (0)
`npm run lint` (0)
`supabase db push --linked` (0, applied 20260818041550_rls_comments_delete_update.sql)

## Decisions made
- **Soft-delete via UPDATE, mirroring deleteTask's pattern exactly**: sets `deleted_at = now()` through the admin client after this action's own author-or-admin check passes; never issues a real DELETE, consistent with the repo's soft-delete convention and the AS-104-era comment left in `20260818040214_create_comments.sql` explicitly deferring this policy to F061.
- **New RLS UPDATE policy** (`comments_update_author_or_admin`, migration `20260818041550_rls_comments_delete_update.sql`): a `can_modify_comment(comment_id)` SECURITY DEFINER function requires active membership in the comment's owning workspace AND (author OR admin/owner role). This is defense-in-depth per AS-143's convention — the Server Action's own check is the primary enforcement (it uses the admin client, which bypasses RLS), but a direct API call with a real session is still bound by the same rule.
- **Authorization branching**: author gets a plain `requireActiveMembership` check (so a removed member can't delete their old comments); non-author gets `requireWorkspaceAdmin`. Both call into the same shared `lib/auth/require-membership.ts` helpers already used by every other action in this file, per the clarified spec's "Auth" answer.
- **UI affordance (AS-099's "unavailable in the UI" half)**: chose to thread optional `currentUserId`/`currentUserRole` props from `TaskDetailSheet` down into `CommentList`, and hide the delete button (`canDelete()`) unless the viewer is the comment's author or an admin/owner. Documented as a UI-affordance-only decision in both files' doc comments — the server call is what actually enforces AS-099, hiding the button is purely presentational. Chose this over "always show the button, let the server reject" because AS-099's text explicitly calls out both halves ("unavailable in the UI and rejected server-side"), so satisfying only the server half would leave the assertion partially unmet.
- Both new props are optional and default to `undefined`, so `TaskDetailSheet`/`CommentList`'s existing callers (there are none wired to a real page yet — confirmed via grep, matches F039's own doc comment that it isn't wired to a route yet) and existing tests (tests/unit/comment-list.test.ts) are unaffected; when unset, the delete button simply never renders (safe default, not a broken permission check).
- Reused the exact idempotency convention from `deleteTask`: the comment lookup filters `deleted_at is null`, so a second delete call on an already-deleted comment returns "not found" rather than re-touching the row.

## Out-of-scope work needed
- No caller currently wires `currentUserId`/`currentUserRole` into `TaskDetailSheet`/`CommentList` because no page renders `TaskDetailSheet` against real data yet (same gap F039/F060 already flagged as pre-existing, not something F061 introduced). Whichever future feature wires `TaskDetailSheet` into a real board/list page should pass the viewer's own user id and their `getWorkspaceMembers`-derived role through these two new props so the delete button actually appears for authorized viewers.
- AS-101 (Realtime disappearance for other live viewers) and AS-102 (no reappearance after reload) are separate assertions not assigned to F061; this feature's soft-delete plus the existing `comments_select_active_members` RLS `deleted_at is null` filter already gives both of those their underlying mechanism, but no Realtime subscription wiring exists yet in `comment-list.tsx` — that's F061's sibling feature's scope per the validation contract, not re-implemented here.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: chose to hide the delete button for unauthorized viewers (rather than "always show, let server reject") per AS-099's own two-part wording. Documented above under Decisions made.
AUTONOMOUS_DECISION: gave the comment's own author a plain active-membership check (not admin-only) rather than skipping a membership check entirely for the author path, so a member removed from the workspace after commenting can no longer delete via this action — an extra guard not explicitly required by AS-098's text but consistent with `requireActiveMembership` being used as defense-in-depth everywhere else in this file.

## Notes for the next worker
- `lib/actions/comments.ts` now exports both `addComment` and `deleteComment`; `deleteComment`'s JSDoc-style comment block explains the author-vs-admin branching in detail — read it before extending this file further.
- The new migration's `can_modify_comment` SECURITY DEFINER function is a close sibling of the same file's `is_task_workspace_member` (from F058's migration) — if a future feature needs "can this user edit this comment's text," it can likely reuse `can_modify_comment` as-is rather than writing a third near-duplicate function.
- No MCP tools used at run time (registry marks this feature "MCP at run: none"); schema change was applied via `supabase db push --linked` per `connections/mcp-registry.md`'s documented CLI-first path.
