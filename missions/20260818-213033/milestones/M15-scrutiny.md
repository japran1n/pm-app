# M15 scrutiny — PASS 3 (adversarial re-validation after F309–F312)

Date: 2026-08-23
Milestone: M15 — Collaboration: activity, comments, mentions, notifications, email
Scope: AS-353 … AS-402 (50 assertions)
Method: 3 independent parallel code reviewers given assertion text + file scope only
(no handoffs, no run-log, no prior report), plus my own direct verification of the
four F309–F312 fixes, plus a full `npx vitest run`, `npx eslint .`, `npx tsc --noEmit`.

## VERDICT: **FAIL** — 35 PASS / 5 FAIL / 1 INCONCLUSIVE / 9 DEFERRED. 3 blockers, 6 majors.

Improvement over pass 2 (37/7/10) is real but the tally is misleading: pass 2's raw
counts included AS-393–402 in a different bucket. Substantively, F309 and F311 are
genuine, verified fixes. F310 is a *real* mechanism fix with two unfixed side effects
and no behavioural evidence. **F312's stated root cause is factually false** and it
should not be credited with restoring any evidence.

Additionally, and independent of any single assertion: **the full test suite is RED**
(9 failed files / 18 failed tests / 1 unhandled rejection, exit 1). A milestone cannot
be declared GREEN on a red suite. One of those failures is an M15-caused regression.

---

## Per-assertion results

| ID | Result | Reason |
|---|---|---|
| AS-353 | PASS | Per-task feed rendered for every task via the shared detail sheet; `created_at desc`; real-DB coverage. Minor: `deleteTask`/`bulkDelete`/`bulkRestore`/`promoteSubtask`/`updateTaskTags`/`reorderTask`/`duplicateTask` still write no entry, while `restoreTask` does — the feed shows a status "set" with no preceding delete. |
| AS-354 | PASS | Actor pinned server-side to `auth.uid()` in the RPC; callers use the session client. |
| AS-355 | PASS | All six fields have a real writer (title/priority/due/estimate via `editTask`; status via `moveTaskStatus`/`moveAndReorderTask`/`bulkUpdateTasks`; assignees via `setTaskAssigneesCore` diffing the real join table). Unit tests assert literal sentences, not helper round-trips. |
| AS-356 | PASS | `comment_added`/`comment_deleted` land in the same table and feed. Minor: `restoreComment` writes nothing, so a restored comment keeps a permanent "deleted a comment" entry. |
| AS-357 | PASS | No UPDATE/DELETE policy on `task_activity` at all; proven with real member sessions (0 rows affected, row verified unchanged via admin). F302's `p_system and auth.uid() is null` guard holds with a live regression test. |
| AS-358 | PASS | `limit+1` `hasMore` probe + server clamp + "Load more"; real rows, monotonic `created_at desc` asserted. Minor: no test proves page 2 actually contains *older* entries than page 1 — `hasMore` is a proxy. |
| AS-359 | PASS | SELECT policy `using (public.is_task_visible_to(task_id))`; real outsider session sees `[]` and the RPC write is rejected. |
| AS-360 | PASS | Test invokes the real `generate_due_recurring_occurrences()` RPC and asserts `actor_id is null` on the generated row, with a negative control. Strong. |
| AS-361 | PASS | Day buckets in the viewer's IANA zone; `formatDistanceToNow` labels with absolute time in `title`; test asserts a relative string is present *and* no clock string is. Minor: labels don't re-tick on an open sheet. |
| AS-362 | PASS | Author gate in the action + RLS + trigger; live test. |
| AS-363 | PASS | `edited_at` written server-side, selected on both read paths, marker rendered. Minor: exact time only in `title`/`aria-label`; `formatExactEditTime` uses the ambient browser zone, not the user timezone the rest of the app threads through. |
| AS-364 | PASS | Three layers (action, RLS, hardened `enforce_comment_edit_author_only` trigger rejecting any `user_id` change). |
| AS-365 | PASS | Self-only INSERT policy is the real boundary; emoji CHECK allow-list mirrored by Zod; impersonation attempt tested. |
| AS-366 | PASS | Count + accessible Popover/`aria-label` name list; reactions batched into `getTaskDetail` so they survive reload. |
| AS-367 | PASS | Insert-first / catch `23505` / DELETE; concurrent double-click race covered by a real-DB test. |
| AS-368 | PASS | Composite PK `(comment_id, user_id, emoji)`; duplicate rejection tested at DB level with a real session. |
| AS-369 | PASS (major residual) | Live delivery proven end-to-end on the real wire. **But** the `filter: task_id=eq.<uuid>` is chosen by the subscriber — it is scoping, not authorization — and Supabase does not RLS-filter `postgres_changes` DELETE payloads (the migration header admits this). A non-member who knows a task UUID can subscribe and receive un-react events leaking `comment_id`/`user_id`/`emoji`. The scoping test's "outsider" is actually a workspace member, so **no test covers a non-member subscriber at all.** |
| AS-370 | PASS | `c.deleted_at is null` in the SELECT policy handles the real (soft-delete) path; hard purge cascades; test drives the real `deleteComment` action. |
| **AS-371** | **FAIL (blocker)** | **No test anywhere drives the actual Tiptap suggestion plugin.** `tests/unit/mention-extension.test.tsx` tests `filterMentionItems` in isolation and renders `MentionList` directly (its own header admits jsdom can't type into ProseMirror); `tests/e2e/` has no mention spec. The F310 editor-side test (`mention-extension.test.tsx:298-322`) asserts only that the `.ProseMirror` DOM node identity changed — i.e. it asserts the *implementation mechanism* (editor recreation), not that typing `@` lists candidates. Per this pass's standard, an implementation-mirroring test is a FAIL even when green. "Picker opens with the right people" is asserted only by construction, never observed. |
| **AS-372** | **FAIL (blocker)** | Same root cause. `filterMentionItems` is correct and unit-tested, but the keystroke→picker path that AS-372 describes is never exercised. Also a doc/behaviour mismatch: the comment claims name-or-email matching, the code matches `item.label` only. |
| AS-373 | PASS (major residual) | Chip markup (`data-type="mention"`, primary tint) asserted on real rendered DOM. **Major:** `mentionSuggestionsKey` is `ids.join(...)`, so a member *rename* leaves the deps key identical, no rebuild occurs, and ProseMirror never re-runs `renderHTML` — reproduced empirically: rerendering with `{id:"u-1", label:"Ada Byron"}` still shows `@Ada Lovelace`. This directly falsifies `mention-extension.ts`'s own stated contract ("a member's later name change is reflected without touching any previously-saved comment"). Access *revocation* is caught (id set changes); renames are not. |
| AS-374 | PASS | `comment_id` persisted and asserted to equal the specific comment's id; `&commentId=` consumed and scroll-highlighted. |
| AS-375 | PASS | Idempotent `upsert(onConflict:"task_id,user_id", ignoreDuplicates:true)` on all three paths; watcher row read back on the real DB. Minor: those three upserts never destructure `error`, and supabase-js resolves rather than throws — a failed watcher promotion is silently dropped with zero logging, exactly the bug class `create-notification.ts` was written to fix. |
| **AS-376** | **FAIL (major)** | Server enforcement is solid for `addComment`/`editComment`/`editTask` (fail-the-write on `MentionVisibilityCheckError`, real-DB coverage). **Bypass found:** `lib/actions/templates.ts:401` (and the template-creation copies at :145/:854) inserts a stored template's `description_json` verbatim into a possibly *different* project with **no `sanitiseMentionsForVisibility` call** — a mention of someone with no access to the target project persists as a live chip. "Not offered in the picker" also remains unverifiable for the reason under AS-371. |
| AS-377 | PASS | `resolveMentionDisplay` → `data-type="mention-unresolved"`, muted span, **no `data-id`** (no UUID leak), matching `renderText`; asserted on real DOM and distinguishable from a broken render. Server strip writes the same literal, so both paths agree. |
| AS-378 | INCONCLUSIVE | Server half correct and real-DB tested (`editTask` sanitises `descriptionJson` and diffs post-sanitisation). Client half rides the identical untested picker path as AS-371/372, so the assertion's user-facing half is unverified. |
| AS-379 | PASS | Bell + unread badge mounted in desktop sidebar header and mobile top bar; both states unit-tested. |
| AS-380 | PASS | Real-DB proof on `assignTask`, plus `bulkUpdate` / `createTask` / `duplicateTask` paths. |
| **AS-381** | PASS | F311 verified independently: `editComment` selects prior `body_json` at `comments.ts:956`, diffs via `extractNewlyMentionedIds` at `:1114`, notifies + promotes at `:1129-1159`. No silent-no-op path (a failed prior read already returns "Comment not found"). Falsifiable tests both ways: add-mention-via-edit notifies (`notification-fanout.test.ts:239`), remove-mention does not (`:325`), typo-fix does not re-notify (`:314`). |
| **AS-382** | **FAIL (major)** | Only half covered. The status-change branch is proven (`f306-mutation-fanout.test.ts:232`, board drag → `watcher_update`). The **"or gets a comment"** branch has **no positive test anywhere** — the only `comment_reply` coverage is `notification-preferences-fanout.test.ts:295-326`, a *negative* gating test asserting `rows` is `[]`, which passes just as happily if comment fan-out to watchers were deleted entirely. Textbook vacuous coverage. |
| AS-383 | PASS | Function, partial unique index and live `cron.job` row all verified against the real DB. Unchanged minors carried from pass 2: `due_date <= today` fires on the due date itself; the INNER join on `notification_preferences` means a user with no preferences row never gets an overdue notification (opposite of the TS fail-open policy); UTC-only. |
| AS-384 | PASS | Single chokepoint `if (!id || id === event.actorId) continue` in `fanout.ts:123`, applied to every event kind; real-DB proof `expect(actorRows).toEqual([])`. Note the addComment ordering puts the actor in `watcherIds` before fan-out — the guard is the only thing saving it, so it must never be bypassed by a future call site. |
| AS-385 | PASS | `created_at desc` + actor name + action label + task label; behavioural test. |
| AS-386 | PASS | Deep link with a search fallback only when unresolvable; optimistic mark-read with revert + `toast.error`; cross-user negative on the real DB. Minor: mark-read fires from `<Link>` `onClick`, so a hard navigation can abandon the in-flight action. |
| AS-387 | PASS | `markAllNotificationsRead(workspaceId)`; negative test proves it does not touch another member's rows. |
| AS-388 | PASS | Realtime INSERT with transport-level `user_id=eq.` filter + server-snapshot refetch + focus/visibility reconciliation. |
| AS-389 | PASS | F309 verified independently and adversarially. Final definition is `if p_system and auth.uid() is null then` (`20260823100000:87`). The obvious follow-on hole — an `anon` caller also having a null `auth.uid()` — is **closed by grants**: `revoke all ... from public` then `grant execute ... to authenticated, service_role`; `anon` is never granted and is not a member of `authenticated`. The 7-arg overload was explicitly dropped at `20260823030000:57`, so no unpatched signature survives. SELECT/UPDATE policies both `user_id = auth.uid()` (UPDATE has a `with check` too); no INSERT/DELETE policy exists. Cross-user read, insert and mark-read all proven to fail against the live project. |
| AS-390 | PASS | Deleted/soft-deleted/invisible targets collapse to `title: null, projectId: null`; `taskHref` returns null → renders a non-clickable `<button>` labelled "a deleted task". Two live tests. |
| AS-391 | PASS | Exhaustive `Record<NotificationKind, ...>` makes a missing mapping a compile error, not a silent allow; enforced at all fan-out call sites; RLS self-scoped with negative tests. |
| AS-392 | PASS | Retention enforced **inside the SELECT policy** (`created_at >= now() - interval '30 days'`), so no query path can leak stale rows; test backdates a real row via admin and asserts the owner sees nothing. |
| **AS-396** | **FAIL (blocker, carried)** | Unchanged from pass 2 and not addressed by F309–F312. No sender exists (F213–F217 SKIPPED), nothing reads `email_enabled`, and `EMAIL_NOTIFICATIONS_ENABLED = false` hides every email control — a user has no UI to turn email off. The existing round-trip test proves a column persists, not the assertion. |
| AS-393, 394, 395, 397, 398, 399, 400, 401, 402 | DEFERRED | F213–F217 SKIPPED (Resend not connected, user-deferred 2026-08-18). Out of scope; re-validate when the email chain lands. |

---

## Blocking findings

### B1 — Mention picker has zero behavioural evidence (blocker; AS-371, AS-372, and the client half of AS-378)
F310's mechanism is **real** — I verified `refreshEditorInstance` in `node_modules/@tiptap/react/dist/index.js:464-481` genuinely calls `editor.destroy()` then `createEditor()` on deps change, so the `getMentionItems` closure is truly refreshed. But *no test observes the picker*. The one editor-side test added asserts the `.ProseMirror` node identity changed — the implementation's own mechanism. There is no e2e mention spec. The assertions describe user-visible behaviour that has never been executed by any test in this repo, so a regression in `suggestion.items`, `MentionList` mounting, or the `char`/`allowSpaces` config would ship green.

### B2 — Full test suite is red (blocker; milestone-level)
`npx vitest run`: **9 failed files, 18 failed tests, 1 unhandled rejection, exit 1**, 744s.
Two of these are M15's own:
- `tests/unit/user-avatar.test.tsx > renders the comment author's avatar in the actual CommentList component` — **deterministic failure**, not a flake: `components/task/use-reactions-realtime.ts:44` (M15/F202) calls `createBrowserClient` unconditionally on mount, which throws `"Your project's URL and API key are required"` in any environment without `NEXT_PUBLIC_SUPABASE_*`. An M15 feature broke a previously-passing test for a *different* milestone's assertion (AS-214), and nothing in M15 covers this crash path.
- **Unhandled Rejection** in the same run, at `getMentionCandidates lib/actions/comments.ts:1250 → components/task/comment-list.tsx:283` — this is finding B3 below, empirically reproduced by the suite itself.
The remaining 7 files (`invite-member`, `workspace-role-expansion`, `subtask-*`, `task-assignees-multi`, `perf-budget`, `comment-format-realtime`, `trash-list`) are pre-existing/env/contention failures outside M15, but they mean **no canonical green run exists** for this milestone.

### B3 — `getMentionCandidates` has a live unhandled-rejection path (blocker-adjacent, promoted to blocker by B2)
`lib/actions/comments.ts:1310-1314` calls `resolveVisibleMentionIds` **outside** any try/catch, while that function throws `MentionVisibilityCheckError`. The `workspace_members` fetch immediately above *is* error-checked, so the omission is inconsistent, not a design choice. Both consumers call `.then(...)` with **no `.catch`** (`comment-list.tsx:283-290`, `task-detail-sheet.tsx:633-640`). A transient DB error therefore becomes an unhandled promise rejection and `visibleMentionIds` stays `null` forever: the picker silently never opens for that task, with nothing surfaced to the user. Fail-closed for security, but a silently dead feature — and the test run above proves the rejection path is reachable in practice.

## Major findings

- **M1 (AS-376) — template description mentions bypass sanitisation.** `lib/actions/templates.ts:401` (also :145, :854) copies `description_json` into a possibly different project with no `sanitiseMentionsForVisibility`. A forced mention of a non-member survives into the target project. This is the one server-side hole in an otherwise well-defended set of write paths.
- **M2 (AS-382) — watcher-gets-a-comment fan-out has only a vacuous negative test.** Delete the feature and the suite stays green.
- **M3 (AS-373) — mention chips go stale on rename.** deps keyed on ids only; reproduced empirically; contradicts the module's own documented contract.
- **M4 (F310 side effect) — editor rebuild drops focus and undo history.** Reproduced: mount with `mentionSuggestions: []`, focus `.ProseMirror`, rerender with a populated list → node is replaced, text survives (content is controlled by every caller) but `document.activeElement` returns to `BODY`. Since `getMentionCandidates` resolves a few hundred ms after mount, a user who starts typing immediately is kicked out of the composer mid-keystroke. No test covers this; the existing guard test only checks the no-op case.
- **M5 (AS-369) — realtime DELETE payloads are not authorization-scoped.** A non-member who knows a task UUID can subscribe and receive un-react events. No test uses a genuine non-member subscriber.
- **M6 (F312) — the fix's stated root cause is false, and the real silent-skip vector is untouched.** Reproduced in Vitest 4.1.10: a hook timeout marks the *suite* failed (`@vitest/runner/dist/chunk-artifact.js:3137` calls `failTask` before `markTasksAsSkipped`), prints under "Failed Suites", and exits 1. Only the individual tests show as `skip`. So the claim in `vitest.config.ts:30-33`, the F312 handoff, and commit `9474f36` — that a canonical run "could silently never execute that file's assertions" — is wrong; hook timeouts were always loud. F312 removed a visible red failure rather than restoring evidence, and that credit should be struck from the run log. Meanwhile the *actual* green-with-zero-coverage vector — `describe.skipIf(!haveAdminCreds)` across 40+ integration files — is untouched. It is guarded in CI by per-file `process.env.CI` throws, but locally a truncated `.env` yields a fully green run with the entire integration tier skipped. `hookTimeout: 30_000` is pure "wait longer" and does not address the root cause (~40 files each minting fresh Supabase Auth users in `beforeAll`); `maxWorkers: 4` is a genuine but partial mitigation. There is no `retry`, `bail`, `fileParallelism: false`, or `sequence` serialization.

## Minor findings

- `components/editor/rich-text-editor.tsx` contains **two literal NUL bytes** (offset ~15001 and the renderer's twin), used as the `Array.join()` separator for `mentionSuggestionsKey`. This makes the file *binary* to `grep`, `git diff --word-diff`, and most text tooling — plain `grep -n "useEditor" components/editor/rich-text-editor.tsx` silently returns nothing. Ids are UUIDs; `","` would be equally collision-safe and text-clean.
- Non-empty `deps` permanently disables `setOptions` (`@tiptap/react` `onRender` only takes that branch when `deps.length === 0`), so `editorProps` — placeholder, `aria-label`, and the `handleKeyDown` closure over `onBlur` — is frozen at construction. `editable` is patched manually; nothing else is. Latent trap.
- Transient "@Former member" flash: read-only renderers receive the visibility-filtered list, which is `[]` until the fetch resolves, so every existing mention paints grey before flipping to a chip.
- Watcher-promotion upserts (`comments.ts:336`, `:1152`, `mentions.ts:169`) never destructure `error`; failures are silent and unlogged.
- Activity writes are `console.error`-and-continue at every call site with no reconciliation, so a transient RPC failure leaves an invisible gap in a feed AS-353/355 describe as covering "every" change. Notifications got a dedicated observability test; activity writes have no equivalent.
- `rls-notifications.test.ts:205-224` is misnamed ("cannot forge…for another user") and ends in `void error` — it asserts nothing about forgery. `:226-238` carries the real load.
- `bulkUpdateTasks` diffs only 4 of 6 activity fields (no title/estimate). Correct today because the bulk schema excludes them; silent-drift trap if that widens.
- An authenticated **active member** can call `create_notification` for any other member of the same workspace with arbitrary `p_kind`/`p_task_id`/`p_payload` — neither caller-vs-recipient nor task-belongs-to-workspace is checked (`rls-notifications.test.ts:240-258` confirms the call succeeds). Actor is honestly pinned, so AS-389 stands, but this enables in-workspace notification spam and a cross-project task-id probe.
- Lint: 2 warnings, 0 errors (`_titleMatches`, `_columns` unused).

---

## Recommended follow-up features

**FU-1 — End-to-end mention picker coverage (closes B1; AS-371, AS-372, AS-378).**
Add a Playwright spec under `tests/e2e/` that signs in as a real workspace member, opens a task's comment composer, types `@`, and asserts the picker appears listing exactly the members with access to that task's project (and *not* a workspace member without project access), then types characters and asserts the list narrows, then selects an entry and asserts a `data-type="mention"` chip with the correct `data-id` lands in the posted comment. Repeat the same flow in the task *description* editor for AS-378. Critically, the fixture must reproduce the real timing: the candidate list must arrive from `getMentionCandidates` *after* the editor has mounted, which is the exact sequence F310 claims to fix and which no current test observes. The existing jsdom test that asserts `.ProseMirror` node identity changed should be kept but demoted to a supporting unit test, not treated as evidence for AS-371/372.

**FU-2 — Fix the deterministic `use-reactions-realtime` unit-test crash and get the suite green (closes B2).**
`components/task/use-reactions-realtime.ts:44` constructs a Supabase browser client unconditionally on mount, throwing whenever `NEXT_PUBLIC_SUPABASE_*` is absent and taking down any test (or any future SSR/preview context) that renders `CommentList`. Make the hook degrade gracefully — no subscription, no throw — when the client cannot be constructed, and add a test that renders `CommentList` with those env vars unset and asserts it still renders comments. Separately, triage the other 8 red files: `trash-list.test.tsx` (missing app-router mock, deterministic), and the Supabase Auth rate-limit / statement-timeout cluster (`invite-member`, `workspace-role-expansion`, `subtask-*`, `task-assignees-multi`, `perf-budget`, `comment-format-realtime`). The rate-limit cluster is the root cause F312 declined to fix: replace the per-file "mint fresh Supabase Auth users in `beforeAll`" pattern with a pooled/reused set of test users, or serialize the Auth-heavy files. Definition of done is a clean `npx vitest run` exit 0, twice in a row.

**FU-3 — Make `getMentionCandidates` fail loudly instead of silently killing the picker (closes B3).**
Wrap the `resolveVisibleMentionIds` call in `lib/actions/comments.ts:1310-1314` in the same try/catch the adjacent `workspace_members` fetch already uses, returning a structured error result rather than throwing across the server-action boundary. Add `.catch` handlers at both consumers (`comment-list.tsx:283`, `task-detail-sheet.tsx:633`) that log and surface a non-blocking toast, so a transient failure produces a visible "mentions unavailable" state rather than a permanently `null` candidate list and an unhandled promise rejection. Add a test that forces the visibility check to throw and asserts no unhandled rejection escapes and the composer still functions for plain text.

**FU-4 — Sanitise mentions on every template description copy (closes M1; AS-376).**
Apply `sanitiseMentionsForVisibility` to `description_json` in `lib/actions/templates.ts` at :401 (apply-template-into-project) and at :145/:854 (template creation copies), resolving visibility against the *target* project, not the source. Mirror `editTask`'s convention exactly: catch `MentionVisibilityCheckError` and fail the write rather than persisting a partially-sanitised document. Add a real-DB integration test that stores a template whose description mentions user X, applies it into a project X cannot see, and asserts the persisted `description_json` contains no `data-id` for X.

**FU-5 — Positive test for watcher-notified-on-comment, and audit for sibling vacuous tests (closes M2; AS-382).**
Add a real-DB test in which user A watches a task, user B comments, and A receives exactly one `comment_reply` notification with the correct `comment_id` — a test that fails if the fan-out branch is removed. The current only coverage is a negative preference-gating assertion that passes vacuously. While there, sweep the notification and activity suites for the same pattern: any test whose sole assertion is `expect(rows).toEqual([])` needs a positive counterpart proving the non-empty case exists.

**FU-6 — Re-render mention chips on label change, and stop stealing focus on editor rebuild (closes M3 and M4).**
Two problems with one root: `mentionSuggestionsKey` is keyed on ids alone, so renames never trigger a rebuild, while *any* rebuild destroys focus and undo history. Include the label (and any other rendered field) in the deps key so a rename repaints; then make the rebuild non-destructive by capturing the editor's selection and focus state before `destroy()` and restoring both after `createEditor()`, or by moving the suggestion source behind a mutable options object the extension reads at call time so no rebuild is needed at all. Add tests for: rename repaints the chip; a rebuild triggered while the composer is focused leaves `document.activeElement` on `.ProseMirror` with the caret where it was.

**FU-7 — Authorize realtime reaction DELETE payloads (closes M5; AS-369).**
`postgres_changes` DELETE payloads are not RLS-filtered, and the `task_id` filter is subscriber-chosen, so knowledge of a task UUID is sufficient to receive un-react events for a project the subscriber cannot see. Move reaction realtime to an authorized private channel (Supabase Realtime authorization / `realtime.messages` RLS) or to a server-emitted broadcast that only fans out to authorized recipients. Add a test with a genuine **non-member** subscriber — the current scoping test's "outsider" is a workspace member, so the leak is untested.

**FU-8 — Correct the F312 record and close the real silent-skip vector (closes M6).**
Amend `vitest.config.ts:30-33`, the F312 handoff, and the run-log entry to state the verified behaviour: a hook timeout in Vitest 4.1.10 fails the suite and exits 1; nothing was ever silently skipped by that mechanism. Keep `hookTimeout: 30_000` and `maxWorkers: 4` (harmless and mildly beneficial) but stop crediting them with restored evidence. Then address the mechanism that *does* produce green-with-zero-coverage: `describe.skipIf(!haveAdminCreds)` across 40+ integration files. Make a missing-credentials run fail loudly by default (invert the guard so the `throw` is unconditional unless an explicit `ALLOW_SKIP_INTEGRATION=1` opt-out is set), so a truncated `.env` can never yield a falsely green local run.

**FU-9 — Housekeeping (minors).**
Replace the literal NUL separators in `components/editor/rich-text-editor.tsx` with a printable separator so the file stops registering as binary to `grep`/`git diff`. Handle `error` on the three watcher-promotion upserts. Add observability coverage for swallowed activity-log writes to match the notification path. Rename or delete the no-op `rls-notifications.test.ts:205-224`. Consider tightening `create_notification` to reject a caller notifying a member about a task that caller cannot see. Clear the two lint warnings.

---

# Appendix — full tool output

## `npx tsc --noEmit`
```
(no output)
TSC exit 0
```

## `npx eslint .`
```
/Users/sasajapranin/Desktop/pm-app/lib/queries/search.ts
  232:27  warning  '_titleMatches' is defined but never used  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/tests/unit/invite-member-pagination.test.ts
  186:22  warning  '_columns' is defined but never used  @typescript-eslint/no-unused-vars

✖ 2 problems (0 errors, 2 warnings)
```

## `npx vitest run` (Vitest 4.1.10)
```
 Test Files  9 failed | 242 passed (251)
      Tests  18 failed | 1687 passed (1705)
     Errors  1 error
   Duration  744.85s
EXIT 1
```

Failed files:
```
tests/unit/trash-list.test.tsx
tests/unit/user-avatar.test.tsx
tests/integration/comment-format-realtime.test.ts
tests/integration/invite-member.test.ts
tests/integration/perf-budget.test.ts
tests/integration/subtask-actions.test.ts
tests/integration/subtask-ui-detail.test.ts
tests/integration/task-assignees-multi.test.ts
tests/integration/workspace-role-expansion.test.ts
```

Failed tests:
```
× AS-007: an owner can invite a user by email, creating an invited workspace_members row       4396ms
× AS-007: an admin can also invite a user by email                                             1612ms
× AS-007 (failure case): inviting an email that is already invited is rejected cleanly         1776ms
× AS-007 (side effect): inviting in one workspace does not create or affect a row in another   1852ms
× AS-238: inviting with role 'admin' creates an invited row that grants that role              1798ms
× AS-238: inviting with role 'member' creates an invited row that grants that role             1511ms
× AS-238: inviting with role 'viewer' creates an invited row that grants that role             1718ms
× AS-238: omitting the role defaults the invite to 'member' (backward compatible)              1607ms
× AS-238: the granted role survives acceptance — activation only flips status/user_id          1381ms
× test_AS_347_renders_the_deleted_tasks_title_project_deleter_and_time                            9ms
× does not render a deleter name when deletedByName is null (pre-migration/legacy row)            1ms
× renders the comment author's avatar in the actual CommentList component                        14ms
× test_AS_264_a_promoted_subtask_no_longer_appears_in_its_former_parents_children             30004ms
× test_AS_267_cascade_provenance_distinguishes_a_child_deleted_before_the_parent_from_cascaded 30003ms
× AS-289: an assignee can be removed without affecting the others (3 assignees, remove one)   30006ms
× AS-156: getProjectBoardTasks p95 is under the 500ms budget at v1 scale (80 tasks / 4 cols)   8225ms
× AS-136: dashboard RPCs (priority/status/overdue counts) p95 is under the 500ms budget       17792ms
× AS-312: an independent Realtime subscriber on comments:<taskId> receives body_json on INSERT 8194ms
```

Representative failure detail:
```
FAIL  tests/unit/user-avatar.test.tsx > test_AS_214_user_avatar_appears_on_comments
      > renders the comment author's avatar in the actual CommentList component
Error: @supabase/ssr: Your project's URL and API key are required to create a Supabase client!
 ❯ createBrowserClient node_modules/@supabase/ssr/src/createBrowserClient.ts:105:10
 ❯ createClient lib/supabase/client.ts:7:10
 ❯ components/task/use-reactions-realtime.ts:44:22

FAIL  tests/unit/trash-list.test.tsx > TrashList (F188: AS-347)
Error: invariant expected app router to be mounted
 ❯ TrashRestoreButton components/trash/trash-restore-button.tsx:22:18

FAIL  tests/integration/comment-format-realtime.test.ts > AS-312
AssertionError: expected null not to be null
 ❯ tests/integration/comment-format-realtime.test.ts:350:30

FAIL  tests/integration/workspace-role-expansion.test.ts > AS-238 (x5)
AssertionError: expected { ok: false, error: "Something went wrong…" }
                 to deeply equal { ok: true, invitedEmail: … }
```

Unhandled rejection (1 error):
```
⎯⎯⎯⎯ Unhandled Rejection ⎯⎯⎯⎯⎯
Error: `cookies` was called outside a request scope.
 ❯ createClient lib/supabase/server.ts:10:29
 ❯ getMentionCandidates lib/actions/comments.ts:1250:26
 ❯ components/task/comment-list.tsx:283:5
Serialized Error: { __NEXT_ERROR_CODE: 'E251' }
This error originated in "tests/unit/user-avatar.test.tsx" test file.
```
