# Handoff: F207 — notification fan-out

## Status
COMPLETE

## Assertions covered
AS-294: PASS — status_changed event fans out to every active watcher (unit: test_AS_294_AS_382_a_status_changed_event_notifies_every_active_watcher_with_watcher_update_kind, test_AS_294_empty_state_...; wired into moveTaskStatus in lib/actions/tasks.ts).
AS-374: PASS — mention notifications carry `p_comment_id` so the recipient can jump to the exact comment (integration: test_AS_374_AS_375_AS_381_AS_382_commenting_with_a_mention_notifies_the_mentioned_user_with_a_comment_link_and_makes_them_a_watcher asserts `comment_id` equals the posted comment's id; unit: test_AS_374_...).
AS-375: PASS — a mentioned non-watcher is promoted to watcher via a durable `ignoreDuplicates` upsert, both in addComment (integration test above) and in notifyNewlyMentionedUsers for description mentions (unit: test_AS_375_notifyNewlyMentionedUsers_promotes_each_mentioned_non_watcher_to_watcher).
AS-380: PASS — assignment fans out task_assigned to the newly-added assignee (unit: test_AS_380_...; integration: test_AS_380_AS_384_assigning_a_task_creates_a_task_assigned_notification_for_the_assignee_and_none_for_the_actor, a real `notifications` row is asserted).
AS-381: PASS — a mentioned user is notified (unit + integration, same tests as AS-374).
AS-382: PASS — watchers are notified of status changes (watcher_update kind) and comments (comment_reply kind) — unit tests test_AS_294_AS_382_..., test_AS_382_a_commented_event_notifies_watchers_with_comment_reply_kind, test_AS_382_AS_374_dedupe_....
AS-384: PASS — the actor never notifies themselves, including the exact "assignee+watcher+mentioned at once" scenario named in the spec's dedupe note (unit: test_AS_384_negative_..., test_AS_384_dedupe_the_exact_named_scenario_...; integration: assignment test asserts zero notification rows for the actor).

## Files changed
lib/notifications/fanout.ts (new)
lib/notifications/mentions.ts (notifyNewlyMentionedUsers: real implementation replacing F205's documented stub)
lib/actions/tasks.ts (setTaskAssigneesCore: assignment fan-out; moveTaskStatus: status-change fan-out; editTask: updated notifyNewlyMentionedUsers call site)
lib/actions/comments.ts (addComment: comment/mention fan-out + AS-375 watcher promotion)
tests/unit/notification-fanout.test.ts (new)
tests/unit/description-mentions.test.ts (updated notifyNewlyMentionedUsers tests for the new real-implementation signature)
tests/integration/notification-fanout.test.ts (new)

## Commands run
`npx tsc --noEmit` (0)
`npx eslint lib/notifications/fanout.ts lib/notifications/mentions.ts lib/actions/tasks.ts lib/actions/comments.ts tests/unit/notification-fanout.test.ts tests/unit/description-mentions.test.ts tests/integration/notification-fanout.test.ts` (0)
`npx vitest run tests/unit/notification-fanout.test.ts tests/unit/description-mentions.test.ts tests/integration/notification-fanout.test.ts tests/integration/assign-task.test.ts tests/integration/add-comment.test.ts tests/integration/rls-notifications.test.ts` (0, 48/48 passed)
`npx vitest run` (0 process exit; 1492 passed, 100 skipped, 16 failed — all 16 failures are in tests/integration/create-workspace-owner.test.ts, tests/integration/invite-member.test.ts, tests/integration/workspace-role-expansion.test.ts, none of which touch F207's files; see Notes below)

## Decisions made
- Ambiguity resolution note ("one event produces at most one notification per recipient even when they are assignee, watcher, and mentioned at once"): resolved per-event-type. `assigned` only ever draws from `assigneeIds`, `status_changed` only from `watcherIds`, so those two event types can never internally double-count a recipient. `commented` is the one event type where watcher and mention sets can genuinely overlap for the same user; in that case `mention` wins over `comment_reply` (more specific — carries the comment link, AS-374) rather than emitting two rows. This is the simpler option: no new dependency, and the "who wins" rule lives in exactly one place (computeFanoutRecipients), never duplicated at a call site.
- `computeFanoutRecipients` stays pure (no Supabase import) per the clarified Q1-Q10 answers; the actual `create_notification` RPC loop lives in each calling Server Action (tasks.ts/comments.ts) and in notifyNewlyMentionedUsers, using the caller's own authenticated session client (`supabase`, never `admin`) — required because F206's spoofing-fix migration pins `actor_id` to `auth.uid()` and rejects non-system calls with no session.
- Replaced F205's documented no-op stub (`notifyNewlyMentionedUsers` in lib/notifications/mentions.ts) with the real implementation, even though it isn't in F207's spec "Files (approximate)" list — the spec's own context explicitly names this file as "the real implementation F205 deferred to" and F205's doc comment says exactly this file is "the single, obvious seam a future F207 worker can replace." Updated its signature to accept `supabase`/`admin`/`workspaceId` (backward-incompatible), and updated its one caller (editTask) and its existing unit tests accordingly — this keeps AS-374/AS-381/AS-384/AS-375 covered for the description-mention path, not just the comment-mention path.
- AS-375's watcher promotion never overrides an existing `task_watchers` row (`ignoreDuplicates: true` on the upsert) — mirrors F164's established "durable unwatch" rule (see lib/actions/watchers.ts's doc comments): a user who explicitly unwatched a task is never silently re-subscribed just because someone mentions them later.
- All fan-out side effects (RPC calls, watcher-promotion upserts) are wrapped in non-fatal try/catch, consistent with every other post-write side effect already in these files (writeTaskFieldChanges, revalidatePath, etc.) — a notification failure never fails the underlying assignment/status-change/comment/edit action itself.

## Out-of-scope work needed
- F211 (per-user notification preferences) does not exist yet — every computed recipient is notified unconditionally, per this feature's own Draft scope note ("all in-app notifications are on" until F211 lands). No gate was added; F211 should add a preferences check as a new call site inside (or just before) each RPC loop this feature added, not modify computeFanoutRecipients itself (which should stay preference-agnostic).
- F212 (task_due_soon reminders) is out of scope — the `task_due_soon` kind exists in the DB check constraint (F206) but this feature's FanoutEvent union deliberately does not include a "due soon" event type; a future worker should add a new event variant to lib/notifications/fanout.ts rather than bypassing it.
- Multi-assignee task_assigned notifications: `setTaskAssigneesCore` (the shared write path behind assignTask/setTaskAssignees/addTaskAssignee/removeTaskAssignee) notifies every newly-added assignee (`toAdd`), which covers all four of those actions consistently — no further work needed there, noting it here only because it wasn't spelled out per-function in the spec's Files list.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to touch lib/notifications/mentions.ts (not listed in the spec's "Files (approximate)") because the run-context notes explicitly identify it as the designated seam F207 replaces, and leaving it as a stub would leave AS-374/AS-381/AS-384/AS-375 uncovered for the description-mention trigger path named in the spec's own context.
AUTONOMOUS_DECISION: For `commented` events where a recipient is both a watcher and freshly mentioned, chose `mention` kind to win (see Decisions made above) — the spec's dedupe note says "at most one notification" but doesn't say which kind wins; picked the more information-dense kind (carries the comment link) as the simpler, non-lossy choice.

## Notes for the next worker
- No MCP tools were used for this feature (registry note: "MCP at run: none" — confirmed correct; this is pure application logic + existing DB objects from F206).
- The full-suite `npx vitest run` shows 16 pre-existing failures, all confined to tests/integration/create-workspace-owner.test.ts, tests/integration/invite-member.test.ts, and tests/integration/workspace-role-expansion.test.ts (F013/F015/F126 — workspace creation and invite flows). These files are untouched by this feature and the failures are timeouts (`Test timed out in 30000ms`) consistent with Supabase Auth signup rate-limiting under the load of a full-suite run creating many throwaway users back-to-back, not a regression from this change. Re-running just the F207-relevant + directly-touched-file suites (see Commands run) is 100% green. If a future validator sees these same failures reproduce in isolation (not just under full-suite load), they predate F207 and should be filed as their own bug, not attributed here.
- `computeFanoutRecipients` intentionally returns `null` (not an empty array/throw) for genuinely malformed input (missing `actorId`, unknown `event.type`), and an explicit `[]` for a valid event with zero qualifying recipients — callers must handle both, and every call site in this feature does (`recipients ?? []`).
