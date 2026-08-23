# Handoff: F305 — Fix soft-delete visibility and realtime scoping for comment reactions (M15 scrutiny FU-6, FU-7)

## Status
COMPLETE

## Assertions covered
AS-369: PASS — `subscribeToReactionsRealtime` now registers `filter: task_id=eq.<taskId>` on both the INSERT and DELETE postgres_changes subscriptions (mirroring `subscribeToCommentsRealtime`'s existing pattern), backed by a new denormalized `comment_reactions.task_id` NOT NULL column. Proved with a real independent-subscriber integration test (`tests/integration/reaction-realtime-delivery.test.ts`) showing a channel scoped to a *different* task never receives an event for this test's task, i.e. the filter is enforced at the transport level, not just client-side. Self-events are no longer dropped in `comment-list.tsx`, proven by a unit test that a second-tab event for the current user is folded in (and that re-folding an already-applied self event is idempotent).
AS-370: PASS — `comment_reactions_select_visible` now requires `c.deleted_at is null` (new migration `20260823080000_fix_comment_reactions_soft_delete_and_scoping.sql`), matching `comments_select_active_members` exactly. Replaced the old admin-client-hard-delete test with one that calls the real `deleteComment` Server Action and asserts a normal member session reads zero reaction rows afterward, plus a new test proving a restored comment's reactions become visible again (deliberate, documented behaviour).

## Files changed
supabase/migrations/20260823080000_fix_comment_reactions_soft_delete_and_scoping.sql (new)
lib/actions/comment-reactions.ts
lib/tasks/subscribe-comments-realtime.ts
components/task/comment-list.tsx
tests/integration/comment-reactions-schema.test.ts
tests/integration/reaction-realtime-delivery.test.ts
tests/unit/reactions-realtime-subscription.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0, 2 pre-existing unrelated warnings)
`npx supabase db push --linked` (0) — applied the new migration
`npx supabase migration list --linked` (0) — confirmed `20260823080000` local/remote match
`npx vitest run tests/unit/reactions-realtime-subscription.test.ts tests/integration/comment-reactions-schema.test.ts tests/integration/reaction-realtime-delivery.test.ts tests/integration/toggle-reaction.test.ts tests/integration/delete-comment.test.ts tests/integration/task-detail-comment-read-path.test.ts` (0, 36/36 passed)
`npx vitest run` (full suite, twice) — 35-39 pre-existing failures unrelated to this feature (Supabase Auth `Request rate limit reached` when the whole integration suite signs in dozens of throwaway users concurrently against the real linked project, plus two pre-existing, unrelated unit-test failures in `user-avatar.test.tsx`/`trash-list.test.tsx` confirmed present on `main` via `git stash` before this change). None of the failures are in files this feature touched.

## Decisions made
- Chose option (b) from the spec — a denormalized `task_id` column on `comment_reactions` with a `filter: task_id=eq.<taskId>` postgres_changes filter — over client-side `comment_id`-set filtering or a `comment_id=in.(...)` filter. Rationale: this is the only option that stops the leak at the actual transport/RLS-filter boundary (the real security concern per the scrutiny report), matches the codebase's own established pattern (`subscribeToCommentsRealtime` already filters `comments` the same way on `task_id`), and doesn't depend on uncertain `in.` filter support across `@supabase/supabase-js`/realtime-server versions.
- Added `alter table comment_reactions replica identity full` in the same migration. `task_id` is not part of the composite primary key `(comment_id, user_id, emoji)`, so by default Postgres logical replication only includes primary-key columns in a DELETE event's OLD row — without REPLICA IDENTITY FULL, `task_id` would be silently absent from the WAL entry for a DELETE and the `task_id=eq.<taskId>` filter would never match a real un-react, breaking DELETE delivery entirely. This is a build-in-context finding not explicitly called out in the spec but necessary for the fix to actually work; documented inline in the migration.
- Added `and c.task_id = comment_reactions.task_id` to the INSERT policy's `with check`, so a caller can't insert a `task_id` that doesn't actually correspond to `comment_id` (which would otherwise let a forged `task_id` leak a reaction event onto an unrelated task's realtime channel, or hide it from the real one).
- Used `drop policy if exists` + `create policy` (not `alter policy`) to change `comment_reactions_select_visible`'s `using` clause, matching this migration file's and every prior `comment_reactions_*`/`comments_*` policy migration's own convention in this repo — confirmed no `alter policy` usage exists anywhere in `supabase/migrations`.
- Populated `toggleReaction`'s insert row with `task_id: check.taskId` (the value `resolveCommentAndMembership` already resolves and re-verifies server-side), rather than trusting a client-supplied value — RLS independently re-checks it matches via the with-check above (defense in depth).
- Restoring a soft-deleted comment (`restoreComment`) deliberately resurrects its reactions — documented explicitly in the migration's comment block and proven by a new test (`test_AS_370_restoring_a_soft_deleted_comment_resurrects_its_reactions_deliberate_behaviour`). This is the *existing* behaviour (reactions were never actually deleted, only hidden by RLS while `deleted_at` was set) and is correct: nothing about restoring a comment should force reactors to re-react.
- Removed the self-event drop in `comment-list.tsx`'s `useReactionsRealtime` callback entirely rather than conditioning it on "is this the originating tab" (no such signal exists client-side). This is safe because `applyReactionToggle` is already documented and tested as idempotent for a repeat add/remove of the same user+emoji — the originating tab's optimistic update and the echoed Realtime event converge to the same state with no flicker or double-count, and a second tab for the same user now actually receives the event.
- Kept the existing `comment_reactions_delete_self` policy unchanged (self-only, no visibility/`deleted_at` re-check) — mirrors `task_watchers_delete_self`'s established precedent that a user may always remove their own reaction row if it exists and belongs to them, independent of the parent comment's current visibility state.

## Out-of-scope work needed
None identified specific to this feature. The FU-8/FU-9/FU-10 follow-ups from the same M15 scrutiny report (mention-notification comment linking, `description-mentions.test.ts` repair, notification-preferences UI reconciliation) are separate follow-up features already enumerated in `missions/20260818-213033/milestones/M15-scrutiny.md` and out of this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose the task_id-denormalized-column + server-side filter approach (option b) over client-side comment_id-set filtering or an `in.()` filter, per the "simpler, more secure option" ZERO_QUESTIONS guidance — see Decisions made above for full rationale.
AUTONOMOUS_DECISION: Added `replica identity full` on `comment_reactions`, not explicitly asked for in the spec, because without it the new DELETE filter would silently never match (task_id absent from the WAL's OLD row for a non-PK column) — verified this is necessary by reading how the sibling `comments` channel avoids the issue (its own PK already contains everything it filters on) and confirming `comment_reactions`' PK does not include `task_id`.
AUTONOMOUS_DECISION: Documented the comment-restore-resurrects-reactions choice as the deliberate correct behaviour (current behaviour, made explicit and tested) rather than changing it, per the spec's own steer ("very likely the correct behaviour").

## Notes for the next worker
- The migration `20260823080000_fix_comment_reactions_soft_delete_and_scoping.sql` was applied to the linked Supabase project via `supabase db push --linked` and confirmed present in both `local` and `remote` via `supabase migration list --linked`. No MCP Supabase tools were used for this feature (none were needed beyond the CLI push/list already covered by the mission's connections/mcp-registry.md conventions for schema changes).
- `tests/integration/reaction-realtime-delivery.test.ts` has two tests that both use Realtime channels; they intentionally use *different* channel names (`comment_reactions:${taskId}` for the first, `f305-scoping-check:${taskId}` for the second) because the Supabase JS client throws if you call `.on()` again on a channel object that's already been `.subscribe()`d — reusing the same channel name across tests in the same file/describe block will silently break the second one with `cannot add postgres_changes callbacks ... after subscribe()`. Watch for this if adding more reactions-realtime integration tests to this file.
- The full `npx vitest run` suite has pre-existing, environment-only flakiness unrelated to this feature: running dozens of integration test files concurrently against the real linked Supabase project trips Supabase Auth's sign-in rate limit (`Request rate limit reached`), failing ~35 unrelated test files. This is a known limitation of the test setup (many files each create their own throwaway users), not something this feature introduced or should fix. Verified by running the specific touched/related test files in isolation (all green) and by confirming two other unrelated failures (`user-avatar.test.tsx`, `trash-list.test.tsx`) are already present on `main` before this change via `git stash`.
