# Handoff: F060 — comment list render

## Status
COMPLETE

## Assertions covered
AS-096: PASS — comments render oldest-first (defensively re-sorted client-side; test_AS_096_comments_render_oldest_first_regardless_of_prop_order, plus test_AS_096_empty_state_renders_when_there_are_no_comments for the empty-state branch).
AS-097: PASS — each comment shows author (name -> email -> user id fallback) and a relative timestamp via date-fns formatDistanceToNow (test_AS_097_each_comment_shows_author_name_with_email_and_userid_fallback, test_AS_097_each_comment_shows_a_relative_timestamp).

## Files changed
components/task/comment-list.tsx
components/task/task-detail-sheet.tsx
tests/unit/comment-list.test.ts
package.json
package-lock.json

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0)
`npx vitest run tests/unit/comment-list.test.ts` (0)
`npm test` (0 — 2 pre-existing failures in tests/integration/change-member-role.test.ts and tests/integration/remove-member.test.ts, unrelated to this feature: "JWT issued at future" / timeouts against the live Supabase project, caused by the mission's simulated system-date rollover (2026-08-17 -> 2026-08-18) putting the machine clock ahead of Supabase-issued token `iat`; same failure pattern hits tests/integration/archive-project.test.ts's beforeAll too. None of these files were touched by F060. All 4 new comment-list.test.ts tests pass, and the 315 previously-passing tests still pass.)
`npm run build` (0)

## Decisions made
- Installed `date-fns@^4.4.0` (tech-decisions.md lists it but it had never been installed by an earlier feature — F060 is its first real usage). Verified current major via `npm view date-fns version` before install.
- Chose CommentList as a Client Component rather than the clarified spec's default "Server Component for data-fetching + thin Client Component for interactivity." Reason: CommentList is composed inside components/task/task-detail-sheet.tsx (F039), which is already a Client Component by its own established convention (the caller fetches task+members and passes them down as props; TaskDetailSheet only owns the interactive editing surface). This is the exact same situation components/task/tags-editor.tsx (F041) was already in and resolved the same way. Splitting CommentList into a Server Component wrapper here would require either a second network round trip from a Client parent or prop-drilling a fetched array anyway, so it follows the same "caller fetches, this component renders + owns its own interactive add-comment form" pattern as TagsEditor, with local-state optimistic-append on a successful addComment (mirroring TagsEditor's optimistic-update-with-revert).
- Author display resolved by matching `comment.userId` against the `members` list TaskDetailSheet already receives (name -> email -> user id fallback, same order as TaskDetailSheet's own `memberLabel`), rather than adding N Auth Admin API lookups per comment — reuses the members list that's already loaded once per Sheet open, avoiding the same N-calls cost lib/queries/members.ts's own doc comment flags as a known limitation for large member lists.
- `comments` prop on TaskDetailSheet defaults to `[]` so the existing (currently unwired — no page constructs TaskDetailSheet yet, per F039's own note) call sites keep compiling without passing it.
- AS-096 ordering is enforced by CommentList itself (re-sorts by createdAt before rendering) rather than trusted from the caller, so the assertion holds regardless of what order a future caller's query returns rows in.

## Out-of-scope work needed
- No `lib/queries/comments.ts` (`getTaskComments`) query function was added — the feature spec's file list is just `components/task/comment-list.tsx`, and (mirroring F039's own note that TaskDetailSheet isn't wired to a route yet) there is still no page that constructs `<TaskDetailSheet>`, so there's no caller to consume such a query yet. A future feature that wires TaskDetailSheet into the board/list view should add `lib/queries/comments.ts` (same shape as `lib/queries/members.ts`: RLS-scoped select on `comments` filtered to `deleted_at is null`, ordered `created_at asc`) and pass its result as the new `comments` prop.
- F061 (delete-comment-action) and F062 (comment soft-delete-realtime) will need CommentList to grow a delete affordance per-comment (author-or-admin gated) — not built here since it's out of this feature's assigned assertions.
- F063 (comment-realtime-subscription) will need CommentList (or its future caller) to subscribe to Supabase Realtime on `comments` and merge incoming rows into local state — current implementation only appends locally on a successful `addComment` call from this same client.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Client Component (not Server Component) for CommentList — see "Decisions made" above; matches the existing TagsEditor precedent for a component nested inside the already-Client TaskDetailSheet.
AUTONOMOUS_DECISION: `comments` prop defaults to `[]` on TaskDetailSheet since no caller currently supplies it.

## Notes for the next worker
- CommentList's `members` prop type (`CommentListMember`) is structurally identical to `TaskDetailSheetMember` — TaskDetailSheet passes its own `members` prop straight through, no mapping needed.
- No RTL/jsdom in this repo's vitest setup (`vitest.config.ts` uses `environment: "node"`); component tests render via `renderToStaticMarkup` from `react-dom/server` and assert on the resulting HTML string, matching `tests/unit/board-column.test.ts`'s convention.
- The 2 pre-existing integration-test failures (`change-member-role.test.ts`, `remove-member.test.ts`) plus a beforeAll failure in `archive-project.test.ts` are all "JWT issued at future" / timeout errors against the live Supabase project — a side effect of the mission's simulated system date having rolled forward past the Supabase-issued token's `iat`. Not caused by or related to F060; worth flagging to the orchestrator as a standing environment issue if it persists into later features.
