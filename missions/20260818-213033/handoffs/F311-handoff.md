# Handoff: F311 — Wire mention notification/watcher-promotion fan-out into editComment

## Status
COMPLETE

## Assertions covered
AS-381: PASS — verified via a real-Supabase integration test run (isolated file run): editing a comment to add a new mention creates a `mention`-kind notification for the newly-mentioned user, linked to the comment (`comment_id`), and promotes them to a task watcher; a follow-up edit that keeps the same mention (typo fix) creates no duplicate notification; editing to remove a previously-present mention creates no notification and doesn't error.

## Files changed
lib/actions/comments.ts
tests/integration/notification-fanout.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0, 2 pre-existing unrelated warnings in lib/queries/search.ts and tests/unit/invite-member-pagination.test.ts)
`npx vitest run tests/integration/notification-fanout.test.ts tests/integration/edit-comment.test.ts tests/integration/add-comment.test.ts tests/unit/notification-fanout.test.ts` (0, 35 passed)
`npx vitest run` (1 — see Notes below; failures are pre-existing Supabase auth rate-limiting across ~55 unrelated integration test files when the whole suite runs in parallel against the real linked project, not caused by this change)

## Decisions made
- Reused the exact three shared helpers `addComment`'s fan-out block already uses — `computeFanoutRecipients`, `filterRecipientsByInAppPreference`, `createNotification` (lib/notifications/create-notification.ts) — rather than reimplementing fan-out logic a third time or calling `lib/notifications/mentions.ts`'s `notifyNewlyMentionedUsers` (that helper's `createNotification` call never passes `commentId`, since it was built for task-description mentions which have no comment to link to — the comment-edit case needs `comment_id` set, matching AS-374's "notifies with a link to the comment" behaviour `addComment` already gives brand-new comments).
- Used `computeFanoutRecipients({ type: "commented", watcherIds: [], mentionedIds: reallyNewlyMentionedIds })` (not `type: "mentioned"`) specifically so the resulting recipient's `kind` is `"mention"` and the notification carries this edit's `commentId` — `type: "mentioned"`'s only caller (`notifyNewlyMentionedUsers`) never threads a `commentId` through at all.
- Diffed old vs new `body_json` via `lib/notifications/mentions.ts`'s existing `extractNewlyMentionedIds` (F205/F207's established "notify only newly added mentions per save" rule, built for the exact same "content gets re-saved repeatedly" shape a description has) — added `body_json` to the comment-row `select()` so the pre-update body is available to diff against `mentionSafeBodyJson` (the post-strip, post-update body). This is what makes the second ("typo fix, same mention") and third ("mention removed") test cases behave correctly: only ids present in the new body AND absent from the old body are notified/promoted.
- Deliberately did NOT add a `comment_reply`-kind watcher notification on every edit. AS-381's text ("a mention notifies the mentioned user") is specifically about mentions; the scrutiny finding #3 this feature follows up on is also specifically about the missing mention fan-out, not about watcher notifications on edit. Firing a watcher notification on every single comment edit is a separate, debatable UX call (not requested by any assigned assertion) and is called out below as out-of-scope rather than silently added.
- Kept the whole block inside the same non-fatal `try/catch` pattern every other post-write side effect in this file already uses (auto-watch upsert, `addComment`'s own fan-out block, `writeTaskCommentEvent`, broadcast, `revalidatePath`) — a notification/watcher-promotion failure must never fail the edit itself, which had already succeeded by the time this block runs.

## Out-of-scope work needed
- Whether editing a comment should also notify the task's watchers of the edit itself (a `comment_reply`-kind event, mirroring what posting a brand-new comment does) was explicitly left out of scope for this feature — no assigned assertion asks for it, and it's a debatable UX call (re-notifying watchers on every typo fix could be spammy in its own right, unlike the mention case which already has an established "notify only what's new" diffing rule to lean on). If this is wanted, it should be its own feature with its own assertion ID and its own clarification pass on the "how often/is a diff needed" question.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose NOT to fire a comment_reply/watcher notification on comment edit, treating that as a separate out-of-scope concern from AS-381's mention-specific text, per this feature's own instructions to prefer the more scoped fix. See "Out-of-scope work needed" above for how a future worker could pick this up.

## Notes for the next worker
- The full `npx vitest run` (whole suite, run in parallel) shows ~55 failing integration test files, essentially all with `Error: Failed to sign in <label>: Request rate limit reached` from Supabase Auth — this is pre-existing test-infrastructure flakiness from running the whole integration suite in one parallel batch against the real linked Supabase project's auth rate limits, not something this feature introduced. Confirmed by running the four directly-relevant files in isolation (`notification-fanout.test.ts`, `edit-comment.test.ts`, `add-comment.test.ts`, `tests/unit/notification-fanout.test.ts`) — all 35 tests pass cleanly with 0 failures when not competing for auth rate-limit budget with the rest of the suite.
- No MCP tools were used for this feature — it's a pure application-code change to an existing Server Action plus new test coverage against the already-existing `notifications`/`task_watchers` schema (no schema change needed).
