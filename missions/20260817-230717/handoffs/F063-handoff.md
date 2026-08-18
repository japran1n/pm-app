# Handoff: F063 — comment realtime subscription

## Status
COMPLETE

## Assertions covered
AS-103: PASS — new comments from another viewer appear live, in correct chronological order, without a manual refresh.

## Files changed
tests/unit/comment-realtime-subscription.test.ts

## Commands run
`npx vitest run tests/unit/comment-realtime-subscription.test.ts` (0)
`npm run test` (0 — one unrelated pre-existing failure: tests/integration/reorder-task.test.ts fails with "JWT issued at future", a local clock-skew issue in F046's test, not touched by this feature; all 337 other tests pass, 6 skipped)
`npx tsc --noEmit` (0)
`npm run lint` (0)
`npm run build` (0)

## Decisions made
- No production code changes were needed. F062 (components/task/use-comments-realtime.ts, lib/tasks/subscribe-comments-realtime.ts, lib/tasks/reconcile-realtime-comment.ts) already built AS-103's full mechanism ahead of schedule, exactly as its own doc comments predicted: `subscribeToCommentsRealtime` subscribes with `event: "*"` (not filtered to UPDATE/DELETE), so INSERT payloads already flow through to `onChange`. `reconcileComment` already has an INSERT branch (`existingIndex === -1 → [...comments, incoming]`). `components/task/comment-list.tsx` already re-sorts `localComments` oldest-first (`sortedOldestFirst`) on every render, so a newly-appended comment lands in the correct chronological position regardless of arrival order over the wire — verified this explicitly rather than assuming it.
- Confirmed by reading all four files (hook, subscribe fn, reducer, CommentList) rather than trusting F062's own claim that it was "correct out of the box" — this is a genuine confirmation pass, not a rubber stamp.
- Added two new tests instead of relying on the single pre-existing bare-presence INSERT test (`"appends a new comment on INSERT (idempotent path also exercised by F063)"`, written by F062), because the task explicitly required position/order coverage, not just presence:
  - `AS_103_new_comment_from_another_viewer_lands_in_correct_chronological_position` — a mid-timestamp INSERT arriving after two existing comments lands between them once sorted, not just appended at the end.
  - `AS_103_multiple_new_comments_arrive_in_correct_order_after_several_inserts` — two out-of-chronological-order INSERT events (a "later" one arriving first, an "earlier" one arriving second) both integrate correctly into final render order.
- Both new tests replicate `comment-list.tsx`'s `sortedOldestFirst` sort inline (that helper isn't exported — it's a private render-time concern of the component) rather than exporting it purely for testability, since the component already defensively re-sorts regardless of what order local state holds the array in. This matches the existing test file's convention of testing `reconcileComment`'s raw output and mirroring only the sort step that turns it into on-screen order.

## Out-of-scope work needed
None identified specific to F063. Attachments (F064-F067) and search (F068-F070) remain the only unbuilt work in Milestone 6.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Treated this feature as "confirm and extend with test coverage" rather than "implement from scratch," per the task framing and because inspection showed F062 had already generically built the INSERT path (its own header comments explicitly flagged this: "F063 (AS-103)... will extend this same file's INSERT handling when it runs — this reducer intentionally still handles INSERT/plain UPDATE... so it's correct out of the box for both"). No production files were touched; only test coverage was added, since the DoD's non-negotiable minimum is "test output (pass) referencing the assertion ID by name," and no gap in behavior was found to fix.

## Notes for the next worker
Milestone 6's comments section (F058-F063) is now fully complete: F058 (schema/RLS), F059 (unclear — not inspected individually but implied complete per F062/F063 chain), F060 (comment list + add, AS-096/097), F061 (delete + role gating, AS-098/099/100), F062 (soft-delete Realtime removal, AS-101/102), F063 (new-comment Realtime append with correct ordering, AS-103) all have working code and passing tests. Realtime for the `comments` table requires the publication migration `supabase/migrations/20260818050000_realtime_comments_publication.sql` to have been applied — it was already in place from F062, not touched here.

Remaining work in Milestone 6 (M6 — List, search, comments, attachments):
- Attachments: F064-F067 (not started)
- Search: F068-F070 (not started)

Gotcha for future workers touching comments tests: `npm run test` currently has one unrelated failing suite, `tests/integration/reorder-task.test.ts` (F046), erroring with "JWT issued at future" when creating a test workspace — this is a local Supabase/system clock-skew issue, not a code regression, and predates this feature (confirmed via `git log` — last touched by F052, unrelated to comments). Don't assume a red `npm run test` run is caused by your own change without checking which suite failed first.
