# M15 scrutiny — pass 5 (2026-08-23)

Milestone: **M15 — Collaboration: activity, comments, mentions, notifications, email**
Features in scope: F194–F212 (F213–F217 `[SKIPPED]`), plus follow-ups F301–F317.
Method: three independent parallel feature reviewers (mentions / activity+comments /
notifications), given only assertion text and file scope — no handoffs, no run-log, no
prior report. All load-bearing findings below were then **re-verified by me directly
against the current code**, not accepted from the reviewers.

**Verdict: FAIL — 2 blockers, 4 majors.**
Trend: 11 FAIL/9 blockers → 7/5 → 5/3 → 3/2 → **4 FAIL / 2 blockers**.

The trend has flattened rather than closed. Notably, **both blockers are newly
surfaced, not carried over** — the pass-4 blocker (F314's picker freeze) is genuinely
fixed, but deeper probing found two problems that four prior passes missed.

---

## Assertion table

| ID | Verdict | Reason |
|---|---|---|
| AS-294 | **FAIL** (blocker) | `editTask` writes activity for title/priority/due-date/estimate but has **no** watcher fan-out; watchers only get status + comments. |
| AS-353 | PASS | Activity written from editTask, moveTaskStatus, board drag, bulkUpdate, assignees, restore; real-DB tests. |
| AS-354 | PASS | `actor_id` pinned to `auth.uid()` inside SECURITY DEFINER RPC; never client-supplied. |
| AS-355 | PASS | `diffTaskFields` covers all six fields; 12 unit tests incl. null↔value; DB presence CHECK. |
| AS-356 | PASS | `writeTaskCommentEvent` on add + delete with the caller's session client. |
| AS-357 | PASS | No INSERT/UPDATE/DELETE policy on `task_activity`; real-session UPDATE/DELETE/forgery attempts tested. |
| AS-358 | **FAIL** (major) | `MAX_TASK_ACTIVITY_PAGE_SIZE=200` silently clamps; on a task with >200 entries "Load more" stays enabled forever and re-fetches the same 200 rows. Older entries unreachable. |
| AS-359 | PASS | RLS `is_task_visible_to`; outsider reads tested via raw PostgREST session and anon key. |
| AS-360 | PASS | `system: true` via service-role client → null actor; SQL cron path too; UI renders "System". |
| AS-361 | PASS | Day grouping in viewer timezone + `formatDistanceToNow`; non-UTC test present. |
| AS-362 | PASS | Author-only + active-writable-member; direct-API positive test. |
| AS-363 | PASS | `edited_at` set, read, realtime-reconciled, rendered with exact time in title/aria-label. |
| AS-364 | PASS | Action check + BEFORE UPDATE trigger; authorship-reassignment takeover hole closed in `20260823080000`. |
| AS-365 | PASS | Insert through caller's own session; allow-list CHECK; real-DB tests. |
| AS-366 | PASS | Batched per-comment/emoji grouping, Popover with names, pure reducer unit-tested. |
| AS-367 | PASS | Insert-then-23505→delete convergence; genuine concurrent double-toggle test. |
| AS-368 | PASS | Composite PK `(comment_id,user_id,emoji)`; duplicate insert rejected against real DB. |
| AS-369 | PASS (major: flaky) | Filtered subscription + `REPLICA IDENTITY FULL`; cross-task isolation tested. **Test fails in the full suite, passes in isolation** — I re-ran it to confirm. |
| AS-370 | PASS | Cascade on hard delete; soft-delete hidden by `c.deleted_at is null` in the SELECT policy. Rows survive soft delete (documented, pinned by tests) — visibility, not deletion. |
| AS-371 | PASS (major) | Real Suggestion plugin + server-narrowed candidates. But a `getMentionCandidates` failure pins the list to `[]` with **no retry and no feedback** for the life of that taskId. |
| AS-372 | PASS | `filterMentionItems` + real-plugin narrowing test. |
| AS-373 | PASS | Id-only attrs, label resolved live at render; sanitiser keeps only `id`. |
| AS-374 | PASS | `comment_id` persisted, selected, and rendered into the deep link; `?commentId=` consumed. |
| AS-375 | PASS | Watcher upsert on comment create + edit + description mentions. |
| AS-376 | **FAIL** (major) | Every `body_json`/`description_json` writer is filtered **except** `createProjectFromTemplate`, which inserts raw then sanitises **post-hoc, best-effort** — failure is only `console.error`'d and the action still returns success, so an unauthorized mention persists permanently. |
| AS-377 | PASS | Unresolved id → unstyled text with no `data-id`; server strip writes literal `@Former member`. |
| AS-378 | **FAIL** (blocker) | Escape in the description editor **throws** after mention candidates load, so save-on-blur — the description's only save path — never runs. See below. |
| AS-379 | PASS | Bell mounted desktop + mobile. |
| AS-380 | PASS (minor gap) | Assign fan-out on create/duplicate/bulk/setAssignees. Extension API route never notifies. |
| AS-381 | PASS | New comment, edited comment (diffed against prior body), and description mentions. |
| AS-382 | PASS | Status change, board drag, bulk, comment. |
| AS-383 | PASS | Hourly `cron.schedule` sweep + partial unique idempotency index; 8 real tests incl. negatives. |
| AS-384 | PASS | Compares against `event.actorId`; every call site passes the authenticated user id consistently. |
| AS-385 | PASS | `created_at desc`; actor + action label + task rendered. |
| AS-386 | PASS | Navigates and marks read; server action re-checks via RLS. |
| AS-387 | PASS | Mark-all clears count; negative revert test. |
| AS-388 | PASS | Transport-level `user_id=eq.` filter; bell reconciles from a **server snapshot**, not a client `+1`; focus/visibility self-heal. |
| AS-389 | PASS (major) | Read isolation genuinely holds — no INSERT policy, SELECT/UPDATE gated on `auth.uid()`. **But** `create_notification` is granted to `authenticated` with no `p_task_id`/`p_kind` validation, so a member can fabricate notification *content* for another member. Actor is correctly pinned, so it cannot be attributed to someone else. |
| AS-390 | PASS | Soft-deleted/invisible → null title, non-clickable button, excluded from unread count; hard delete cascades. |
| AS-391 | PASS (minor) | Preferences are genuinely **enforced at fan-out time**, not merely stored; 5 real tests prove no row is written. TS filter fails open on a missing row while the SQL sweep inner-joins (fails closed). |
| AS-392 | PASS | Retention enforced **in the SELECT policy itself**, not client-side; backdated-row test. |
| AS-393 | DEFERRED | F215 `[SKIPPED]` — no email sender. |
| AS-394 | DEFERRED | F215 `[SKIPPED]`. |
| AS-395 | DEFERRED | F214 `[SKIPPED]`. |
| AS-396 | **BLOCKED-on-F213–F217** | See note below — expected, already-acknowledged, **not** a new blocker. |
| AS-397–AS-400 | DEFERRED | F216/F217 `[SKIPPED]`. |
| AS-401, AS-402 | DEFERRED | F213 `[SKIPPED]`. |
| AS-214 | INCONCLUSIVE (minor) | `tests/unit/user-avatar-call-sites.test.ts` is a **regex source scan** asserting each file imports `UserAvatar`. It would not fail if the avatar rendered in a dead branch or received a broken person object. |

Totals: **31 PASS / 4 FAIL / 1 INCONCLUSIVE / 1 BLOCKED / 10 DEFERRED.**

---

## Blockers

### B1 — Escape in the description editor throws after mention candidates load, silently losing the edit (AS-378)

`components/editor/rich-text-editor.tsx:452-476`. I verified this structurally against
the vendored tiptap source rather than taking the reviewer's word for it:

`node_modules/@tiptap/react/dist/index.js:444` gates the in-place update branch on
`deps.length === 0`. F310/F317 pass a non-empty `deps` array
(`[computedMentionSuggestionsKey]`, line 531), so `setOptions` is **never** called and
`editorProps` is frozen at the ProseMirror view's construction. On recreation the new
instance is built from the current render's options, whose `handleKeyDown` closes over
that render's `editor` binding — which, per this file's own comment at lines 536-543, is
the **just-destroyed** instance.

`editor?.commands.blur()` at line 458 therefore optional-chains past a non-null but
destroyed editor into `get commands()` (`@tiptap/core/dist/index.js:52`), which reads
`this.state` → `this.view.state` with no null guard. Result: an uncaught `TypeError` in
the keydown handler.

Impact is not cosmetic. `handleDescriptionJsonBlur` (`components/task/task-detail-sheet.tsx:587`)
is the description's **only** save path, and I confirmed the description `RichTextEditor`
at `:1219-1225` is wired `onBlur={handleDescriptionJsonBlur}` with no Save button. A user
who writes a description containing a mention and presses Escape loses the edit with no
error surfaced. Because candidates always load asynchronously, the recreation always
happens — this is the normal path, not an edge case.

Same frozen-`editorProps` root cause also leaves `aria-label` and `placeholder` stale
when the sheet switches tasks (minor, a11y).

Fix direction: don't capture `editor` in `handleKeyDown` — ProseMirror already passes
`view`, so use `view.dom.blur()`, and route `onBlur` through a stable ref.

### B2 — Watchers are not notified of task field activity (AS-294)

I confirmed directly: `computeFanoutRecipients` is called at `lib/actions/tasks.ts`
lines 402, 887, 2454, 2886, 4193, 4584, 4623 — **none inside `editTask`**. `editTask`
writes `task_activity` at `:1393` and calls only `notifyNewlyMentionedUsers` at `:1430`.
Assignee changes notify the assignee alone, never watchers.

AS-382's narrower wording ("changes status or gets a comment") is satisfied. AS-294's
broader wording ("notifications for the task's activity") is not: a watcher sees nothing
when the title, priority, due date, or estimate changes. No test would catch this,
because no test asserts the broad case.

---

## Majors

- **M1 (AS-376)** — `lib/actions/templates.ts:1131-1176`: the RPC
  (`20260822190000_rpc_create_project_from_template.sql:92`) inserts raw
  `description_json`; sanitisation runs afterwards and failures are logged while the
  action returns success. An unauthorized mention persists permanently. Every other
  writer (addComment, editComment, editTask, createTaskFromTemplate, duplicateTask,
  recurrence clones, toggleTaskItem, restoreComment) was enumerated and is correctly
  filtered — this is the sole remaining hole.
- **M2 (AS-358)** — silent 200-entry cap, verified at `lib/queries/task-activity.ts:104-117`.
  Window-based, not cursor-based, so "Load more" cannot advance past 200. Untested.
- **M3 (AS-389)** — `create_notification` EXECUTE granted to `authenticated`
  (`20260823100000...` final line) with no check that `p_task_id` belongs to
  `p_workspace_id` or is visible to the recipient, and no `p_kind` restriction. I read
  the test at `tests/integration/rls-notifications.test.ts:205-224`: it is named
  `..._cannot_forge_...` but explicitly `void error`s the insert outcome and asserts only
  the read-leak property. The assertion it makes is genuine (so AS-389 passes), but the
  test's name materially overclaims what it proves.
- **M4 (AS-369)** — `tests/integration/reaction-realtime-delivery.test.ts` fails in the
  full suite (`expected null not to be null`) and passes in isolation. I re-ran it both
  ways. A genuinely broken realtime path would be indistinguishable from this flake.

## Minors

Silent 200-cap has no test; `write_task_activity_entry` EXECUTE granted to
`authenticated` lets a member inject fabricated self-attributed entries (cannot alter
existing ones, so AS-357 holds); `bulkRestoreTasks` writes no activity though
`restoreTask` does; `restoreComment` writes no counterpart event; unknown reactor renders
a raw UUID; extension task-creation never notifies the initial assignee; TS preference
filter fails open while the SQL sweep fails closed; `mention` dedupe overrides
`comment_reply`, so disabling `mention` suppresses the comment notification entirely;
`task_due_soon` panel label says "watching" though the sweep targets assignees;
watcher-promotion upsert errors are swallowed with no log; existing mention chips paint
once as grey "@Former member" before repainting; `enforce_comment_edit_author_only`
exempts `service_role`.

## Test-quality findings

The mention tests that drive the **real** Suggestion plugin
(`tests/unit/mention-extension.test.tsx:451-540`, `640-742`) do so through local replica
components (`TestMentionEditor`, `RecreatingTestEditor`) that re-implement the key
computation. The tests that use the actual `RichTextEditor` assert only that the DOM node
identity changed — i.e. "a recreation happened", not "the picker shows the right
candidates". **A silently stale picker inside `RichTextEditor` would pass today.** Nothing
covers content/selection/undo survival across recreation, Escape after recreation (B1), or
an open picker during recreation.

## AS-396 — expected non-blocker

No email sender exists: F213–F217 are deliberately `[SKIPPED]`, Resend is not connected,
per the user's own 2026-08-18 decision. AS-396 has been honestly recorded as
BLOCKED-on-F213–F217 since F307 rather than falsely green, which remains the correct
treatment. **This is not counted among M15's blockers** and needs no follow-up feature;
it will resolve when the email dependency is picked up.

## Out-of-M15-scope, still present

1. `tests/unit/trash-list.test.tsx` — still red (`invariant expected app router to be
   mounted`). Pre-existing M14 regression; F189's `TrashRestoreButton` needs a router
   mock. Tracked separately.
2. The `cookies() was called outside a request scope` unhandled rejection from
   `getMentionCandidates` during `comment-list.tsx` test rendering is still live and
   fails no test.

---

## Recommended follow-up features

**FU-A — Stop capturing the editor instance in frozen `editorProps` (blocker B1).**
Rewrite `RichTextEditor`'s `handleKeyDown` so it never dereferences the `editor` const
from its enclosing render. ProseMirror already hands the handler a `view`; use
`view.dom.blur()` for the Escape path and route the `onBlur` callback through a ref that
is updated every render, so a frozen `editorProps` object can never reach a destroyed
instance or a stale prop closure. Apply the same treatment to `aria-label` and
`placeholder`, which are stale for the same reason. Add two tests that drive the real
exported `RichTextEditor` (not a replica): one that presses Escape *after* mention
candidates have arrived and asserts no throw plus that `onBlur` fired, and one that types
`@` after candidates arrive and asserts the actual candidate names appear in the picker.

**FU-B — Fan out watcher notifications from `editTask` (blocker B2).**
`editTask` already computes a field diff for the activity log; reuse that same diff to
drive `computeFanoutRecipients` + `filterRecipientsByInAppPreference` +
`createNotification` for the task's watchers, matching the pattern already used at
`lib/actions/tasks.ts:2454`. Decide and document a notification `kind` for field edits
(reusing `task_updated` or adding one) and a corresponding preference toggle so AS-391
stays coherent. Also fan out to watchers on assignee change, which currently notifies only
the new assignee. Add an integration test asserting a watcher who is neither actor nor
assignee receives a row when the title/priority/due date changes, and receives none when
they are the actor.

**FU-C — Make template project creation reject unauthorized mentions instead of
best-effort-cleaning them (major M1).** Change `createProjectFromTemplate` so mention
sanitisation is not post-hoc: either sanitise `description_json` before it reaches the
RPC, or treat a post-insert sanitisation failure as a hard failure that rolls back or
nulls the offending description rather than logging and returning `ok: true`. Add a test
that seeds a template description mentioning a user without access to the target project
and asserts the created project's task description contains no such mention and that a
sanitisation failure does not surface as success.

**FU-D — Cursor-paginate the activity feed (major M2).** Replace the growing-window
`limit` in `getTaskActivityPage` with a `created_at`/`id` cursor so "Load more" advances
past the 200-row server cap, and make `hasMore` reflect the true remainder. Add a test
that seeds more than `MAX_TASK_ACTIVITY_PAGE_SIZE` entries and asserts the oldest entry is
reachable by repeated expansion.

**FU-E — Close notification write-forgery and fix the overclaiming test (major M3).**
Add validation to `create_notification` that `p_task_id` (when non-null) belongs to
`p_workspace_id` and is visible to `p_user_id`, and constrain `p_kind` to the values the
caller's relationship to the task justifies — or revoke EXECUTE from `authenticated` and
route all writes through a service-role path, accepting the loss of `auth.uid()` actor
pinning by passing a verified actor explicitly. Rewrite
`rls-notifications.test.ts:205-224` to assert the insert itself is rejected rather than
`void`-ing the outcome, and rename it to match what it actually proves.

**FU-F — De-flake reaction realtime and surface mention-candidate fetch failures
(majors M4, AS-371).** Isolate `reaction-realtime-delivery.test.ts` from parallel-seeding
contention (dedicated fixtures or serial execution) so its failure signal is trustworthy.
Separately, in `comment-list.tsx` and `task-detail-sheet.tsx`, distinguish "no candidates"
from "candidate fetch failed": retry once and surface a retryable message rather than
pinning the picker to `[]` for the life of the taskId.

**FU-G — Replace the avatar source-scan test with a rendering test (AS-214,
INCONCLUSIVE).** `tests/unit/user-avatar-call-sites.test.ts` greps source text. Replace it
with tests that render each of the four surfaces — task card, members list, comment,
assignee picker — and assert an avatar image or initials fallback is actually in the
output for a given person.

---

## Lint / typecheck output

```
$ npx tsc --noEmit
(no output — exit 0)

$ npx eslint .
(no output — exit 0)
```

## Test output (full suite)

```
$ npx vitest run

 Test Files  38 failed | 216 passed (254)
      Tests  16 failed | 1556 passed | 150 skipped (1722)
   Duration  842.24s
```

Failure-mode breakdown (counted across the run):

```
  36  Error: Hook timed out in            <- parallel integration seeding contention
   9  Error: Database error finding users  <- Supabase auth admin under concurrent load
   8  AssertionError
   4  Error: Test timed out in
   1  Error: no active request
   1  Error: invariant expected app router to be mounted   <- trash-list.test.tsx (M14)
```

The 8 AssertionErrors:

```
 FAIL  tests/integration/invite-member.test.ts (2)          expected { ok: false } to equal { ok: true }
 FAIL  tests/integration/workspace-role-expansion.test.ts (5) expected { ok: false } to equal { ok: true }
 FAIL  tests/integration/reaction-realtime-delivery.test.ts (1) expected null not to be null
```

The invite/role-expansion failures are downstream of `Database error finding users`
(auth-admin contention), not logic failures. The reaction-realtime failure was re-run in
isolation and passes:

```
$ npx vitest run tests/integration/reaction-realtime-delivery.test.ts
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

The 38 failing files are therefore overwhelmingly environmental (a live-Supabase
integration suite run at full parallelism), with `tests/unit/trash-list.test.tsx` the one
genuine, known, out-of-M15-scope red. **No M15 assertion verdict above rests on a suite
failure**; every FAIL is grounded in code I read directly.
