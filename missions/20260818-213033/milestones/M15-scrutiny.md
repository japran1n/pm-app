# M15 — Scrutiny validation (Collaboration: activity, comments, reactions, mentions, notifications)

Validator: scrutiny-validator (adversarial, read-only). Date: 2026-08-23.
Mission: 20260818-213033. Features in scope: F194–F212 (+ three follow-ups).
F213–F217 are `[SKIPPED]` (Resend not connected, user decision 2026-08-18); their
assertions AS-393, AS-394, AS-395, AS-397–AS-402 are OUT OF SCOPE and not judged here.

## VERDICT: **FAIL** — do not advance to the UX validator.

11 assertions FAIL, 2 INCONCLUSIVE, 28 PASS. Nine of the failures are `blocker`.
There is also a live, deterministic test regression on `main` (3 red tests) and a
**security hole** (activity-entry forgery) that no assertion covers.

---

## Assertion results

| ID | Verdict | Reason |
|---|---|---|
| AS-294 | FAIL (blocker) | Watcher fan-out exists only in `moveTaskStatus`/`addComment`; `moveAndReorderTask` (board drag — the dominant status path) and `bulkUpdateTasks` change status with zero fan-out. |
| AS-353 | FAIL (blocker) | Feed renders, but several mutation paths write no entry, so a task's feed silently omits changes that happened. See AS-355. |
| AS-354 | PASS | `actor_id` pinned to `auth.uid()` inside the SECURITY DEFINER RPC; asserted against real rows, not a spy. |
| AS-355 | FAIL (blocker) | No activity entry from `moveAndReorderTask` (drag), `restoreTask`, or non-mirror assignee add/remove. Separately, assignee entries always render "from someone to someone" because `ActivityFeed` never passes `resolveAssigneeLabel` — old/new stored but never shown. |
| AS-356 | PASS | Comment add/delete write to the same table; proven with real rows of both kinds. |
| AS-357 | PASS | No UPDATE/DELETE policy; real member-session UPDATE/DELETE affect 0 rows and the row is re-read unchanged. (But see the forgery hole below — entries are immutable yet forgeable.) |
| AS-358 | PASS | `created_at desc` + `limit+1` sentinel + Load more, proven against real rows. `limit` is unvalidated (minor). |
| AS-359 | PASS | SELECT gated on `is_task_visible_to`; anon and outsider both get `[]` with real sessions. |
| AS-360 | PASS | `p_system => true` ⇒ `actor_id null`; test asserts null and explicitly `!== memberUserId`. |
| AS-361 | INCONCLUSIVE (major) | Day grouping is real and TZ-correct, but per-entry timestamps are absolute ("10:32 AM"), not relative. The source file re-interprets the assertion rather than implementing it. |
| AS-362 | PASS | Author-only edit with re-checked authorship + membership + canWrite; real-session integration test. |
| AS-363 | FAIL (blocker) | `getTaskDetail` selects `id, task_id, user_id, text, created_at` — **never `edited_at`**. The "(edited)" marker survives only within the posting session; it vanishes on reload. The unit test passes `editedAt` in as a prop, so it mirrors the component and cannot catch this. |
| AS-364 | FAIL (blocker) | The BEFORE UPDATE trigger compares `auth.uid()` to `old.user_id` only and never guards `new.user_id`. A workspace admin can, via two direct API calls, first set `user_id` to themselves then rewrite the body — editing another user's words. It also never guards `edited_at`. No test covers this. |
| AS-365 | FAIL (blocker) | **Nothing reads `comment_reactions`.** `getTaskDetail` does not fetch reactions; `comment.reactions` is always `undefined` on load. A reaction persists in the DB but disappears from the UI on next load. |
| AS-366 | FAIL (blocker) | Same root cause — no data to render. Names are resolved correctly when data exists, but a reactor no longer in `members` renders as a raw UUID. The only test exercises the pure `applyReactionToggle` reducer and never asserts a rendered count or name. |
| AS-367 | PASS | Insert → catch 23505 → delete, scoped to own row by RLS; real integration tests. The concurrency test (`toBeLessThanOrEqual(1)`) is weak but the primary cases are solid. |
| AS-368 | PASS | Real composite primary key `(comment_id, user_id, emoji)` — a DB constraint, not an app check. |
| AS-369 | INCONCLUSIVE (major) | Transport is real (INSERT+DELETE, independent subscriber client in the integration test), but: no `filter` on the subscription, and Supabase does not apply RLS to DELETE payloads — so any authenticated subscriber receives `comment_id`/`user_id`/`emoji` for un-reacts on comments they cannot see (cross-tenant leak). Also self-events are dropped, so a second tab never syncs. And with AS-365 broken, "live" only ever builds on an empty baseline. |
| AS-370 | FAIL (blocker) | The `on delete cascade` FK is real, but **the app never hard-deletes comments** — `deleteComment` sets `deleted_at`, so the cascade never fires in production. Worse, `comment_reactions_select_visible` omits the `deleted_at is null` predicate the comments policy has, so reactions on a soft-deleted comment stay readable via direct PostgREST and stay in the realtime stream. The test proves a code path the app does not use. |
| AS-371 | PASS | Server-derived candidates via `getMentionCandidates`; client only intersects ids. Minor: async load race shows "No matching members" briefly, untested. |
| AS-372 | PASS | `filterMentionItems` tested. Doc comment claims name-or-email matching; code matches label only (minor). |
| AS-373 | FAIL (major) | Chip rendering is correct, but `extractPlainText` ignores `mention` nodes, so a comment consisting only of `@Alice` projects to `""` — Post is disabled and the server schema would reject it. The most natural mention use case cannot be posted. Mentions are also absent from `body_text`, so they are not searchable. |
| AS-374 | FAIL (blocker) | The DB row carries `comment_id`, but the read path drops it: `lib/queries/notifications.ts` never selects it and the panel builds `href` from the task alone. The user lands on the board with **no anchor to the comment**. |
| AS-375 | PASS | `ignoreDuplicates` upsert on both comment and description paths; asserted against a real `task_watchers` row. |
| AS-376 | FAIL (major) | Visibility is correctly re-derived server-side and an arbitrary id cannot be persisted — but the write **silently strips** to the literal `"@Former member"` and returns `ok: true`. "Rejected if forced" is not met. Compounding this: `resolveVisibleMentionIds` ignores the `error` field on two queries, so a transient DB failure yields `data: null` ⇒ *every* mention in that write is silently rewritten to `"@Former member"` and permanently persisted. Untested. |
| AS-377 | PASS | `resolveMentionDisplay` falls back to plain text with no `data-id` and no raw UUID, in both comments and descriptions. |
| AS-378 | PASS | Wired end-to-end (picker → server sanitise → `description_json` → trigger three-way branch → render), integration-proven including the "next unrelated write survives" case. Residual: the legacy plain-text `description` column is stale and any writer touching it destroys every mention. |
| AS-379 | PASS | Badge from a real count query, `>99` clamped. Note the bell is mounted in the **sidebar**, not the app header, as the assertion words it. |
| AS-380 | FAIL (blocker) | Only `setTaskAssigneesCore` fans out. `createTask` with an assignee, `bulkUpdateTasks`, and `duplicateTask` all write `assignee_id` with no notification. |
| AS-381 | PASS | Both comment and description mention paths, using the visibility-sanitised set. |
| AS-382 | FAIL (blocker) | Same gap as AS-294. Also no integration test asserts a `comment_reply` watcher row ever lands — the integration test filters `kind = 'mention'` only. |
| AS-383 | PASS (fragile, major) | Real `cron.schedule('notify-overdue-task-assignees', '0 * * * *', ...)`, deduped by a partial unique index, assignees only. But **no test would fail if the schedule were deleted** — all 7 tests call the function by hand and nothing queries `cron.job`. Also the sweep INNER JOINs `notification_preferences`, so any assignee lacking a prefs row never gets an overdue notification — the opposite default from the app layer's documented fail-open. |
| AS-384 | PASS | Actor exclusion centralised in `computeFanoutRecipients`; every implemented fan-out site routes through it. No self-notifying path found. |
| AS-385 | PASS | `created_at desc`, actor/action/task all rendered. |
| AS-386 | PASS | Server-side mark-read; ownership enforced by RLS and proven by a real cross-user integration test. Gap: the deep link only opens the sheet if the task is in the board's already-loaded array — a filtered-out task silently opens nothing. Untested. |
| AS-387 | PASS | Mark-all + cross-user negative test. |
| AS-388 | PASS | Subscription filtered `user_id=eq.<me>`; count is refetched from a server snapshot, never incremented from the payload, so double-count on reconnect is structurally impossible. Best-engineered piece of this milestone. |
| AS-389 | PASS | `user_id = auth.uid()` SELECT policy; the spoofing-fix migration drops the old 7-arg overload (no vulnerable signature left live) and pins `actor_id`. Tests use real anon/authenticated PostgREST sessions, not service-role. |
| AS-390 | PASS | Soft-delete, hard-delete and RLS-invisible all unified to a degraded non-clickable "a deleted task"; excluded from the unread count; both cases proven against the real DB. |
| AS-391 | FAIL (major) | The UI exposes 11 controls; the shared filter map covers 4. `task_due_soon` is gated by duplicated SQL in a different subsystem, and **the 5 `*_email` toggles are read by nothing**. A user unchecking "Mentions → Email" gets a success toast and a row no code path consults. 5 of 11 controls are inert. |
| AS-392 | PASS | Retention lives in exactly one place — the SELECT policy's `created_at >= now() - interval '30 days'` — so it applies to the count as well as the list. No duplicated magic number. |
| AS-396 | FAIL (blocker) | The preference is **stored only**. No email sender exists (F213–F217 skipped). "Receives none" is vacuously true because nobody receives any email under any setting. The only test asserts a boolean round-trips; no test could distinguish a working kill switch from a nonexistent feature. This assertion is not satisfiable in M15 and must not be marked green. |

Totals: **28 PASS, 11 FAIL, 2 INCONCLUSIVE.**

---

## Cross-cutting defects

### D1 — Activity-entry forgery (SECURITY, blocker, no assertion covers it)
`write_task_activity_entry` is `grant execute ... to authenticated` and takes a
**caller-supplied `p_system boolean`**. When `p_system` is true the function skips *both*
the `auth.uid()` check and the `is_task_visible_to(p_task_id)` check; the only remaining
check is that the task exists. **Any authenticated user can inject arbitrary
system-attributed activity rows onto any task in any workspace, including tasks they
cannot see.** The RLS test only exercises the non-system path, so it passes with the hole
open. AS-357 (entries are immutable) is technically satisfied while the audit log is
freely forgeable — exactly the failure mode where a passing test gives false assurance.

### D2 — Notifications silently vanish (blocker)
Three of four fan-out sites call `await supabase.rpc("create_notification", {...})`
**without destructuring `error`**. supabase-js resolves rather than throws on RPC error, so
the surrounding try/catch never fires and nothing is even logged. Any rejected RPC
(membership check, `kind` CHECK, unique index) means the notification is never sent and
never observed. Affects `tasks.ts` (assignment), `tasks.ts` (status), `comments.ts`
(comment). Only the mentions path checks `error`.

### D3 — The missing read-path pattern (blocker)
`getTaskDetail` selects `id, task_id, user_id, text, created_at` and nothing else. This
single line is the root cause of AS-363, AS-365, and AS-366 all failing: `edited_at`,
`body_json`, and reactions are all unloaded. Each of those features works perfectly within
one uninterrupted client session and silently reverts on reload. This is a textbook
recurrence of the "built but not wired to real data" pattern the mission's own
NEXT-SESSION.md warns about at item 1 — and the tests did not catch it because every one of
them supplies the data as a prop or a hand-built array.

### D4 — Live test regression on `main` (blocker)
`tests/unit/description-mentions.test.ts` has **3 failing tests right now**, deterministic
and reproducible in isolation:
`TypeError: client.from(...).select is not a function` at `lib/notifications/preferences.ts:75`.
F211 inserted `filterRecipientsByInAppPreference` into `notifyNewlyMentionedUsers` and never
updated that file's hand-rolled fake admin client (which implements only `from().upsert`).
So the coverage for **AS-374, AS-375, AS-381 and AS-384** in that file is red, not green.
This also exposes a code gap: `filterRecipientsByInAppPreference` is called outside any
try/catch inside `notifyNewlyMentionedUsers` despite the doc comment promising it "never
throws" — it survives only because `editTask` wraps the call, at the cost of silently
dropping the entire notification + watcher-promotion side effect.

### D5 — Mass mention corruption on a transient DB error (blocker)
`resolveVisibleMentionIds` destructures only `data` on two queries and ignores `error`. A
transient failure yields `data: null` ⇒ every mention id is judged invisible ⇒ every mention
in that write is rewritten to the literal string `"@Former member"` and **permanently frozen
into the stored document and `body_text`**. There is no test for the query-error path, and
the test file's hand-rolled query builder can never return `{ error }`.

### D6 — Stale generated types
`database.types.ts` still describes the **7-arg** `create_notification` — no `p_system` —
so types were never regenerated after the spoofing-fix migration. Separately, the
`notification_preferences` types were **hand-written** because `supabase gen types` could
not reach the project; they happen to match the migration today (verified column by column),
but this is a standing drift hazard.

### D7 — Swallowed errors that impersonate legitimate empty states
Repeated across the milestone: a failed fetch is indistinguishable from "nothing here."
`getTaskActivityPage` error ⇒ `{rows: [], hasMore: false}` ⇒ UI renders "No activity yet"
(the component's own `error` branch is unreachable for query errors).
`lib/queries/notifications.ts` fetch error ⇒ `{list: [], unreadCount: 0}` ⇒ the badge
silently clears; task-lookup error ⇒ every notification degrades to "a deleted task",
i.e. a transient error masquerades as correct AS-390 behaviour.
`resolveCommentAndMembership` collapses missing-comment, DB-error and deleted-comment into
one "Comment not found." without logging the error.

### D8 — Tests that mirror implementation rather than behaviour
- `tests/unit/comment-list.test.ts` supplies `editedAt` as a prop — cannot catch D3.
- `tests/unit/comment-reactions.test.ts` tests the pure reducer only; never asserts rendered output — cannot catch D3.
- `tests/unit/format-task-activity-entry.test.ts` passes a `resolveAssigneeLabel` that production never supplies — tests a capability the app does not use.
- `tests/unit/mention-picker-narrowing.test.tsx` asserts `getMentionCandidates` was called with `"task-1"` and reads a prop off a mocked editor — proves plumbing, not that anyone is shown or hidden.
- `tests/unit/notifications-realtime-subscription.test.ts` asserts the literal channel *name string* — a change-detector on internals. (The `filter` assertion in the same test is a genuine security property and worth keeping.)
- `tests/unit/notification-preferences-filter.test.ts` verifies the filter's own logic against a stub; the only end-to-end gating test covers `task_assigned` alone — mention, comment_reply and watcher_update gating is untested.
- `tests/integration/comment-reactions-schema.test.ts` hard-deletes via the admin client to prove AS-370 — a code path the app never takes.
- `tests/integration/overdue-notification-sweep.test.ts` calls the function by hand in all 7 tests; deleting the cron schedule breaks nothing.

### D9 — Untested paths, enumerated
No test anywhere exercises `moveAndReorderTask`, `bulkUpdateTasks`, `createTask`-with-assignee,
`duplicateTask`, or `restoreTask` for either activity writes or notification fan-out — precisely
the paths found to be missing both.

---

## Recommended follow-up features

**FU-1 — Load comment metadata and reactions in the task-detail read path (blocker).**
`getTaskDetail` currently selects `id, task_id, user_id, text, created_at` for comments,
which is why the edited marker, rich-text body, and every reaction vanish on reload. Extend
that query to select `edited_at` and `body_json`, and add a batched fetch of
`comment_reactions` for the task's comments (grouped by comment and emoji, with reactor ids),
threading the result into `TaskComment.reactions` and `TaskComment.editedAt`. Then add tests
that *render* `CommentList` from a real `getTaskDetail`-shaped payload — asserting the
"(edited)" marker and a reaction chip with its count and reactor names appear from loaded
data, not from props handed in by the test. This closes AS-363, AS-365 and AS-366 together.

**FU-2 — Close the activity-entry forgery hole (blocker, security).**
`write_task_activity_entry`'s `p_system` parameter is caller-controlled and, when true,
bypasses both the actor check and the task-visibility check while being executable by the
`authenticated` role. Restructure so the system path is unreachable from `authenticated`:
either split into two functions (a member-only one with no `p_system`, and a
`service_role`/`postgres`-only system variant), or keep one function but reject `p_system =>
true` unless `current_user` is a privileged role, and enforce `is_task_visible_to` on the
non-system branch unconditionally. Add an RLS test proving an outsider's `p_system => true`
call on a task they cannot see is rejected and writes no row.

**FU-3 — Fan out activity and notifications from every mutation path (blocker).**
`moveAndReorderTask` (board drag), `bulkUpdateTasks`, `createTask`-with-assignee,
`duplicateTask` and `restoreTask` mutate status and/or assignee without writing an activity
entry or notifying watchers/assignees. Route all of them through the same
`diffTaskFields`/`writeTaskFieldChanges` and `computeFanoutRecipients` helpers the single-task
paths use, taking care that bulk paths batch rather than loop per row. Also fix
`setTaskAssigneesCore` to diff the full assignee set rather than only the mirror column, so
adding or removing a non-first assignee is recorded. Add integration tests that drive each of
these actions and assert real rows land in `task_activity` and `notifications`. Closes
AS-294, AS-353, AS-355, AS-380 and AS-382.

**FU-4 — Stop swallowing `create_notification` errors (blocker).**
Three fan-out call sites `await supabase.rpc("create_notification", ...)` without checking the
returned `error`, so a rejected RPC silently sends nothing and logs nothing. Introduce one
shared helper that performs the RPC, destructures `error`, logs it with the kind/recipient/task
context, and (optionally) surfaces a count of failures to the caller; convert all four sites to
it. Add a test that stubs the RPC to return an error and asserts the failure is observed rather
than swallowed.

**FU-5 — Make the comment-edit trigger guard authorship and `edited_at` (blocker, security).**
The BEFORE UPDATE trigger compares `auth.uid()` to `old.user_id` only, so a workspace admin can
reassign `user_id` to themselves in one call and rewrite the body in a second — editing another
user's words through the direct API. Extend the trigger to reject any UPDATE where `new.user_id
is distinct from old.user_id`, and to reject a change to `edited_at` or the body columns by
anyone other than the row's own author. Add integration tests for both the two-step authorship
takeover and the non-author `edited_at` stamp. Closes AS-364.

**FU-6 — Make reactions actually disappear with a soft-deleted comment (blocker).**
`AS-370` relies on an `on delete cascade` that never fires because comments are soft-deleted.
Add `and c.deleted_at is null` to `comment_reactions_select_visible` so reactions on a
soft-deleted comment stop being readable via PostgREST and stop appearing in the realtime
stream, matching the predicate the comments SELECT policy already has. Decide explicitly
whether restoring a comment should resurrect its reactions (current behaviour) and document it.
Replace the admin-hard-delete test with one that soft-deletes through `deleteComment` and
asserts a member session reads zero reaction rows.

**FU-7 — Filter and secure the reactions realtime subscription (major).**
The `comment_reactions` postgres_changes subscription has no `filter`, so every authenticated
client receives every reaction change in the database; because Supabase does not apply RLS to
DELETE payloads, un-reacts leak `comment_id`/`user_id`/`emoji` for comments the subscriber
cannot see. Scope the subscription to the current task's comment ids (or add a `task_id` column
to `comment_reactions` and filter on it), and stop dropping self-events so a user's second tab
stays in sync. Closes the AS-369 INCONCLUSIVE.

**FU-8 — Link mention notifications to the comment (blocker).**
`comment_id` is correctly stored on the notification row but never selected in
`lib/queries/notifications.ts` and never used by the panel, so "linking directly to the
comment" (AS-374) is unmet. Select `comment_id`, carry it on `NotificationListItem`, append it
to the deep-link href as an anchor/param, and have the task sheet scroll to and briefly
highlight that comment on open. While there, fix the adjacent AS-386 gap where the board deep
link silently opens nothing if the task is not in the already-loaded `tasks` array — fetch the
task by id when it is absent. Add tests for both.

**FU-9 — Repair `description-mentions.test.ts` and harden the mention error paths (blocker).**
Three tests in this file fail deterministically on `main` because F211 added a
`notification_preferences` read that the file's hand-rolled fake client does not implement,
leaving AS-374/375/381/384 coverage red. Extend the fake to support `from().select()`, and in
the same pass fix `resolveVisibleMentionIds` to destructure and handle `error` on both queries
— today a transient DB failure silently rewrites *every* mention in the write to the literal
"@Former member" and persists it. Add a test that forces a query error and asserts mentions are
left intact and the write fails loudly rather than corrupting the document.

**FU-10 — Reconcile the notification preferences UI with what is actually consulted (major).**
The preferences form exposes 11 controls but only 4 are covered by the shared in-app filter
map; `task_due_soon` is gated by duplicated SQL inside the overdue sweep, and the 5 `*_email`
toggles are read by no code at all. Add `task_due_soon` to the shared `FanoutKind` union and
`IN_APP_COLUMN_BY_KIND` (having the sweep call the shared path rather than reimplement it), and
hide or disable the entire email column and the `email_enabled` switch behind a feature flag
until F213–F217 ship — shipping controls that silently do nothing is worse than not shipping
them. Also change the sweep's INNER JOIN on `notification_preferences` to a LEFT JOIN so
assignees without a preferences row still get overdue notifications, matching the app layer's
documented fail-open default. Add end-to-end gating tests for the mention, comment_reply and
watcher_update kinds, which are currently untested.

**FU-11 — Mark AS-396 BLOCKED and remove the vacuous coverage claim (blocker, process).**
AS-396 ("a user can turn email notifications off entirely, and then receives none") cannot be
satisfied in M15: no email sender exists, so "receives none" is true regardless of the setting,
and the only test asserts a boolean round-trips. Record AS-396 as BLOCKED-on-F213–F217 in the
mission state rather than green, and re-validate it as part of the email milestone when Resend
is connected. No code change; this is a bookkeeping correction so the contract is not
falsely satisfied.

**FU-12 — Assorted correctness and quality fixes (minor/major).**
Group these into one cleanup feature: render relative timestamps in the activity feed
(AS-361 currently shows absolute times and the source file re-interprets the assertion);
pass `resolveAssigneeLabel` into `ActivityFeed` so assignee entries stop reading "from someone
to someone"; make `extractPlainText` include mention labels so a mention-only comment can be
posted and mentions become searchable (AS-373); validate the `limit` parameter in the activity
page action, which is currently unbounded and client-supplied; regenerate `database.types.ts`
so `create_notification` reflects its 8-arg `p_system` signature; replace the swallowed-error
empty returns in `getTaskActivityPage` and `lib/queries/notifications.ts` with a distinguishable
error state so a failed fetch stops rendering as "No activity yet" / a cleared badge; add a
`cron.job` assertion to the overdue-sweep test so deleting the schedule fails the suite; and
guard the `cron.schedule` call in the migration for idempotent re-application.

---

## Toolchain output

### Type-check — PASS
```
$ npx tsc --noEmit
TSC_EXIT=0
```

### Lint — PASS (2 pre-existing warnings, 0 errors)
```
$ npx eslint .

/Users/sasajapranin/Desktop/pm-app/lib/queries/search.ts
  232:27  warning  '_titleMatches' is defined but never used  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/tests/unit/invite-member-pagination.test.ts
  186:22  warning  '_columns' is defined but never used  @typescript-eslint/no-unused-vars

✖ 2 problems (0 errors, 2 warnings)
LINT_EXIT=0
```

### Targeted M15 unit tests — FAIL (deterministic, reproducible in isolation)
```
$ npx vitest run tests/unit/task-activity-diff.test.ts tests/unit/format-task-activity-entry.test.ts \
  tests/unit/comment-list.test.ts tests/unit/comment-realtime-subscription.test.ts \
  tests/unit/comment-reactions.test.ts tests/unit/reactions-realtime-subscription.test.ts \
  tests/unit/mention-extension.test.tsx tests/unit/comment-mentions.test.ts \
  tests/unit/mention-picker-narrowing.test.tsx tests/unit/description-mentions.test.ts \
  tests/unit/notification-fanout.test.ts tests/unit/notification-bell-panel.test.tsx \
  tests/unit/notifications-realtime-subscription.test.ts tests/unit/board-taskid-deeplink.test.tsx \
  tests/unit/notification-preferences-filter.test.ts

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/unit/description-mentions.test.ts > AS-378: mentions work in task descriptions as well as comments
   > test_AS_374_AS_381_notifyNewlyMentionedUsers_delivers_a_mention_notification_per_newly_mentioned_id
TypeError: client.from(...).select is not a function
 ❯ filterRecipientsByInAppPreference lib/notifications/preferences.ts:75:6
     73|   const { data, error } = await client
     74|     .from("notification_preferences")
     75|     .select(
       |      ^
     76|       "user_id, mention_in_app, task_assigned_in_app, comment_reply_in…
     77|     )
 ❯ notifyNewlyMentionedUsers lib/notifications/mentions.ts:137:28
 ❯ tests/unit/description-mentions.test.ts:122:26

 FAIL  tests/unit/description-mentions.test.ts > ... > test_AS_384_notifyNewlyMentionedUsers_never_notifies_the_author_of_their_own_mention
TypeError: client.from(...).select is not a function
 ❯ filterRecipientsByInAppPreference lib/notifications/preferences.ts:75:6
 ❯ notifyNewlyMentionedUsers lib/notifications/mentions.ts:137:28
 ❯ tests/unit/description-mentions.test.ts:147:26

 FAIL  tests/unit/description-mentions.test.ts > ... > test_AS_375_notifyNewlyMentionedUsers_promotes_each_mentioned_non_watcher_to_watcher
TypeError: client.from(...).select is not a function
 ❯ filterRecipientsByInAppPreference lib/notifications/preferences.ts:75:6
 ❯ notifyNewlyMentionedUsers lib/notifications/mentions.ts:137:28
 ❯ tests/unit/description-mentions.test.ts:166:11

 Test Files  1 failed | 14 passed (15)
      Tests  3 failed | 147 passed (150)
   Duration  2.34s
```

### Full suite — INCONCLUSIVE (environment-degraded)
```
$ npm run test

 Test Files  143 failed | 101 passed (244)
      Tests  61 failed | 886 passed | 707 skipped (1654)
```
Observed failure causes in the captured output:
```
   5 × Error: Test timed out in 30000ms.
   1 × Error: Failed to create test workspace: canceling statement due to statement timeout
   1 × Error: `cookies` was called outside a request scope.
   1 × Error: { __NEXT_ERROR_CODE: 'E251' }
```
Sample:
```
 FAIL  tests/integration/workspace-role-expansion.test.ts > workspace role expansion (F126)
   > AS-215: the original role 'admin' is still accepted (no regression from widening)
Error: Failed to create test workspace: canceling statement due to statement timeout
 ❯ createWorkspace tests/integration/workspace-role-expansion.test.ts:121:13
    119|       .single();
    120|     if (error || !workspace) {
    121|       throw new Error(`Failed to create test workspace: ${error?.messa…
       |             ^
```
The full-suite run is dominated by Supabase statement/auth timeouts under concurrent
test-user creation — the well-documented environmental flakiness recorded in
NEXT-SESSION.md item 4 — and the 143-failed-files / 61-failed-tests split (files failing
at suite level, not assertion level) is consistent with that. **This run therefore cannot
be used to certify M15 either way.** It also cannot be used to dismiss the targeted
failures above: those 3 are deterministic, reproduce in isolation in 2.3 seconds, are a
`TypeError` in production code called from a stale test double, and have nothing to do
with rate limiting.

**Recommended before re-validation:** run the suite serially (`--pool=forks
--poolOptions.forks.singleFork`) or with reduced concurrency so the integration tier
produces a trustworthy signal. The current inability to get a clean full-suite run is
itself a `major` finding — it means no one can distinguish a real regression from noise,
which is precisely how D4 reached `main` unnoticed.
