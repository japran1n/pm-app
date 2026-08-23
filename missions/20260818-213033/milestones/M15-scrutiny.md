# M15 scrutiny — pass 6 (FINAL)

**Mission:** 20260818-213033
**Milestone:** M15 — Collaboration: activity, comments, mentions, notifications, email
**Date:** 2026-08-23
**Verdict:** **FAIL — 1 blocker inside M15's assertion set.**

**Trend across passes:** 11 FAIL / 9 blockers → 7/5 → 5/3 → 3/2 → 4/2 → **10 FAIL / 1 blocker**.
The FAIL count rose because this pass probed harder (four parallel reviewers plus my own
verification), not because anything regressed. Only one finding clears the blocker bar the
mission owner set for this pass.

**Scope cap acknowledged.** Per the 2026-08-23 user decision recorded in the run-log, only
BLOCKER-severity findings will be acted on. Everything else is recorded below under
"Majors" / "Minors" for a future session and is deliberately NOT to be fixed now. The two
lists are kept strictly separate so the orchestrator can act on exactly the blocker set.

---

## THE BLOCKER SET (act on these; nothing else)

### B1 — AS-383 — one removed workspace member permanently kills the overdue sweep for the entire database

**Severity: blocker (assertion flatly unmet in normal use; silent, global, permanent).**
**This is the only in-M15-scope blocker.**

`public.notify_overdue_task_assignees()`
(`supabase/migrations/20260823050000_overdue_notification_sweep.sql:103-141`) is a bare
`for … loop` with `perform public.create_notification(...)` and **no exception handling**.
Its driving `SELECT` joins `tasks → projects → task_assignees → notification_preferences`
and **never joins `workspace_members`**.

`create_notification` raises unconditionally when the recipient is not an active member of
the target workspace — and that check runs first, before the `p_system`/auth branch, so the
cron's `p_system => true` does not exempt it
(`supabase/migrations/20260823110000_create_notification_task_workspace_check.sql:47-55`).

The chain, all of which I verified directly in the current code:

1. `remove_workspace_member` hard-`delete`s only the `workspace_members` row
   (`supabase/migrations/20260817234900_remove_member_atomic_owner_guard.sql:85-88`).
2. Nothing anywhere cleans up that user's `task_assignees` rows — no trigger, no cascade,
   no cleanup in `removeMember` (`grep task_assignees` across migrations and
   `lib/actions/workspaces.ts` returns no removal path).
3. `notification_preferences` is keyed on `user_id` only (not per-workspace) and a row is
   auto-created for **every** auth user by the `on_auth_user_created_notification_preferences`
   trigger with `task_due_soon_in_app boolean not null default true`
   (`supabase/migrations/20260823040000_create_notification_preferences.sql:46-104`), so the
   removed user's row survives and still satisfies the sweep's `np.task_due_soon_in_app = true`
   filter.
4. The sweep therefore selects the stale `(task, removed-user)` pair, calls
   `create_notification`, and gets `raise exception`.
5. plpgsql has no exception block, so the whole function aborts and its transaction rolls
   back — **zero notifications are delivered to anyone in that run**, not just to the removed user.
6. The `not exists (… kind = 'task_due_soon' …)` dedup gate at
   `20260823050000_overdue_notification_sweep.sql:118-124` is never satisfied for that row
   because the insert never lands, so **every subsequent hourly run fails identically, forever**,
   until someone manually deletes the orphan assignment.

Removing a workspace member is ordinary use. The failure mode is silent (a failed pg_cron
job), global (every user in the database), and permanent. AS-383 — "A user receives a
notification when a task assigned to them becomes overdue" — is flatly unmet from the first
member removal onward.

**No test covers this.** `tests/integration/overdue-notification-sweep.test.ts` never
exercises a stale assignee.

---

### B2 (OUT OF M15 SCOPE — orchestrator's call) — task-mutating Server Actions skip the private-project access check

**Severity: blocker-class security (unauthorized write / privilege escalation).**
**Belongs to AS-227 / AS-228 (M12 project visibility), NOT to any M15 assertion.**
Listed here because the pass-6 bar explicitly names "unauthorized access, privilege
escalation" as blocker-class; flagged separately so the orchestrator can decide whether it
falls inside this capped cycle. It is not counted in M15's blocker total.

`editTask`, `moveTaskStatus`, `moveAndReorderTask`, `assignTask`/`setTaskAssigneesCore` and
`deleteTask` in `lib/actions/tasks.ts` all mutate through the **service-role admin client**
(RLS bypassed) after gating on only `requireActiveMembership(admin, workspaceId, user.id)`
plus a role predicate. Verified at `lib/actions/tasks.ts:2444-2472` (`moveTaskStatus`) and
`:1223-1249` (`editTask` — which fetches `projects.visibility` at `:1203` but uses it
*only* for mention sanitisation at `:1281`, never for authorization).

By contrast `bulkUpdateTasks` (`:4468-4512`) and `bulkDeleteTasks` (`:4828-4870`) *do*
enforce it:

```
if (context.visibility === "private" && role !== "owner" && role !== "admin"
    && !explicitMemberProjectIds.has(context.projectId)) { … reject … }
```

So a plain workspace member who is not on a private project can edit, move, reassign and
delete that project's tasks through the single-task actions, but not through the bulk
toolbar. The most plausible exploit is a user removed from a private project who still
knows its task ids.

`tests/integration/rls-project-visibility.test.ts` gives a false sense of safety: every
AS-226/227/228 case there queries the database **directly under the outsider's own RLS
session** (correctly zero rows) and none of them calls a Server Action, which is precisely
the layer that bypasses RLS. Textbook "test covers the layer that isn't the risk."

---

## Assertion table

| ID | Verdict | Reason |
|---|---|---|
| AS-294 | FAIL | `editTask` fan-out (F319) verified genuinely working, but bulk priority/due-date edits, assignee changes and `restoreTask` are activity-logged yet notify no watcher |
| AS-353 | PASS | Feed is chronological and wired on every legitimate path; the one silent-miss path is reachable only via B2 |
| AS-354 | PASS | `actor_id` pinned to `auth.uid()` server-side, `created_at` defaults to `now()` |
| AS-355 | PASS | All six fields diffed with old→new; assignee reassign splits into two entries (major) |
| AS-356 | PASS | `addComment`/`deleteComment` both write; `restoreComment` writes no counter-entry (major) |
| AS-357 | PASS | No UPDATE/DELETE policy exists and RLS-proven zero-row; arbitrary self-attributed row *injection* is still possible (major) |
| AS-358 | FAIL | F320's own honesty notice is factually wrong — "Showing the first 200" while the query returns the 200 *most recent*; untested string |
| AS-359 | PASS | Enforced by RLS (`is_task_visible_to`) on the session-bound client; private-project branch untested (major) |
| AS-360 | PASS | `p_system` exemption requires `auth.uid() is null`; both recurrence callers are genuine service-role. Negative-case test could not execute this run (env) |
| AS-361 | PASS | Day-bucketed in the viewer's IANA zone, relative timestamps with absolute `title` |
| AS-362 | PASS | Author-only gate plus writable-membership re-check, real-DB proof |
| AS-363 | FAIL | `edited_at` is set by the Server Action, not a trigger — the author can rewrite their own comment via PostgREST with no marker, or forge the timestamp |
| AS-364 | PASS | DB-enforced against non-authors (RLS) *and* admins (trigger), incl. the `user_id`-reassign takeover; strongest area in M15 |
| AS-365 | PASS | Self-only insert + task-visibility + task_id-match RLS; emoji allow-list byte-identical to the CHECK |
| AS-366 | FAIL | Editing or restoring a comment blanks its reactions live for every other viewer; reactor names degrade to raw UUIDs; zero UI tests |
| AS-367 | PASS | Insert-first / 23505 → delete convergence, concurrent double-click proven |
| AS-368 | PASS | Real composite PK `(comment_id, user_id, emoji)`; un-react is a hard delete, so no tombstone hazard |
| AS-369 | PASS | Server-side `task_id` filter on both events, `REPLICA IDENTITY FULL` set, cross-task negative proven over the wire; passed cleanly this run. DELETE delivery untested (major) |
| AS-370 | PASS | SELECT policy requires `c.deleted_at is null`; hard purge cascades |
| AS-371 | PASS | Real Suggestion-plugin coverage; Escape fails to dismiss the picker (major) |
| AS-372 | PASS | Live listbox narrowing driven by genuine ProseMirror transactions |
| AS-373 | PASS | id-only attrs, label resolved live at render; transient "@Former member" flash (major) |
| AS-374 | PASS | `comment_id` stored, selected and appended to the deep link; consumed by the scroll/highlight |
| AS-375 | PASS | `ignoreDuplicates` upsert on the raw mentioned set in all three mention paths |
| AS-376 | PASS | Picker narrowing and write-time strip share one predicate; enforced on every client-supplied write path. Two fail-open/disclosure gaps remain (majors) |
| AS-377 | PASS | Unresolvable id → muted `data-type="mention-unresolved"` span, no `data-id`, no throw, no name leak |
| AS-378 | PASS | **F318's fix independently confirmed correct** — see below |
| AS-379 | FAIL | The badge count and the panel's unread rows are computed by two different rules and provably disagree |
| AS-380 | FAIL | The extension API's create-with-assignee path fires no notification at all |
| AS-381 | PASS | Comment, comment-edit and description mention paths all fan out; stripped mentions excluded |
| AS-382 | PASS | `moveTaskStatus`, `moveAndReorderTask`, `bulkUpdateTasks` (status), `addComment` all fan out |
| **AS-383** | **FAIL** | **BLOCKER B1 — one stale assignee permanently kills the hourly sweep for everyone** |
| AS-384 | PASS | Actor exclusion is unconditional in the single shared `computeFanoutRecipients`; every call site routes through it |
| AS-385 | PASS | `order(created_at desc)`, actor/task batch-resolved, action derived from `kind` |
| AS-386 | PASS | Board deep-link with `?taskId=&commentId=`, optimistic mark-read with revert |
| AS-387 | PASS | Workspace-scoped `UPDATE … IS NULL` on the session client under self-only RLS |
| AS-388 | FAIL | Two `NotificationBell`s mount simultaneously and share one deduped Realtime channel; the second binding is silently discarded and either unmount tears down the shared channel |
| AS-389 | PASS | RLS SELECT/UPDATE self-only, no INSERT/DELETE policy, single SECURITY DEFINER write path; F320's workspace check verified sound by me |
| AS-390 | PASS | Soft-deleted/invisible → `title: null` → non-clickable; hard purge cascades the notification away |
| AS-391 | PASS | All five in-app kinds gated pre-write via exhaustive `IN_APP_COLUMN_BY_KIND` |
| AS-392 | PASS | `created_at >= now() - interval '30 days'` lives in the RLS SELECT policy, so list and count both inherit it |
| AS-393 | BLOCKED | F215 [SKIPPED] — no email sender exists |
| AS-394 | BLOCKED | F215 [SKIPPED] |
| AS-395 | BLOCKED | F214 [SKIPPED] |
| AS-396 | BLOCKED | Already-acknowledged: structurally unsatisfiable within M15, correctly recorded as BLOCKED-on-F213–F217 |
| AS-397 | BLOCKED | F216 [SKIPPED] |
| AS-398 | BLOCKED | F216 [SKIPPED] |
| AS-399 | BLOCKED | F217 [SKIPPED] |
| AS-400 | BLOCKED | F217 [SKIPPED] |
| AS-401 | BLOCKED | F213 [SKIPPED] |
| AS-402 | BLOCKED | F213 [SKIPPED] |
| AS-214 | PASS | `UserAvatar` genuinely rendered on comments and DOM-verified; primary call-site test is a source-text regex (major) |

**In-scope totals:** 41 assertions evaluated (AS-353–AS-392, AS-294, AS-214), 10 FAIL, **1 blocker**.
10 assertions BLOCKED on the user's own F213–F217 skip decision.

---

## Independent re-verification of the pass-5 fixes

I re-verified all three against the current code, not against the handoffs or the run-log.

**F318 (AS-378, data-loss) — genuinely fixed, and the fear was correctly bounded.**
I read `node_modules/@tiptap/react/dist/index.js` myself. `onRender` (`:441-460`) confirms
`setOptions` is only called when `deps.length === 0`, so with `[computedMentionSuggestionsKey]`
it always takes `refreshEditorInstance`. **But** `createEditor()` (`:316-378`) re-wraps *every*
lifecycle callback — `onBlur`, `onUpdate`, `onCreate`, `onFocus`, `onSelectionUpdate`, `onPaste`,
… — as `(...args) => this.options.current.<cb>(...args)`, reading a ref refreshed on every
render (`:509-511`). So `onChange`/`onBlur` are **never** stale across a recreation, and there is
no second data-loss path hiding behind them. What genuinely *is* frozen per instance is
`editorProps` and `extensions`; sweeping `components/editor/rich-text-editor.tsx`,
`handleKeyDown` (`:466-506`) now uses only `view` and a stable `useRef`, `handlePaste`
(`:511-519`) the same, `transformPastedHTML` (`:525`) is a pure import, and `getMentionItems`
is covered by the deps key. The description's save path is also safe by construction:
`task-detail-sheet.tsx:1218-1221` binds `content={descriptionJson}` to local state fed by
`onChange={setDescriptionJson}`, so a recreation cannot discard typed text. The regression test
(`tests/unit/rich-text-editor.test.tsx:200-248`) asserts no-throw **and** `onBlur` fired **and**
the buffer content survived — real behavioural proof, not a smoke test.

**F319 (AS-294) — real, correctly gated, but incomplete.**
`lib/actions/tasks.ts:1426-1466` fires on `changes.length > 0` from a genuine before/after diff,
excludes the actor via `computeFanoutRecipients`, filters by preference, computes recipients once
per edit (a 3-field edit sends 1 notification, not 3), and cannot fail the mutation. Confirmed
working. It does not close AS-294 because bulk priority/due-date edits, assignee changes and
`restoreTask` still notify nobody — see the AS-294 major below.

**F320 — three of four items land; one is factually wrong and one is incomplete.**
- AS-389: the migration is sound. I read it in full. `security definer`, `set search_path = public`,
  every relation schema-qualified (no temp-schema shadowing), `revoke all from public`, and
  `20260823030000:57` `drop function`s the old 7-arg signature so there is no callable vulnerable
  overload. `p_actor_id` is ignored and overwritten with `auth.uid()`; `p_system` only exempts when
  `auth.uid() is null`. **Verified good.**
- AS-376: `createProjectFromTemplate`'s retry-then-`stripAllMentions` chain
  (`lib/actions/templates.ts:1176-1237`) is correct for a per-task check failure — but if the task
  **re-fetch** itself errors (`:1138-1143`) the entire sanitisation pass is skipped and every task
  keeps its unsanitised `description_json`. The "leaves an unsanitised document persisted" case is
  narrowed, not closed. Major.
- AS-358: the honesty fix is itself dishonest. `components/task/activity-feed.tsx:293` renders
  **"Showing the first 200 activity items."** while `lib/queries/task-activity.ts:131-135` orders
  `created_at desc` and returns the **200 most recent**. The `hasMore`/`cappedAtMax` split is
  logically correct and the growing-window refetch cannot skip or duplicate rows; only the copy is
  wrong, and no test asserts the string.
- AS-369: `tests/integration/reaction-realtime-delivery.test.ts` passed cleanly in this full-suite
  run. The worker's honest disclosure that it may still be intermittent stands unrefuted either way.

---

## Majors — recorded for a future session, NOT to be fixed in this cycle

1. **AS-388 — duplicate `NotificationBell` mounts share one deduped Realtime channel.**
   `components/nav/app-sidebar.tsx:137` (desktop `<aside>`, `hidden md:flex` — CSS-hidden but still
   mounted) and `:291` (mobile bar) both mount a bell. `lib/supabase/client.ts` uses a
   `createBrowserClient` singleton, and I confirmed in `realtime-js` that
   `RealtimeClient.channel(topic)` returns the **existing** channel for a duplicate topic
   (`RealtimeClient.js:330-342`) and `RealtimeChannel._on` **silently discards** an identical
   `postgres_changes` binding (`RealtimeChannel.js:647-653`). Consequences: the mobile-visible bell
   never receives inserts, and `removeChannel` on *either* bell's unmount tears down the shared
   channel. Held to major rather than blocker because the desktop path works and
   `notification-bell.tsx:92-108`'s focus/visibilitychange reconciliation still updates the count
   without a page reload. `notification-bell-panel.test.tsx:36-43` mocks the hook away entirely, so
   nothing would ever catch this.

2. **AS-379 — badge and panel disagree about what "unread" means.**
   `lib/queries/notifications.ts:236-238` filters `unreadCount` through `isAccessible(task_id)`;
   the list at `:221-234` applies no such filter. A user whose only unread notification points at a
   deleted or now-invisible task sees an empty badge, an unread row in the panel, and a greyed-out
   *Mark all as read*. `tests/integration/notification-deleted-target.test.ts:169-173` enshrines the
   divergence as intended rather than flagging it.

3. **AS-294 — watcher fan-out is inconsistent across mutation paths.**
   `bulkUpdateTasks` activity-logs priority/due_date changes (`lib/actions/tasks.ts:4578-4596`) but
   its fan-out only iterates `statusChangedIds` and `assigneeChangedRows` (`:4618`, `:4665`), so the
   *same* priority change notifies watchers via `editTask` and nobody via the bulk toolbar.
   `setTaskAssigneesCore` (`:876-946`) tells only the new assignee, never watchers; `restoreTask`
   (`:1968`) tells nobody.

4. **AS-380 — extension API never notifies the assignee.**
   `createTaskForUser` only fans out when an optional `notifyClient` is passed
   (`lib/actions/tasks.ts:188-200`, `:401-434`); `app/api/extension/tasks/route.ts:191` does not
   pass one, so the `else` branch just logs a skip.

5. **AS-363 — `edited_at` is app-set, not trigger-forced.** The trigger
   (`20260823070000_fix_comment_edit_trigger_authorship_guard.sql:70-78`) only rejects
   `edited_at`/body changes when `auth.uid() is distinct from old.user_id`, and RLS
   `comments_update_author_or_admin` lets the author UPDATE their own row via PostgREST. So an
   author can silently rewrite a comment with no marker, or forge the timestamp. The trigger has
   both OLD and NEW in hand and could force `new.edited_at = now()`. Separately,
   `restoreComment` returns no `editedAt` (`lib/actions/comments.ts:869-878`), so delete → Undo
   drops the `(edited)` marker until reload.

6. **AS-366 — editing a comment blanks its reactions live for every other viewer.**
   `toTaskComment` (`lib/tasks/reconcile-realtime-comment.ts:70-86`) carries no `reactions` field
   and `reconcileComment` replaces the whole object (`:116`), so the `comment_edited` (and
   `comment_restored`) broadcast blanks chips and counts on every other open viewer until reload.
   No test exists — `tests/unit/reactions-realtime-subscription.test.ts:209-290` tests a
   reimplementation of the reducer inline in the test file, not the real component path.

7. **AS-366 — reactor names degrade to raw UUIDs.** `reactorNames`
   (`components/task/comment-reactions.tsx:65-77`) falls back to `userId`; `members` is active-only
   while reaction rows survive workspace removal. And AS-366 has **no UI test at all** — nothing in
   `tests/` renders `CommentReactions` or asserts a count or a name.

8. **AS-358 — the cap notice is factually inverted** ("Showing the first 200" vs. the 200 most
   recent), and no test asserts the string. Suggested copy: "Showing the 200 most recent items."

9. **AS-376 — `createProjectFromTemplate` still fails open on a re-fetch error**
   (`lib/actions/templates.ts:1138-1143`), leaving unsanitised `description_json` persisted.
   Exposure is limited because the new project defaults to `visibility='workspace'`.

10. **AS-376 — `getMentionCandidates` discloses private-project membership.**
    `lib/actions/comments.ts:1284-1292` checks only `requireActiveMembership(workspaceId)` and never
    that the caller can see the task's project, then returns the project's member ids through the
    admin client (`:1338`). A workspace member with no access to a private project who holds a task
    id learns that project's roster (ids only).

11. **AS-371 — Escape does not dismiss the mention picker.** `editorProps.handleKeyDown` is a direct
    `EditorView` prop and ProseMirror checks direct props before plugin props
    (`prosemirror-view/dist/index.js:5671-5680`), so `rich-text-editor.tsx:471-491` fires first,
    returns `true`, and `@tiptap/suggestion` never sees the key. The Escape handling in
    `mention-extension.ts:145-150` and `mention-list.tsx:89-95` is dead code. Empirically confirmed
    by the reviewer against the real component: the editor blurs, the caller's `onBlur` fires (in
    the description that is a real `editTask` save), and the listbox stays mounted. Not data loss —
    the content is *saved*, not lost — hence major. Note this predates F318; the ordering was the
    same when the branch called `editor.commands.blur()`.

12. **AS-373 — mention chips flash "@Former member", permanently on fetch failure.**
    `comment-list.tsx:296-305` and `task-detail-sheet.tsx:646-655` pass the *picker's* narrowed
    candidate list (initially `[]`) to the read-only `RichTextRenderer` used for already-posted
    comments and the description preview, so every valid mention renders unresolved until the
    round-trip lands — and stays that way for the session if `getMentionCandidates` returns
    `{ok:false}`. The "never widen on error" default is right; reusing the picker's list as the
    renderer's label source is not.

13. **AS-357 — the append-only trail accepts fabricated rows.**
    `write_task_activity_entry` is granted to `authenticated`
    (`20260823060000_fix_write_task_activity_entry_forgery.sql:87`) and validates nothing about its
    payload beyond task existence and visibility; `p_field` has no vocabulary constraint at all. A
    member can POST directly to the RPC and inject e.g. `field_changed / priority / low → urgent`
    that never happened. `actor_id` is pinned to them, so this is self-attributed lying rather than
    impersonation — which is why it is major, not blocker.

14. **AS-355 — a reassignment never produces one old→new entry.** `setTaskAssigneesCore` writes two
    separate entries (`lib/actions/tasks.ts:937-946`), rendering "unassigned this (was Alice)" +
    "assigned this to Bob"; the "reassigned from Alice to Bob" branch in
    `format-task-activity-entry.ts:175-190` is dead for this path.

15. **AS-355 — priority/due_date/estimate are only unit-tested.** Integration coverage exists for
    `title`, `status`, assignee and system `due_date` only; the rest rest on
    `tests/unit/task-activity-diff.test.ts`, which tests the pure diff in isolation and would not
    catch a wiring regression (e.g. dropping `estimate_minutes` from `editTask`'s before-snapshot
    at `lib/actions/tasks.ts:1399`).

16. **AS-356 — `restoreComment` writes no counter-entry** (`lib/actions/comments.ts:669`), leaving a
    permanent "X deleted a comment" in the immutable trail for a comment that is visibly present.

17. **AS-359 — the private-project branch is untested.** `tests/integration/rls-activity.test.ts:7-9`
    claims to cover a workspace member who is not on the task's private project, but the fixture
    creates a **workspace**-visibility project (`:145-148`) and no such case exists in the file.

18. **AS-369 — DELETE (un-react) live delivery is never tested.** Only INSERT is exercised, yet
    DELETE is the fragile path: it depends on `REPLICA IDENTITY FULL` for the `task_id` filter to
    match at all. `grep -ri replica tests/` returns nothing. Relatedly,
    `tests/unit/reactions-realtime-delete-payload-shape.test.ts` pins the wrong boundary — it
    asserts what *this repo's* `forward()` reshapes, which says nothing about a hand-crafted
    subscriber, and its inline comment claiming the platform sends no extra columns was made false
    by `REPLICA IDENTITY FULL`.

19. **AS-367 — lost-update race in the optimistic reaction path.** `toggle()` closes over the
    `reactions` prop snapshot (`components/task/comment-reactions.tsx:162-181`) and
    `handleReactionsChange` replaces the whole array (`comment-list.tsx:453-462`), so a realtime
    reaction arriving between click and response is clobbered. The realtime handler itself uses a
    functional updater correctly (`:372-388`); this path does not.

20. **AS-383 (secondary) — inconsistent missing-preferences default.**
    `join notification_preferences np` (`20260823050000:111`) is an INNER JOIN, so a user with no
    preferences row gets no overdue notification, while the TypeScript sibling explicitly fails
    *open* for the same case (`lib/notifications/preferences.ts:104`). Two call sites, two opposite
    defaults for the same missing row.

21. **AS-214 — the primary test is a regex grep over source text.**
    `tests/unit/user-avatar-call-sites.test.ts:52-59` asserts each file contains
    `import { UserAvatar }` and the literal `<UserAvatar`. A call site inside a dead branch passes.

22. **AS-378 — the description half has no UI-level test.** Comments get
    `tests/unit/mention-picker-narrowing.test.tsx`; nothing mounts `TaskDetailSheet` to assert
    `descriptionMentionSuggestions` actually reaches the editor.

23. **Systemic: activity and fan-out writes are fire-and-forget.**
    `writeTaskFieldChanges`/`writeTaskCommentEvent` swallow both RPC errors and exceptions
    (`lib/activity/task-activity.ts:148-171`, `:201-212`) and every call site wraps them in a second
    redundant try/catch. No retry, no dead-letter, no user-visible signal.

## Minors

- `create_notification` validates `p_task_id` against the workspace but leaves `p_comment_id`
  entirely unvalidated — the same data-integrity class the F320 migration's own header argues
  against. `notification-panel.tsx:81` appends it to the deep link, so a mismatched id silently
  scrolls to nothing.
- `notifications_update_own` (`20260823020000:107-113`) is documented as "only for marking
  read/unread" but constrains no columns; a user can rewrite `kind`, `task_id`, `payload`,
  `created_at` on their own rows. Self-inflicted only; comment and enforcement disagree.
- `create_notification` never rejects `p_user_id = auth.uid()`, so AS-384 rests entirely on the
  TypeScript layer with no DB backstop.
- The activity feed's `ORDER BY created_at` has no tiebreaker, so entries written in one transaction
  (e.g. a whole `generate_due_recurring_occurrences()` run) order non-deterministically across
  refetches.
- A failed "Load more" replaces the entire rendered feed with the error/Retry state
  (`activity-feed.tsx:200-209`), discarding already-loaded rows.
- `lib/tasks/subscribe-comments-realtime.ts:112-116` still asserts DELETE payloads work "without
  requiring `REPLICA IDENTITY FULL`", directly contradicted by `20260823080000:66-77`. Doc rot that
  could get the replica identity dropped on this file's authority.
- `20260822220000_purge_task_and_comment.sql:32-34` claims "no other table references a comment row
  (grep confirmed)"; `comment_reactions` does. Harmless today, but the stated invariant is false.
- `lib/activity/README.md` documents `audit_log.action` naming only and says nothing about
  `task_activity`; that vocabulary lives only in a migration header comment.
- `lib/queries/task-activity.ts:6` and `lib/actions/task-activity.ts:25` name the policy
  `task_activity_select_visible`; the real name is `task_activity_select_visible_task`.
- `lib/queries/comments.ts` does not exist yet is cited as the comment data source in
  `comment-list.tsx:34` and `task-detail-sheet.tsx:404`.
- `mention-extension.ts:38-42` documents filtering on name *or email*; `filterMentionItems` (`:44-51`)
  only tests `label`.
- `editorProps.attributes` (`rich-text-editor.tsx:439-451`) freezes `aria-label` and `placeholder`
  per editor instance, so renaming a task with the sheet open leaves a stale accessible name.
- `RichTextRenderer`'s `onReadOnlyChecked` (`rich-text-editor.tsx:861-874`) permanently captures the
  first `onToggleTaskItem` prop; a failed checkbox toggle can roll the local mirror back to an
  outdated document.
- `extractPlainText` is called server-side without a `resolveLabel`
  (`lib/actions/comments.ts:210-211`, `:1050`), so a mention-only comment persists the raw user UUID
  into `comments.text`/`body_text`.
- `use-notifications-realtime.ts:47-48` drops `onInsert` from its dep array, so `handleInsert`'s
  captured `workspaceId` goes stale across a workspace switch.
- The overdue sweep's suppression is permanent — `(user_id, task_id)` keyed forever, so pushing a due
  date out and letting it lapse again never re-notifies.
- Unit-suite noise: an unhandled `cookies() outside a request scope` rejection from
  `getMentionCandidates` during `tests/unit/user-avatar.test.tsx`; the effect at
  `comment-list.tsx:281-294` has no `.catch`.

---

## Recommended follow-up features

Written as one-paragraph specs; the orchestrator creates the formal feature files.
**Only FU-A is in the blocker set for this cycle.** FU-B is blocker-class but out of M15's
assertion scope. FU-C onward are the deferred majors.

**FU-A (BLOCKER, AS-383) — make the overdue sweep resilient and stop it selecting non-members.**
Two independent fixes, both needed. First, add `join workspace_members wm on wm.user_id =
ta.user_id and wm.workspace_id = p.workspace_id and wm.status = 'active'` to
`notify_overdue_task_assignees()`'s driving SELECT so a stale assignment can never be selected in
the first place — this is the correctness fix and it also aligns the sweep with the recipient rule
`create_notification` already enforces. Second, wrap the `perform public.create_notification(...)`
call in a per-row `begin … exception when others then … end` block that logs and continues, so no
single bad row can ever abort the whole sweep again — this is the resilience fix and it must be
added even though the first fix closes today's known trigger, because the function's current
all-or-nothing failure mode is the actual hazard. Add an integration test that seeds an overdue
task assigned to a user, removes that user from the workspace, runs the sweep, and asserts both
that it returns successfully and that a *second*, still-valid assignee in the same run does receive
their notification. Consider separately whether `remove_workspace_member` should also delete that
user's `task_assignees` rows for the workspace — but do not rely on that alone as the fix, since
it leaves the sweep's fragility intact.

**FU-B (blocker-class security, AS-227/AS-228 — orchestrator decides whether it is in scope).**
Extract the private-project access predicate that `bulkUpdateTasks` already implements
(`lib/actions/tasks.ts:4500-4512`) into a shared helper and apply it in `editTask`, `moveTaskStatus`,
`moveAndReorderTask`, `setTaskAssigneesCore`/`assignTask` and `deleteTask`, all of which currently
mutate through the service-role admin client after checking only workspace membership and role.
Then extend `tests/integration/rls-project-visibility.test.ts` (or add a sibling) with cases that
call the **Server Actions** as a workspace member who is not on a private project and assert each is
rejected — the existing AS-226/227/228 cases only query the database directly under RLS, which is
the one layer these actions bypass, so they cannot catch this class of bug.

**FU-C (majors, notifications correctness bundle).** Fix the AS-388 duplicate-bell subscription by
hoisting the Realtime subscription to a single shared provider (or reference-counting the channel)
so exactly one binding exists per user and no unmount can tear down another bell's channel; fix the
AS-379 badge/panel divergence by making the panel and the badge apply the *same* accessibility rule
(either both filter inaccessible rows out, or neither does, but the mark-all control must never be
disabled while an unread row is visible); wire the extension API's `createTaskForUser` call site to
pass a `notifyClient` so AS-380 holds there too; and close the AS-294 gap by fanning out
`watcher_update` from `bulkUpdateTasks`'s priority/due-date branch, from `setTaskAssigneesCore`, and
from `restoreTask`, reusing the exact helper trio F319 established. Add negative tests for each.

**FU-D (majors, comments and reactions display bundle).** Force `edited_at` in the comment-edit
trigger for any non-service-role body change so AS-363's marker cannot be skipped or forged via
direct PostgREST, and return `editedAt` from `restoreComment` so Undo does not drop it; carry
`reactions` through `toTaskComment`/`reconcileComment` so a `comment_edited` or `comment_restored`
broadcast stops blanking other viewers' chips; resolve reactor names against a people resolver that
includes departed users instead of falling back to a raw UUID; make the optimistic reaction toggle
use a functional state updater so a concurrent realtime reaction is not clobbered; and add the UI
tests AS-366 currently has none of, plus an integration test for live DELETE (un-react) delivery
that would fail if `REPLICA IDENTITY FULL` were ever dropped.

**FU-E (majors, mentions and activity polish bundle).** Let the mention picker consume Escape before
the editor's own `handleKeyDown` does (register the Escape branch as a plugin-level handler, or have
`handleKeyDown` check for an active suggestion session first) so Escape cancels the mention instead
of blurring, saving the description and orphaning the popup; stop passing the picker's narrowed
candidate list to the read-only `RichTextRenderer` so existing chips no longer flash "@Former
member"; make `createProjectFromTemplate` strip all mentions when the task re-fetch itself fails,
not just when a per-task check fails; add the caller-side project-visibility check to
`getMentionCandidates`; correct the activity feed's cap notice to "Showing the 200 most recent
items." with a test that asserts the string; add a `field` vocabulary CHECK to
`write_task_activity_entry` (and consider whether `authenticated` needs EXECUTE at all, given every
production caller is a Server Action that could use the service role); write a single reassignment
activity entry instead of two; and add a `restoreComment` counter-entry.

---

## Environment conditions that affected evidence

- **Supabase Auth admin rate-limiting / `Database error finding users`** — the known, documented
  condition. It caused 10 failures across `tests/integration/invite-member.test.ts` and
  `tests/integration/workspace-role-expansion.test.ts` (AS-007, AS-215, AS-238). Not a code
  regression; no M15 assertion depends on those files.
- **Postgres `statement timeout` (57014) on `generate_due_recurring_occurrences()`** — caused 4
  failures across `recurrence-scheduled-generation.test.ts` (AS-322) and
  `recurrence-scheduled-generation-activity.test.ts`. The affected M15 case is **AS-360's negative**
  assertion ("the seeded task itself gets no activity entry from the scheduled run"); AS-360's
  *positive* case in the same file passed, so AS-360 is recorded PASS on positive evidence plus code
  review, with the negative case unexecuted this run. Worth noting the RPC now takes long enough to
  hit the statement timeout against the shared linked project — that may itself be a real scaling
  signal rather than pure noise.
- **`tests/unit/trash-list.test.tsx`** (2 failures) — pre-existing M14 regression, unrelated to M15,
  already acknowledged.
- **`tests/integration/perf-budget.test.ts`** (2 failures, AS-156/AS-136) — p95 well over budget
  (1062ms and 2004ms) against the shared project. Pre-existing and M9-scoped, but flagged since it
  is a genuine measurement, not an auth error.
- **`tests/integration/delete-comment.test.ts`** — all 6 tests skipped after a `beforeAll` failure
  at `:106`; the file's AS-098/099/100 evidence did not execute this run.
- **AS-396** — correctly recorded BLOCKED-on-F213–F217 per the user's own 2026-08-18 skip decision.
  Not relitigated.

---

## Tool output

### `npx tsc --noEmit`
```
EXIT=0
```

### `npx eslint .`
```

/Users/sasajapranin/Desktop/pm-app/lib/queries/search.ts
  232:27  warning  '_titleMatches' is defined but never used  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/tests/unit/invite-member-pagination.test.ts
  186:22  warning  '_columns' is defined but never used  @typescript-eslint/no-unused-vars

✖ 2 problems (0 errors, 2 warnings)

EXIT=0
```

### `npx vitest run` (full suite)
```
 Test Files  7 failed | 249 passed (256)
      Tests  18 failed | 1710 passed | 6 skipped (1734)
     Errors  1 error
   Start at  21:58:04
   Duration  1235.30s (transform 3.08s, setup 0ms, import 43.87s, tests 4868.06s, environment 5.75s)

EXIT=1
```

#### Failing test files (7 of 256)
```
 ❯ tests/integration/recurrence-scheduled-generation-activity.test.ts (2 tests | 1 failed) 18849ms
 ❯ tests/integration/invite-member.test.ts (7 tests | 4 failed) 19872ms
 ❯ tests/unit/trash-list.test.tsx (3 tests | 2 failed) 14ms
 ❯ tests/integration/workspace-role-expansion.test.ts (11 tests | 6 failed) 20967ms
 ❯ tests/integration/recurrence-scheduled-generation.test.ts (6 tests | 3 failed) 64211ms
 ❯ tests/integration/perf-budget.test.ts (2 tests | 2 failed) 64255ms
 ❯ tests/integration/delete-comment.test.ts (6 tests | 6 skipped) 15699ms
 ❯ tests/integration/delete-comment.test.ts:106:15
 ❯ tests/integration/invite-member.test.ts:136:20
 ❯ tests/integration/invite-member.test.ts:160:20
 ❯ tests/integration/invite-member.test.ts:207:19
 ❯ tests/integration/invite-member.test.ts:270:20
 ❯ tests/integration/perf-budget.test.ts:216:21
 ❯ tests/integration/perf-budget.test.ts:247:35
 ❯ tests/integration/recurrence-scheduled-generation-activity.test.ts:226:24
 ❯ tests/integration/recurrence-scheduled-generation.test.ts:215:24
 ❯ tests/integration/recurrence-scheduled-generation.test.ts:248:27
 ❯ tests/integration/recurrence-scheduled-generation.test.ts:281:27
 ❯ tests/integration/workspace-role-expansion.test.ts:131:29
 ❯ tests/integration/workspace-role-expansion.test.ts:201:24
 ❯ tests/integration/workspace-role-expansion.test.ts:201:24
 ❯ tests/integration/workspace-role-expansion.test.ts:201:24
 ❯ tests/integration/workspace-role-expansion.test.ts:224:22
 ❯ tests/integration/workspace-role-expansion.test.ts:246:23
```

#### Individual failing tests (18 of 1734)
```
     × AS-360 negative: the seeded (pre-existing) task itself gets no task_activity entry from the scheduled run — only the newly generated occurrence does 8339ms
     × AS-007: an owner can invite a user by email, creating an invited workspace_members row 4846ms
     × AS-007: an admin can also invite a user by email 3714ms
     × AS-007 (failure case): inviting an email that is already invited is rejected cleanly, no duplicate row 2153ms
     × AS-007 (side effect): inviting in one workspace does not create or affect a row in another workspace 2341ms
     × test_AS_347_renders_the_deleted_tasks_title_project_deleter_and_time 9ms
     × does not render a deleter name when deletedByName is null (pre-migration/legacy row) 1ms
       × AS-215: the original role 'owner' is still accepted (no regression from widening) 671ms
       × AS-238: inviting with role 'admin' creates an invited row that grants that role 3210ms
       × AS-238: inviting with role 'member' creates an invited row that grants that role 2441ms
       × AS-238: inviting with role 'viewer' creates an invited row that grants that role 1974ms
       × AS-238: omitting the role defaults the invite to 'member' (backward compatible) 1731ms
       × AS-238: the granted role survives acceptance — activation only flips status/user_id 1900ms
     × AS-322: a due recurring task gets a new occurrence generated by the SQL function directly 8312ms
     × AS-322: calling the function twice for the same due task does not create two occurrences 8446ms
     × AS-322: a run that generates an occurrence whose OWN next date is also already due cascades one step per run (documented, correct behaviour — not a duplicate) 17051ms
     × AS-156: getProjectBoardTasks p95 is under the 500ms budget at v1 scale (80 tasks / 4 columns) 10498ms
     × AS-136: dashboard RPCs (priority/status/overdue counts) p95 is under the 500ms budget at v1 scale 41105ms
```
