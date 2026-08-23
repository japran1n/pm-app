# M15 scrutiny — RE-VALIDATION (pass 2)

_Mission: 20260818-213033 — M15 "Collaboration: activity, comments, mentions, notifications, email"_
_Date: 2026-08-23. Supersedes pass 1 (see git history)._
_Method: 6 parallel adversarial reviewers, code+tests only (no handoffs, no run-log claims passed in), plus independent orchestrator-level verification of every blocker._

## Verdict: **FAIL**

37 PASS / 7 FAIL / 10 DEFERRED. **5 blockers.**

The F301–F308 batch genuinely closed most of pass 1's findings — the two SECURITY DEFINER
forgery holes, the `getTaskDetail` read-path omission, the reactions soft-delete/realtime
scoping, the mention-visibility error swallowing, and the description-mentions regression are
all verifiably fixed in the current code. But pass 1 missed an entire class of defect, and
two new ones surfaced:

1. **The mention picker and mention chips do not work at all** (new, blocker). Every mention
   assertion that depends on the live editor is broken by a Tiptap lifecycle bug — see B1.
2. **`create_notification` still has the exact `p_system` forgery bypass that F302 fixed in
   `write_task_activity_entry`** (new, blocker). The one-line fix was applied to the activity
   RPC and never to the notification RPC.
3. **`editComment` performs no notification fan-out** (blocker) — mentions added by editing a
   comment notify nobody.

## Assertion table

| ID | Verdict | Reason |
|---|---|---|
| AS-294 | FAIL | Watcher fan-out fires only on status change and new comment; title/priority/due-date/estimate/assignee/tag edits write `task_activity` but no watcher notification (`editTask` has mention fan-out only). |
| AS-353 | PASS | Per-task feed wired into the detail sheet, `created_at desc`. Caveat: `bulkRestoreTasks`, `bulkDeleteTasks`, `deleteTask`, `duplicateTask`, `updateTaskTags`, `promoteSubtask`, `reorderTask` write no entry. |
| AS-354 | PASS | RPC pins `v_actor := auth.uid()` server-side; callers use the session client, never `admin`. |
| AS-355 | PASS | `diffTaskFields` covers exactly the six named fields; called from `editTask`, `moveTaskStatus`, `moveAndReorderTask`, `setTaskAssigneesCore`, `bulkUpdateTasks` (per-task snapshots). |
| AS-356 | PASS | `comment_added`/`comment_deleted` land in the same table and feed. Caveat: `restoreComment` writes nothing, so the feed permanently claims a restored comment is deleted. |
| AS-357 | PASS | `task_activity` RLS has a SELECT policy only — no UPDATE/DELETE/INSERT policy for any role; F302's `if p_system and auth.uid() is null` genuinely closes the forgery hole, with a passing negative test. |
| AS-358 | PASS | `limit+1` hasMore probe, server-side clamp to 200, "Load more" refetch; `task-activity-feed.test.ts` passes (green in isolation — see I1). |
| AS-359 | PASS | SELECT policy `using (public.is_task_visible_to(task_id))`; reads use the session client. Outsider read = 0 rows, outsider RPC write rejected, both tested. |
| AS-360 | PASS | Both recurrence paths pass `p_system := true` → `actor_id = null`; UI renders "System". Verified test green in isolation. |
| AS-361 | PASS | `groupTaskActivityEntriesByDay` buckets in the viewer's IANA zone; `formatDistanceToNow` relative labels with absolute time in `title`. |
| AS-362 | PASS | `editComment` gates on `commentRow.user_id !== user.id` + active membership + `canWrite`; author-only UI affordance; live test passes. |
| AS-363 | PASS | `edited_at` is now actually SELECTed on the server read path (`lib/actions/tasks.ts:3366`) and mapped, so "(edited)" survives reload — the pass-1 gap is closed. Minor: exact time only in `title`/`aria-label`; `edited_at` is app-clock, not DB `now()`. |
| AS-364 | PASS | Three layers: action check, RLS, and the hardened `enforce_comment_edit_author_only` trigger rejecting **any** `user_id` change — the two-step authorship takeover is closed. |
| AS-365 | PASS | `toggleReaction` inserts through the user's own session; RLS `comment_reactions_insert_self` is the real boundary; Zod allow-list mirrors the DB CHECK. |
| AS-366 | PASS | Count + Popover/`aria-label` name list; reactions batched into `getTaskDetail` so they survive reload. Minor: `reactorNames` falls back to a raw UUID for an ex-member. |
| AS-367 | PASS | Insert-first / catch `23505` / DELETE; concurrent-toggle convergence proven by a real-DB test. |
| AS-368 | PASS | Composite PK `(comment_id, user_id, emoji)`; duplicate-insert rejection tested at DB level with a real session. |
| AS-369 | PASS | Server-side `filter: task_id=eq.${taskId}` on the denormalized column, RLS re-verifies `c.task_id`, `replica identity full` for DELETE payloads; live wire delivery test passes. Residual: DELETE payloads are not RLS-filtered by Supabase (minor). |
| AS-370 | PASS | Soft-delete path hides reactions via `c.deleted_at is null` in `comment_reactions_select_visible` + `getTaskDetail` filtering; hard purge cascades. Semantically "hidden", not "deleted" — deliberate and tested. |
| AS-371 | **FAIL** | Mention picker offers nobody — see B1. |
| AS-372 | **FAIL** | Filtering logic is correct but only ever applied to the frozen empty list — B1. |
| AS-373 | **FAIL** | Posted mentions render as grey "@Former member" plain text, not chips, on reload — B1. |
| AS-374 | PASS | `comment_id` stored, `&commentId=` appended in the panel link, consumed by `board.tsx:201`, scrolled/highlighted by `comment-list.tsx:526`. Minor: the no-`projectId` fallback branch drops `commentId`. |
| AS-375 | PASS | Idempotent `upsert(..., {onConflict:"task_id,user_id", ignoreDuplicates:true})` on both paths. Minor: a user with a durable `is_watching = false` row is not re-watched; promotion is not transactional with the notification write. |
| AS-376 | **FAIL** | Server half is solid (`sanitiseMentionsForVisibility` in `addComment`/`editComment`/`editTask`, fail-the-write on error, real-DB coverage). The "not offered in the picker" half is unverifiable/broken because of B1. Also `getMentionCandidates` does not catch `MentionVisibilityCheckError`, producing an unhandled client rejection. |
| AS-377 | PASS (vacuous) | `resolveMentionDisplay` → unstyled span, no `data-id`, no crash, no UUID leak. Passes, but B1 means this is what *every* mention currently renders as, so it proves nothing about the healthy path. |
| AS-378 | **FAIL** | Server half correct (`editTask` sanitises `descriptionJson`, diffs post-sanitisation, real-DB coverage). Description editor + preview use the same frozen-extension path as B1, so the picker and chips fail identically. |
| AS-379 | PASS | Bell + count badge mounted in workspace chrome (desktop sidebar header and mobile top bar); unit-tested both states. Minor: sidebar header, not a distinct app header. |
| AS-380 | PASS | Covered on create, `setTaskAssigneesCore`, `duplicateTask`, `bulkUpdateTasks`. |
| AS-381 | **FAIL** | `editComment` (`lib/actions/comments.ts:909-1135`) sanitises mentions and writes `body_json` but performs **no** fan-out — verified directly: no `computeFanoutRecipients`, no `createNotification`, no watcher promotion in that range. Adding an @-mention by editing notifies nobody. `editTask` has the equivalent path; the comment path has no counterpart, and no test covers it. |
| AS-382 | PASS | Both branches present, covered by real-DB tests including the drag-to-reorder status change. |
| AS-383 | PASS | Function, partial unique index, and pg_cron job all real and verified against the live DB by a test that queries `cron.job`. Minor defects: `due_date <= today` fires on the due date itself; the `notification_preferences` INNER join means a user with no preferences row never gets an overdue notification (opposite of the TS fail-open policy); UTC-only. |
| AS-384 | PASS | `computeFanoutRecipients` drops `id === event.actorId` before kind assignment at every call site; overdue sweep uses `actor_id null`. |
| AS-385 | PASS | `created_at desc`; actor name + `actionLabel(kind)` + `taskLabel(task)`; behavioural test. |
| AS-386 | PASS | Row is a `Link` to the board deep-link; `markNotificationRead` is a real persisted UPDATE with revert + `toast.error` on failure (pass-1 swallowing fixed). |
| AS-387 | PASS | `markAllNotificationsRead(workspaceId)` UPDATEs all unread rows; negative test proves it does not touch another member's rows. |
| AS-388 | PASS | Realtime INSERT on `notifications:<userId>` with transport-level `filter: user_id=eq.${userId}`; bell re-fetches a server snapshot plus focus/visibility reconciliation. |
| AS-389 | PASS | `notifications_select_own` = `user_id = auth.uid()`, no client INSERT policy; cross-user SELECT/INSERT/mark-read all proven to fail live. (Read assertion only — see B2 for the write-side hole.) |
| AS-390 | PASS | Deleted/soft-deleted/invisible tasks collapse to `title: null, projectId: null`; `taskHref` returns `null` → non-clickable button; excluded from `unreadCount`. Two live tests. |
| AS-391 | PASS | Every member of the closed `NotificationKind` union has a gating column via an exhaustive `Record<NotificationKind, ...>` (a missing mapping is a compile error, not a silent allow); enforced at all 9 `computeFanoutRecipients` call sites with the service-role client; RLS self-scoped with negative tests; default rows via trigger + backfill. Minor: fails open on read error, and the SQL sweep fails closed on the same condition. |
| AS-392 | PASS | Retention enforced inside the SELECT policy itself (`created_at >= now() - interval '30 days'`), so no query path can leak stale rows; test backdates a row via admin and asserts the owner sees nothing. |
| AS-396 | **FAIL** | Not met and not currently reachable: no sender exists (F213–F217 skipped), nothing reads `email_enabled`, and `EMAIL_NOTIFICATIONS_ENABLED = false` hides every email control, so a user has no UI to turn email off. F307 correctly recorded this as BLOCKED — recording it here as FAIL/deferred, not GREEN. The existing round-trip test proves a column persists, not the assertion. |
| AS-393, 394, 395, 397, 398, 399, 400, 401, 402 | DEFERRED | F213–F217 SKIPPED (Resend not connected, deferred by user 2026-08-18). Out of scope for this pass; re-validate when the email chain lands. |

## Blockers

### B1 (blocker) — the mention picker and mention chips are dead: a frozen Tiptap extension
`components/editor/rich-text-editor.tsx:360` builds the extension with
`getMentionItems: () => mentionSuggestions`, closing over *that render's* array, and the
in-file comment justifies this by claiming `useEditor`'s `mostRecentOptions` keeps it current.
That claim is false for Tiptap 3.30.2. Verified directly in `node_modules/@tiptap/core/dist/index.cjs`:
`createExtensionManager()`/`createSchema()` run **once**, at line 6835 inside the constructor;
`setOptions()` (6963-6975) merges `this.options` and then only calls `view.setProps` +
`view.updateState`. The Suggestion plugin instance therefore permanently holds the
first-render closure.

Both callers start empty and fill asynchronously:
`components/task/comment-list.tsx:267` initialises `visibleMentionIds` to `null`, so
`mentionSuggestions` computes to `[]` on mount and is only populated after the
`getMentionCandidates(taskId)` round-trip in the effect at `:281`. `task-detail-sheet.tsx:618-655`
does the same for descriptions. Unless the lazily-imported editor chunk happens to land after
the server round-trip — a race the code does nothing to enforce (no `key`, no remount, no
re-set) — the picker's item source is `[]` forever and the popup shows "No matching members".

The read path fails the same way, which is worse because it is not a race: the reviewer
verified empirically that rendering `RichTextRenderer` with `mentionSuggestions: []` and then
re-rendering with the member present still shows `@Former member` and never `@Alan Turing`
(ProseMirror does not repaint unchanged nodes, and the renderer's effect only calls
`setContent` when the JSON differs). So every persisted mention renders as grey plain text
after reload.

Kills AS-371, AS-372, AS-373, AS-378 (UI half) and hollows out AS-376 and AS-377.

**Why no test caught it:** `tests/unit/mention-extension.test.tsx` exercises
`filterMentionItems`/`MentionList` in isolation and never drives the real extension.
`tests/unit/mention-picker-narrowing.test.tsx` mocks `RichTextEditor` entirely and asserts on
the prop value — it validates that the right prop is computed while being structurally
incapable of noticing that the prop is ignored after mount. `test_AS_373_mention_node_renders_as_a_chip`
mounts the renderer with suggestions **already populated**, an ordering the app never produces.
Three tests that mirror the implementation's assumption rather than its behaviour.

### B2 (blocker) — `create_notification` still has the `p_system` forgery bypass
`supabase/migrations/20260823030000_fix_create_notification_spoofing.sql:88` reads
`if p_system then` — unconditional — and line 126 grants EXECUTE to `authenticated`.
Taking that branch sets `v_actor := null` and skips **both** the `auth.uid() is not null` check
and the caller-membership check. Any authenticated user can call the RPC directly with
`p_system => true` and inject a notification into any active member's inbox in any workspace,
with arbitrary `kind`, `task_id`, `comment_id`, and `payload`, attributed to "System".
(Recipient membership is still checked, so this is spoofing/spam, not a read leak.)

F302 applied exactly the right fix to the sibling function —
`20260823060000_fix_write_task_activity_entry_forgery.sql` uses `if p_system and auth.uid() is null then` —
and the run-log for F302 explicitly says it "correctly mirrors the exact pattern used for
`create_notification`'s spoofing fix earlier today." It does not. The notification RPC never
received the `and auth.uid() is null` guard. This is the same defect class pass 1 called
"structurally identical", still open in the other half of the pair.

**Why no test caught it:** `rls-notifications.test.ts:226` tests an outsider *without* `p_system`;
every other test passes `p_system: true` from the admin/service-role client, where the branch is
legitimate. There is no test asserting that an `authenticated` caller passing `p_system => true` is rejected.

### B3 (blocker) — `editComment` performs no notification fan-out (AS-381)
Verified directly: within `lib/actions/comments.ts:909-1135` the only mention-related call is
`sanitiseMentionsForVisibility` at :1031. No `computeFanoutRecipients`, no `createNotification`,
no watcher upsert. `editTask` handles the analogous description case via
`extractNewlyMentionedIds`; the comment path has no counterpart and no test.

### B4 (blocker) — AS-396 unmet and unreachable
See the assertion row. Not a code defect — a scope gap that should be tracked as
BLOCKED-ON-F215, not closed by the `emailEnabled` persistence test.

### B5 (blocker, evidence quality) — the full suite does not run green
`npx vitest run`: **46 test files failed, 205 passed; 18 tests failed, 1561 passed, 119 skipped.**
The gap between 46 failed *files* and 18 failed *tests* is ~40 files failing on
`Hook timed out in 10000ms` in `beforeAll`/`afterAll` under full-suite contention against the
live Supabase project. I confirmed this is contention, not defect: `task-activity-feed.test.ts`,
`notification-fanout.test.ts`, `edit-comment.test.ts` → 19/19 pass in isolation;
`recurrence-scheduled-generation-activity.test.ts` → 2/2 pass in isolation.

That is still a blocker for evidence quality, not a nit. When a hook times out, vitest reports
the file's tests as **skipped, not failed** — so in the canonical `npm test` run the primary
end-to-end evidence for AS-358, AS-359 (feed level), AS-360, AS-374, AS-375, AS-380, AS-381,
AS-382 and AS-384 silently does not execute. A future regression in any of them would be
invisible to CI. `edit-comment.test.ts` also leaves fixture users/comments behind in the real
project when its `afterAll` times out. Additionally, `f306-mutation-fanout.test.ts` and
`overdue-notification-sweep.test.ts` use bare `describe.skipIf(!haveAdminCreds)` with no CI
guard, so they would vanish silently in a credential-less CI.

## Major findings (assertion met but fragile)

- **M1 — Activity fan-out gaps.** `bulkRestoreTasks`, `bulkDeleteTasks`, `deleteTask`,
  `duplicateTask`, `updateTaskTags`, `promoteSubtask`, `reorderTask`, `restoreComment` write no
  activity entry. Single-task `restoreTask` does, so bulk-restore is an inconsistency rather
  than a rule. `restoreComment`'s omission is user-visible: after an undo the feed permanently
  says the comment was deleted while it is visibly back.
- **M2 — Watcher notification scope (AS-294).** Only status change and new comment notify.
- **M3 — Activity writes fail silently by design.** Every write is `try/catch` + `console.error`,
  plus `exception when others` in the SQL cron. A failing RPC yields a permanently incomplete
  audit trail with no user- or operator-visible signal.
- **M4 — Notification UPDATE policy is not column-scoped.** `notifications_update_own` permits
  updating any column of one's own row, including `created_at` (which could resurrect a row
  past the retention cutoff) and `payload`. The SQL comment claims it is "only for marking
  read/unread"; it does not enforce that.
- **M5 — `getMentionCandidates` has no error handling.** `lib/actions/comments.ts:1218` does not
  wrap `resolveVisibleMentionIds`, so `MentionVisibilityCheckError` rejects the Server Action
  and the client `.then()` has no `.catch()` → unhandled rejection, `visibleMentionIds` stuck
  at `null`. Fails closed, but noisily.
- **M6 — Mention rejection is silent.** Non-visible mentions are rewritten to "@Former member"
  with no feedback to the author.

## Minor findings

- `extractPlainText` is called server-side without a `resolveLabel` (`comments.ts:214`, `:1053`),
  so a mention-only comment persists `text`/`body_text` as `@<raw-uuid>` — that column feeds
  search and notification previews, leaking user ids into plain text.
- Activity ordering has no tiebreaker (`created_at desc` only); same-transaction entries can
  render non-deterministically and shift across "Load more" pages.
- AS-360's "System generated this task from a recurring series" label is a heuristic
  (`actorLabel === null && !oldDate` on a `due_date` entry), not a distinct kind.
- Overdue sweep: `due_date <= today` fires on the due date itself; the `notification_preferences`
  INNER join silently excludes users with no preferences row.
- `reactorNames` falls back to a raw UUID for a reactor no longer in `members`.
- Stale-closure risk in `use-notifications-realtime.ts:48` (deps `[userId]`, `exhaustive-deps`
  disabled, `onInsert` closes over `workspaceId`); safe only because a workspace switch remounts.
- `markAllNotificationsRead` is not retention-bounded.
- `subscribeToReactionsRealtime`'s doc comment (112-116) claims `REPLICA IDENTITY FULL` is
  unnecessary; the later migration sets it precisely because it is.
- Stale policy name in doc comments: `task_activity_select_visible` vs the actual
  `task_activity_select_visible_task`.
- `writeTaskCommentEvent` passes `undefined` (relying on PostgREST key omission) where
  `writeTaskFieldChanges` uses an explicit `?? null`.
- 2 pre-existing lint warnings (unused `_titleMatches`, `_columns`).

## Recommended follow-up features

**FU-A — Make the mention extension react to asynchronously-loaded suggestions (blocker; AS-371, AS-372, AS-373, AS-376, AS-378).**
Fix the frozen-closure bug in `components/editor/rich-text-editor.tsx`. Back `getMentionItems`
with a ref that is kept current by an effect (`mentionItemsRef.current = mentionSuggestions`)
so the plugin reads live data instead of the mount-time array, and — separately, because the ref
alone does not fix rendering — force the read-only `RichTextRenderer` to repaint when
suggestions arrive, since ProseMirror will not redraw unchanged mention nodes (bump a `key`,
or dispatch a no-op transaction / re-`setContent` when the suggestion identity changes).
Alternatively resolve `getMentionCandidates` before mounting the editor. Delete the false
comment at `rich-text-editor.tsx:353-359`. Coverage must include at least one test that mounts
the **real** editor with an initially-empty suggestion list, populates it asynchronously, then
drives the suggestion plugin by typing `@` and asserts the picker lists the member and that a
persisted mention node repaints from "@Former member" to the real chip — the existing three
mention tests all pre-populate suggestions and cannot catch this.

**FU-B — Close the `create_notification` `p_system` forgery bypass (blocker; AS-384, AS-389).**
Add a migration changing `if p_system then` to `if p_system and auth.uid() is null then` in
`public.create_notification`, mirroring `20260823060000`'s fix to `write_task_activity_entry`,
so an `authenticated` caller claiming `p_system => true` falls through to the normal
caller-membership and actor-pinning checks. Confirm the legitimate service-role callers (the
overdue sweep and any future cron) run with no user JWT and are unaffected. Add a negative
integration test that signs in a real non-member user, calls the RPC directly with
`p_system: true` against another workspace's member, and asserts the call raises and no row
lands — the current suite has no such test, which is why the hole survived one full scrutiny pass.

**FU-C — Fan out notifications from `editComment` (blocker; AS-381, AS-374, AS-375).**
`editComment` currently sanitises mentions and writes `body_json` with no fan-out at all. Mirror
`editTask`'s `extractNewlyMentionedIds` approach: diff the pre-edit and post-edit sanitised
mention id sets, notify only the newly-added ids (never re-notifying someone already mentioned
in the original), pass the comment id so the notification deep-links to the comment, promote the
newly-mentioned to watchers, and exclude the editing user. Add a real-DB test that posts a
comment with no mentions, edits it to add one, and asserts exactly one notification with the
correct `comment_id` plus a watcher row.

**FU-D — Stabilise the integration suite so `npm test` is meaningful (blocker; evidence quality).**
~40 test files currently fail on `Hook timed out in 10000ms` under full-suite contention against
the live Supabase project, and vitest reports their tests as *skipped* rather than failed, so a
regression in the affected assertions would pass CI unnoticed. Raise `hookTimeout` in
`vitest.config.ts` to a realistic value for real-network fixtures, and/or cap concurrency for
`tests/integration/**`, and batch the per-test fixture teardown that is timing out (notably
`edit-comment.test.ts`'s `afterAll`, which also leaks fixture rows into the real project when it
times out). Replace bare `describe.skipIf(!haveAdminCreds)` in `f306-mutation-fanout.test.ts` and
`overdue-notification-sweep.test.ts` with the throwing CI guard `notification-fanout.test.ts`
already uses, so missing credentials fail loudly instead of silently skipping. Definition of
done: a single `npx vitest run` reports 0 failed files attributable to hook timeouts.

**FU-E — Close the activity and watcher-notification fan-out gaps (major; AS-294, AS-353, AS-356).**
Add activity writes to the mutation paths that currently write none — `bulkRestoreTasks`,
`bulkDeleteTasks`, `deleteTask`, `duplicateTask`, `updateTaskTags`, `promoteSubtask`,
`reorderTask` — matching the entries single-task `restoreTask` already writes, and add a
`comment_restored` entry to `restoreComment` so an undone deletion stops showing as deleted
forever. Separately, widen watcher fan-out beyond status-change-and-comment so that the field
edits `diffTaskFields` already records (title, priority, due date, estimate, assignee) also
notify watchers, with the actor excluded and preference gating applied as elsewhere. Decide and
document explicitly whether bulk operations emit one entry per task or a single batch entry, so
the current bulk-vs-single inconsistency becomes a stated rule rather than an oversight.

**FU-F — Quality cleanup (minor).**
`getMentionCandidates` should catch `MentionVisibilityCheckError` and return the standard
`{ok:false}` shape, with the client attaching a `.catch()`. Thread `resolveLabel` into the two
server-side `extractPlainText` call sites so `text`/`body_text` never persist a raw UUID.
Column-scope `notifications_update_own` to `read_at` only. Add an `id` tiebreaker to the activity
feed ordering. Fix the overdue sweep's `due_date <= today` off-by-one and its INNER join on
`notification_preferences` (align with the TS fail-open policy). Fall back to email/initials
rather than a raw UUID in `reactorNames`. Correct the stale comments in
`subscribe-comments-realtime.ts:112-116` and the `task_activity_select_visible` policy-name
references. Clear the two pre-existing lint warnings.

**FU-G — AS-396 bookkeeping (blocked).**
No code change. AS-396 stays FAIL/BLOCKED-ON-F213–F217 until Resend is connected and a sender
exists; then flip `EMAIL_NOTIFICATIONS_ENABLED` and validate the full "turn off → receives none"
behaviour end to end. Do not close it on the `emailEnabled` persistence test.

---

# Appendix: full tooling output

## `npx tsc --noEmit`

Clean — no output, exit 0.

## `npx eslint .`

```
/Users/sasajapranin/Desktop/pm-app/lib/queries/search.ts
  232:27  warning  '_titleMatches' is defined but never used  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/tests/unit/invite-member-pagination.test.ts
  186:22  warning  '_columns' is defined but never used  @typescript-eslint/no-unused-vars

✖ 2 problems (0 errors, 2 warnings)
```

## `npx vitest run` (full suite)

```
 FAIL  tests/integration/recurrence-scheduled-generation-activity.test.ts > generate_due_recurring_occurrences task_activity write (F195 follow-up: AS-360) > AS-360: the scheduled SQL generator writes a system-attributed task_activity entry for the new occurrence
 FAIL  tests/integration/recurrence-scheduled-generation.test.ts > generate_due_recurring_occurrences (F178: AS-322) > AS-322: calling the function twice for the same due task does not create two occurrences
 FAIL  tests/integration/workspace-role-expansion.test.ts > workspace role expansion (F126) > AS-238: an invite specifies the role granted on acceptance > AS-238: inviting with role 'admin' creates an invited row that grants that role
 FAIL  tests/integration/workspace-role-expansion.test.ts > workspace role expansion (F126) > AS-238: an invite specifies the role granted on acceptance > AS-238: inviting with role 'member' creates an invited row that grants that role
 FAIL  tests/integration/workspace-role-expansion.test.ts > workspace role expansion (F126) > AS-238: an invite specifies the role granted on acceptance > AS-238: inviting with role 'viewer' creates an invited row that grants that role
 FAIL  tests/integration/workspace-role-expansion.test.ts > workspace role expansion (F126) > AS-238: an invite specifies the role granted on acceptance > AS-238: omitting the role defaults the invite to 'member' (backward compatible)
 FAIL  tests/integration/workspace-role-expansion.test.ts > workspace role expansion (F126) > AS-238: an invite specifies the role granted on acceptance > AS-238: the granted role survives acceptance — activation only flips status/user_id

⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯
Error: `cookies` was called outside a request scope.
 ❯ createClient lib/supabase/server.ts:10:29
 ❯ getMentionCandidates lib/actions/comments.ts:1157:26
 ❯ components/task/comment-list.tsx:283:5
This error originated in "tests/unit/user-avatar.test.tsx"

 Test Files  46 failed | 205 passed (251)
      Tests  18 failed | 1561 passed | 119 skipped (1698)
     Errors  1 error
   Duration  510.99s
```

(The remaining ~40 failed files are `Hook timed out in 10000ms` in `beforeAll`/`afterAll` under
contention; their tests are reported as *skipped*, not failed. See B5.)

## Isolation re-runs (contention control)

```
$ npx vitest run tests/integration/task-activity-feed.test.ts \
                 tests/integration/notification-fanout.test.ts \
                 tests/integration/edit-comment.test.ts
 Test Files  3 passed (3)
      Tests  19 passed (19)

$ npx vitest run tests/integration/recurrence-scheduled-generation-activity.test.ts
 Test Files  1 passed (1)
      Tests  2 passed (2)
```
