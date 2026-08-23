# M15 scrutiny — PASS 4 (adversarial re-validation after F313–F316)

Date: 2026-08-23
Milestone: M15 — Collaboration: activity, comments, mentions, notifications, email
Scope: AS-353 … AS-402 (+ AS-294, + AS-214 as a cross-milestone regression check)
Method: 3 independent parallel code reviewers given assertion text + file scope only
(no handoff, no run-log, no prior report), plus my own direct tracing of the F313/F314/
F316 diffs, plus `npx tsc --noEmit`, `npx eslint .`, `npx vitest run tests/unit`, and a
full `npx vitest run`.

## VERDICT: **FAIL** — 38 PASS / 3 FAIL / 1 INCONCLUSIVE / 9 DEFERRED. 2 blockers, 5 majors.

Trend: pass 1 (11 FAIL / 9 blockers) → pass 2 (7 FAIL / 5 blockers) → pass 3 (5 FAIL /
3 blockers) → pass 4 (3 FAIL / 2 blockers). Real, monotonic progress.

What is genuinely fixed and independently re-confirmed this pass:
- **F313/F316 (AS-376)** — I read both diffs directly. `createTaskFromTemplate`
  sanitises against the *target* project's real `visibility` and fails the write on a
  visibility-check error; `createProjectFromTemplate` runs a post-RPC sanitisation pass.
  A reviewer independently enumerated *every* `body_json`/`description_json` writer in
  `lib/` and `supabase/migrations/` and found no remaining user-authored bypass.
- **F315 (AS-214)** — `tests/unit/user-avatar.test.tsx` now 10/10. The
  `use-reactions-realtime.ts` crash is gone. Cross-milestone regression closed.
- **F315 (AS-382)** — the positive proof is real: `notification-fanout.test.ts:245`
  asserts `toHaveLength(1)` for a `comment_reply` row landing on a non-author watcher.
  It would fail if the comment fan-out were deleted. Pass 3's vacuous-coverage finding
  is resolved.
- **F314 (AS-371/372 test coverage)** — real behavioural coverage now exists:
  `tests/unit/mention-extension.test.tsx:405-538` mounts a live `useEditor` +
  `EditorContent` tree with the real `createMentionExtension`, dispatches a genuine
  ProseMirror transaction (`insertContent("@")`), and asserts the actual
  `ReactRenderer`-mounted `[role="listbox"]` contents, including narrowing by query and
  exclusion of an out-of-scope member. Pass 3's B1 ("no test observes the picker") is
  correctly answered *at the extension level*.

What is newly broken, and is the reason this pass still fails:

**F314's issue-3 mitigation introduced a worse user-visible bug than the one it fixed,
and its tests assert the broken behaviour as correct.** I traced this myself before any
reviewer reported it; a reviewer then reproduced the same trace independently.

---

## Per-assertion results

| ID | Result | Reason |
|---|---|---|
| AS-353 | PASS (carried) | Not re-examined this pass; verified PASS in passes 2 and 3. Carried minor: `deleteTask`/`bulkDelete`/`promoteSubtask`/`updateTaskTags`/`reorderTask`/`duplicateTask` still write no activity entry. |
| AS-354 | PASS (carried) | Actor pinned server-side to `auth.uid()` in the RPC. |
| AS-355 | PASS (carried) | All six field writers verified in pass 3. |
| AS-356 | PASS (carried) | Carried minor: `restoreComment` writes no entry, so a restored comment keeps a permanent "deleted a comment" entry. |
| AS-357 | PASS (carried) | No UPDATE/DELETE policy on `task_activity`; F302's `p_system and auth.uid() is null` guard has a live regression test. |
| AS-358 | PASS (carried) | `limit+1` `hasMore` probe + server clamp. Carried minor: no test proves page 2 contains *older* entries than page 1. |
| AS-359 | PASS (carried) | SELECT policy `using (public.is_task_visible_to(task_id))`, outsider session proven to see `[]`. |
| AS-360 | PASS (carried) | Real `generate_due_recurring_occurrences()` RPC invoked; `actor_id is null` asserted with a negative control. |
| AS-361 | PASS (carried) | Day buckets in the viewer's IANA zone; absolute time in `title`. Carried minor: labels don't re-tick on an open sheet. |
| AS-362 | PASS (carried) | Author gate in action + RLS + trigger, live test. |
| AS-363 | PASS (carried) | `edited_at` written server-side and rendered. Carried minor: `formatExactEditTime` uses the ambient browser zone, not the user's threaded timezone. |
| AS-364 | PASS (carried) | Three layers; hardened `enforce_comment_edit_author_only` trigger rejects any `user_id` change. |
| AS-365 | PASS (carried) | Self-only INSERT policy + emoji CHECK allow-list mirrored by Zod; impersonation tested. |
| AS-366 | PASS (carried) | Count + accessible Popover name list; reactions batched into `getTaskDetail` so they survive reload. |
| AS-367 | PASS (carried) | Insert-first / catch `23505` / DELETE; concurrent double-click race covered by a real-DB test. |
| AS-368 | PASS (carried) | Composite PK `(comment_id, user_id, emoji)`; duplicate rejection tested at DB level. |
| AS-369 | PASS (minor residual) | Re-verified this pass. INSERT *and* DELETE both fold into `setLocalComments` via `applyReactionToggle` (`comment-list.tsx:372-388`); `reactions-realtime-subscription.test.ts:232-300` exercises real reducer end-states (other viewer add, other viewer remove, second-tab self-event, idempotent re-apply, unknown-comment no-op) — not payload-shape pinning. **Minors:** (a) the hook's own `useEffect` wiring is never mounted in a test, so a broken `useReactionsRealtime` would not be caught; `reactions-realtime-delete-payload-shape.test.ts:86` only greps for the single call site — implementation-mirroring. (b) F315's `try/catch` around `createClient()` (`use-reactions-realtime.ts:58-69`) warns only when `NODE_ENV !== "production"`, so in production a client-construction failure silently disables reactions realtime with no signal at all. That is a test-environment workaround baked into production code; no other hook in this codebase has one. |
| AS-370 | PASS (carried) | `c.deleted_at is null` in the SELECT policy; hard purge cascades; test drives the real `deleteComment`. |
| **AS-371** | **FAIL (blocker)** | See B1. The picker is permanently empty for the entire lifetime of any editor instance the user focuses before the async candidate fetch resolves — the ordinary case, not an exotic one. Two tests (`mention-extension.test.tsx:616`, `:642`) assert this broken state as the desired outcome. Separately, neither `getMentionCandidates` call site has a `.catch`, so an action *rejection* (as opposed to `{ok:false}`) leaves candidates `null` forever plus an unhandled promise rejection. |
| **AS-372** | **FAIL (major)** | Filtering itself is now genuinely proven through the live plugin (`mention-extension.test.tsx:472-496`) — a real improvement. It fails only as a consequence of B1: filtering a permanently-empty candidate set is not observable behaviour. Secondary, untested: `mention-extension.ts:42` documents matching "on either name or email" but `:50` matches `item.label` only, so typing an email prefix for a member who has a `name` returns nothing. |
| AS-373 | PASS | Upgraded from pass 3's "PASS (major residual)". F314's `mentionSuggestionsKey` now keys on `` `${id}:${label}` `` at both `rich-text-editor.tsx:392-394` and `:830-832`, and the read-only renderer path is asserted end-to-end (`mention-extension.test.tsx:544-586` — `@Ada Byron` present, `@Ada Lovelace` gone). Pass 3's stale-chip-forever bug is genuinely closed for the display path. Residual minor: the *editor-side* rename test (`:588-609`) still only asserts DOM-node identity changed, and a rename is subject to the same pristine gate as B1. |
| AS-374 | PASS | Re-verified: `commentId` threaded through `create-notification.ts:60` → panel link `?taskId=…&commentId=…` (`notification-panel.tsx:76-81`) → consumed at `board.tsx:201`. |
| AS-375 | PASS (minor residual) | Watcher promotion via `ignoreDuplicates` upsert on comment and description paths, both driven off the **sanitised** mention ids, so a stripped mention never becomes a watcher. Carried minor: both upserts are log-only/non-fatal — a failed promotion is invisible. |
| AS-376 | PASS (major residual) | **Upgraded from pass 3's FAIL.** A reviewer exhaustively enumerated every mention-persisting writer; all user-authoring paths (`addComment`, `editComment`, `editTask`, `createTaskFromTemplate`) sanitise with the correct per-project `visibility` and **fail closed** on a DB error, each with a real behavioural test that forces a hand-crafted non-member mention and asserts the *stored row* contains neither the id nor `"mention"`. **Residual majors** in F316's post-RPC pass (`templates.ts:1127-1180`), which I read directly: it is best-effort only — the re-fetch error, each per-task `MentionVisibilityCheckError`, and each write-back error are all `console.error`-and-continue while the action still returns `ok:true`, so an AS-376 violation can persist permanently with nobody told and nothing retrying; and the re-fetch has no `.limit()`/`.range()` loop while `projectTemplatePayloadSchema` caps nothing, so a template with more tasks than PostgREST's `max-rows` (1000) silently leaves the overflow unsanitised. Low-severity residuals: `duplicateTask` (`tasks.ts:4083/4127`) and the recurrence clone copy `description_json` verbatim with no re-check — same project, so stale-visibility only, and untested. |
| AS-377 | PASS | Re-verified through the real renderer: `renderHTML` emits a plain `<span data-type="mention-unresolved">` with **no `data-id`** (no UUID leak), asserted at `mention-extension.test.tsx:234-269` and `:382-399` including the no-crash case. |
| AS-378 | INCONCLUSIVE (major) | The wiring is genuinely present (`task-detail-sheet.tsx:1218-1226` / `:1239-1242`, candidate fetch at `:614-655` mirroring comment-list). But **no test exercises it**: `tests/unit/description-mentions.test.ts`, despite its filename and its `AS-378` test names, tests only `lib/notifications/mentions.ts` diffing — the whole file stays green if `mentionSuggestions` were deleted from `task-detail-sheet.tsx:1225`. It also inherits B1 verbatim, on the surface a user is *most* likely to click into immediately after opening a task. |
| AS-379 | PASS (carried) | Bell + unread badge in desktop sidebar header and mobile top bar; both states unit-tested. |
| AS-380 | PASS (carried) | Real-DB proof on `assignTask`, plus `bulkUpdate`/`createTask`/`duplicateTask`. |
| AS-381 | PASS (carried) | F311 verified in pass 3 with falsifiable tests both directions. |
| AS-382 | PASS | **Upgraded from pass 3's FAIL.** Both halves now have positive proof: status change at `f306-mutation-fanout.test.ts:232`, comment at `notification-fanout.test.ts:245` (asserts `toHaveLength(1)`, `actor_id`, and `comment_id`). Minor: the suite is `describe.skipIf(!haveAdminCreds)`, mitigated by a hard throw in CI. |
| AS-383 | PASS (carried) | Function, partial unique index and live `cron.job` row verified. Carried minors: fires on the due date itself; the INNER join on `notification_preferences` means a user with no preferences row never gets an overdue notification (opposite of the TS fail-open policy); UTC-only. |
| AS-384 | PASS (minor residual) | Re-verified: single chokepoint `fanout.ts:123`, and a reviewer enumerated all 10 call sites (`tasks.ts:402/887/2454/2886/4193/4584/4623`, `comments.ts:301/1120`, `mentions.ts:130`) — every one passes the authenticated caller as `actorId`, and no application code inserts into `notifications` directly. Minor: the DB `create_notification` RPC has **no** self-notify guard (it pins `actor_id` and checks membership but never rejects `p_user_id = auth.uid()`), so AS-384 rests entirely on the TypeScript layer. |
| AS-385 | PASS (carried) | `created_at desc` + actor name + action label + task label; behavioural test. |
| AS-386 | PASS (carried) | Deep link with search fallback; optimistic mark-read with revert. Carried minor: mark-read fires from `<Link>` `onClick`, so a hard navigation can abandon the in-flight action. |
| AS-387 | PASS (carried) | Negative test proves it does not touch another member's rows. |
| AS-388 | PASS (carried) | Realtime INSERT with transport-level `user_id=eq.` filter + server-snapshot refetch + focus/visibility reconciliation. |
| AS-389 | PASS (carried) | F309 verified adversarially in pass 3; the `anon` follow-on hole is closed by grants, and the 7-arg overload was dropped. |
| AS-390 | PASS (carried) | Invisible targets collapse to a non-clickable `<button>` labelled "a deleted task". |
| AS-391 | PASS (carried) | Exhaustive `Record<NotificationKind, …>` makes a missing mapping a compile error. |
| AS-392 | PASS (carried) | Retention enforced *inside* the SELECT policy, so no query path can leak stale rows. |
| **AS-396** | **FAIL (blocker, carried unchanged)** | Re-verified independently this pass and unchanged since pass 2. **No code anywhere reads `email_enabled` or any `*_email` column** — `lib/notifications/preferences.ts:29-52` maps kinds to `*_in_app` only, and `resend` is in `package.json` with zero imports in `lib/`/`app/`/`components/`. **No reachable UI control** — `preferences-form.tsx:41` `const EMAIL_NOTIFICATIONS_ENABLED = false` hides the master switch and the whole email column. The "receives none" half holds *vacuously*; the "a user can turn email notifications off" half is not satisfiable by any user action. The existing round-trip/RLS test proves a column persists, not the assertion — it makes this look covered on a grep. **This is not fixable without F213–F217; see R1.** |
| AS-393, 394, 395, 397, 398, 399, 400, 401, 402 | DEFERRED | F213–F217 `[SKIPPED]` (Resend not connected, user-deferred 2026-08-18). |
| AS-294 (cross-ref) | PASS | Same chokepoint; watchers read live (`is_watching = true`) at every status-change site; `editTask` has no `status` in its update payload, so there is no un-fanned-out status mutation path. Positive proof at `f306-mutation-fanout.test.ts:232`. |
| AS-214 (cross-milestone) | PASS | F315's guard verified. `npx vitest run tests/unit/user-avatar.test.tsx` → 10/10. See M2 below for a swallowed error on the same path. |

---

## Blocking findings

### B1 — F314's "pristine window" mitigation permanently disables the mention picker (blocker; AS-371, AS-372, client half of AS-378)

`components/editor/rich-text-editor.tsx:426-433`:

```ts
const [mentionSuggestionsKey, setMentionSuggestionsKey] = useState(computedMentionSuggestionsKey)
useEffect(() => {
  if (pristineRef.current && !focusedRef.current) {
    setMentionSuggestionsKey(computedMentionSuggestionsKey)
  }
}, [computedMentionSuggestionsKey])
```

Reproduction, traced in the production code (not hypothetical):

1. The composer mounts with `mentionSuggestions === []`. `comment-list.tsx:275-304` starts
   `visibleMentionIds` at `null` and only populates it after the `getMentionCandidates`
   Server Action round-trips. `task-detail-sheet.tsx:614-655` is identical.
2. The user clicks into the composer. `onFocus` (`rich-text-editor.tsx:538-543`) sets
   `focusedRef.current = true`.
3. Candidates resolve. `computedMentionSuggestionsKey` changes, the effect runs — and is
   **skipped**.
4. `mentionSuggestionsKey` stays `""`. The editor is never recreated. The
   `getMentionItems: () => mentionSuggestions` closure captured at construction
   (`:459`) keeps returning `[]`.
5. The user types `@`. The picker opens and renders **"No matching members"**
   (`mention-list.tsx:100-110`).

This is **not self-healing**: `pristineRef` is never reset to `true`, and after a blur the
effect cannot re-run because its only dependency has not changed again. Mentions are dead
for that editor instance's entire lifetime; recovery requires closing and reopening the
task sheet. The trigger is a *focus*, before a single character is typed — not, as the
code comment at `:396-417` frames it, "an in-flight composition".

Two things make this worse than a plain bug:

- **The tests lock it in.** `mention-extension.test.tsx:616-640` fires `focus`, rerenders
  with populated members, and asserts `container.querySelector(".ProseMirror")` **is the
  same node** — it is green precisely *because* the picker is broken. `:642-669` is a
  duplicate of it (its own comment at `:651-659` admits it fires `focus` because a real
  edit cannot be simulated), not the edit case its name claims.
- **The recreation machinery is unnecessary for the picker in the first place.** I checked
  `mention-extension.ts:115-116`: `items: ({query}) => filterMentionItems(getItems(), query)`
  is invoked lazily per keystroke. If `getMentionItems` read a *ref* holding the latest
  candidates, the picker would always be current with **zero** editor rebuilds and no
  pristine gate would be needed at all. The destroy/recreate coupling — and therefore the
  focus-loss problem F314 was mitigating — is self-inflicted. (Recreation is still
  arguably needed for `renderHTML` chip *repaint*, i.e. AS-373; that path can keep it.)

Also on this path, unguarded: neither `comment-list.tsx:281-294` nor
`task-detail-sheet.tsx:630-644` attaches a `.catch`. A Server Action *rejection* leaves
`visibleMentionIds` at `null` forever and raises an unhandled promise rejection; the
`{ok:false}` branch sets `[]` with no toast, no log and no retry, so a permissions or
network failure is indistinguishable from "this project has no members".

There is also a coverage gap independent of the bug: the F314 tests exercise
`createMentionExtension` through a bespoke harness (`TestMentionEditor`,
`mention-extension.test.tsx:417-435`) that calls `useEditor(..., [])` with `getItems`
passed straight in. It **bypasses `RichTextEditor` entirely** — no `mentionSuggestionsKey`,
no pristine gate, no deps recreation. So it proves "the plugin works if `getItems` is
correct", never "`RichTextEditor` supplies a correct `getItems` at the moment the user
types `@`" — which is exactly where the bug lives.

### B2 — AS-396 cannot be satisfied while F213–F217 are skipped (blocker, carried for the third pass)

Unchanged and unchangeable by any M15 follow-up. See the assertion row and R1.

---

## Non-blocking but material findings

### M1 — The full test suite gives no trustworthy integration signal this pass (process finding)

`npx vitest run` (full) is unusable right now: 87 test files reported skipped tests behind
30 000 ms `beforeAll` hook timeouts, and 97 individual `×` failures accumulated, spread
across files with **no relation to M15** (`archive-project.test.ts` — M2-era, 6/7 failed;
`board-columns-render`, `project-list`, `upload-avatar`, `update-profile`, …). Every
timeout stack bottoms out at `admin.auth.admin.createUser`. This matches the documented
Supabase Auth admin-operation exhaustion from this session's cumulative load and is **not**
a code regression — the same files' assertions passed earlier today. I aborted the full
run rather than let it burn another 30+ minutes producing noise.

The trustworthy signal is the unit suite, which does not touch Supabase:
`npx vitest run tests/unit` → **101 passed / 2 failed files, 788 passed / 2 failed tests,
1 error**, 30 s. That is a large improvement on pass 3's "9 failed files / 18 failed tests"
and shows F313–F316 did not regress the unit layer.

**Consequence for this report:** every assertion whose only evidence is an integration test
is, strictly, unverified *by execution* this pass; I accepted them on the strength of
reading the test bodies (checking they are falsifiable, not implementation-mirroring) plus
their green history. AS-382's newly added positive test in particular was read line by line
rather than run. This should be re-executed once Supabase Auth recovers.

### M2 — Two unit tests are red, and one M15-path error is silently swallowed

- `tests/unit/trash-list.test.tsx` — 2 failed: `Error: invariant expected app router to be
  mounted` from `TrashRestoreButton` (`components/trash/trash-restore-button.tsx:22`).
  **This is an M14 regression, not M15**: F189 introduced `TrashRestoreButton` into
  `TrashList` without adding a router mock to F188's existing test. It is nonetheless a red
  suite, and a milestone should not be signed off on one.
- `tests/unit/fts-tasks.test.ts` — a Supabase-backed *integration* test living in
  `tests/unit/`; its failure here is M1's infra exhaustion, but its location means it
  poisons the one suite that is supposed to be hermetic and fast.
- The unit run emits an unhandled ``Error: `cookies` was called outside a request scope``
  from `getMentionCandidates` (`comments.ts:1250`) via `comment-list.tsx:283`, and it does
  **not** fail any file. So `user-avatar.test.tsx` is greener than the code is: a real
  render-time throw on the mention path is reported and ignored. The same env-absence
  failure class that motivated F315's guard is still live and unguarded here.

### M3 — Minor defects noted in passing

- `mention-extension.ts:145-156`: the `Escape` branch calls `unmount?.()` /
  `component?.destroy()` without nulling them, so the subsequent `onExit` (`:157-162`)
  destroys an already-destroyed `ReactRenderer`.
- `rich-text-editor.tsx:523-535`: the `justConstructedRef` heuristic assumes exactly one
  synthetic `onUpdate` per construction. If that synthetic update does not fire for some
  content shape, the **first real user edit** is swallowed as synthetic and `pristineRef`
  stays `true` — reintroducing the very mid-typing rebuild F314 set out to prevent. Only
  one of the two branches is tested.
- `components/editor/rich-text-editor.tsx` still registers as `data` to `file(1)` because
  of one legitimate `\x00` inside a control-character regex range. Cosmetic; note that it
  makes plain `grep` silently return nothing on this file (I hit this) — use `grep -a`.
- `saveAsTemplate` / `saveProjectAsTemplate` (`templates.ts:147`, `:895`) snapshot
  `description_json` unsanitised into a workspace-readable `task_templates.payload`. Not an
  AS-376 violation (every instantiation path re-sanitises), but raw non-member user ids do
  persist there.

---

## Recommended follow-up features

**R1 — Re-scope AS-396 out of M15 or unblock it.** AS-396 has now been a blocker for three
consecutive passes and is not fixable by any code change inside M15: it requires a sender
(F213–F217, `[SKIPPED]` because Resend was never connected, user-deferred 2026-08-18). No
worker can close it. Either (a) reclassify AS-396 into the same DEFERRED bucket as
AS-393–395 and AS-397–402 and re-validate the whole email block together when the Resend
chain lands, recording the reclassification in the run-log so it is not lost; or (b) run
`/mission-connect` for Resend and schedule F213–F217. Doing neither guarantees a fourth
consecutive pass that fails on an assertion nobody can act on. This needs an orchestrator
decision, not a feature file.

**R2 — Replace the pristine-window gate with a live candidate ref (blocker; AS-371, AS-372,
AS-378).** Stop coupling the mention picker to editor recreation. Hold the current
`mentionSuggestions` in a ref that is updated on every render, and pass
`getMentionItems: () => mentionSuggestionsRef.current` into the extension. Because
`mention-extension.ts:115` calls `getItems()` lazily on each suggestion query, the picker
then always sees the latest candidates with no destroy/recreate cycle — which removes both
the focus/undo-history loss F314 was mitigating *and* the pristine gate that caused this
regression. Keep a recreation key only if chip repaint (AS-373) still needs it, and if so
scope it to the read-only `RichTextRenderer`, which cannot be focused or typed into and
therefore needs no gate. Delete `mention-extension.test.tsx:616-669` (both tests assert the
broken outcome) and replace them with one that focuses the editor first, resolves
candidates late, then types `@` through the real plugin and asserts the members are listed.
Add `.catch` to both `getMentionCandidates` call sites, surfacing the failure (a toast or a
distinct "couldn't load members" picker state) rather than rendering "No matching members".

**R3 — Cover the mention picker through the production component, and cover AS-378 for
real (major).** The F314 harness (`TestMentionEditor`) bypasses `RichTextEditor`'s own
wiring, which is precisely the layer that broke. Add a test that mounts the real
`RichTextEditor` with `mentionSuggestions` arriving asynchronously (mimicking
`getMentionCandidates`), types `@` through the real Suggestion plugin, and asserts the
listbox lists the scoped members — the test that would have caught R2's bug. Add a
sibling test mounting the *description* editor surface from `task-detail-sheet.tsx` and
doing the same, since `tests/unit/description-mentions.test.ts` — despite its filename and
its `AS-378` test names — tests only notification diffing and would stay green if
`mentionSuggestions` were removed from the description editor entirely. While in the file,
either implement email matching in `filterMentionItems` or correct the doc comment at
`mention-extension.ts:42`.

**R4 — Harden `createProjectFromTemplate`'s post-RPC sanitisation pass (major; AS-376).**
The pass at `templates.ts:1127-1180` is best-effort in a way that lets an AS-376 violation
persist silently: paginate the task re-fetch with a `.range()` loop (or cap
`projectTemplatePayloadSchema.tasks`) so a template exceeding PostgREST's `max-rows` does
not leave the overflow unsanitised; read the created project's real `visibility` from the
row instead of hardcoding `"workspace"`; and stop swallowing every failure — at minimum
count the failures and surface a warning in the action's result so the user knows the
project was created but some descriptions were not verified. Add a test that forces a
write-back failure and asserts the caller learns about it. Separately, run the sanitiser in
`duplicateTask` (`tasks.ts:4083/4127`) and the recurrence clone, both of which currently
copy `description_json` verbatim with no re-check, and add the negative test neither has.

**R5 — Restore a green, hermetic unit suite (major; milestone-level).** Add the missing
`next/navigation` router mock so `tests/unit/trash-list.test.tsx` passes again — it broke
when F189 introduced `TrashRestoreButton` into `TrashList` and is an M14 regression that
has been red across multiple passes without being attributed. Move
`tests/unit/fts-tasks.test.ts` into `tests/integration/`, where its Supabase dependency
belongs, so `tests/unit` stays hermetic and fast. Make the unhandled ``cookies`` rejection
from `getMentionCandidates` in the jsdom environment either fail its test or be explicitly
stubbed, so it is not silently reported-and-ignored — a real render-time throw on the
mention path is currently invisible to CI.

**R6 — Re-run the integration suite once Supabase Auth recovers (process).** Nothing to
build; the M15 integration evidence in this report was read rather than executed (M1). A
clean full `npx vitest run` should gate the milestone before the UX validator, and the
result should be recorded in the run-log. If a second consecutive session hits
`auth.admin.createUser` exhaustion, consider a fixture-pooled test user strategy so the
suite stops creating an auth user per `beforeAll`.

---

## Command output

### `npx tsc --noEmit`

```
TSC exit 0
```

### `npx eslint .`

```
/Users/sasajapranin/Desktop/pm-app/lib/queries/search.ts
  232:27  warning  '_titleMatches' is defined but never used  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/tests/unit/invite-member-pagination.test.ts
  186:22  warning  '_columns' is defined but never used  @typescript-eslint/no-unused-vars

✖ 2 problems (0 errors, 2 warnings)

ESLINT exit 0
```

### `npx vitest run tests/unit` (trustworthy signal — no Supabase dependency)

```
 ❯ tests/unit/trash-list.test.tsx (3 tests | 2 failed) 15ms
     × test_AS_347_renders_the_deleted_tasks_title_project_deleter_and_time 10ms
     × does not render a deleter name when deletedByName is null (pre-migration/legacy row) 1ms
 ❯ tests/unit/fts-tasks.test.ts (3 tests | 3 skipped) 30009ms

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  tests/unit/fts-tasks.test.ts > F068 full-text search (AS-117, AS-123, AS-124)
Error: Hook timed out in 30000ms.
 ❯ tests/unit/fts-tasks.test.ts:75:3
     75|   beforeAll(async () => {
     77|       await admin.auth.admin.createUser({

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  tests/unit/trash-list.test.tsx > TrashList (F188: AS-347) > test_AS_347_renders_the_deleted_tasks_title_project_deleter_and_time
 FAIL  tests/unit/trash-list.test.tsx > TrashList (F188: AS-347) > does not render a deleter name when deletedByName is null (pre-migration/legacy row)
Error: invariant expected app router to be mounted
 ❯ useRouter node_modules/next/src/client/components/navigation.ts:169:10
 ❯ TrashRestoreButton components/trash/trash-restore-button.tsx:22:18
     22|   const router = useRouter();

⎯⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯⎯
Error: `cookies` was called outside a request scope.
 ❯ createClient lib/supabase/server.ts:10:29
 ❯ getMentionCandidates lib/actions/comments.ts:1250:26
 ❯ components/task/comment-list.tsx:283:5
This error originated in "tests/unit/user-avatar.test.tsx" test file.
(does not fail the file)

 Test Files  2 failed | 101 passed (103)
      Tests  2 failed | 788 passed | 3 skipped (793)
     Errors  1 error
   Duration  30.17s
```

### `npx vitest run tests/unit/user-avatar.test.tsx` (AS-214 cross-milestone check)

```
 Test Files  1 passed (1)
      Tests  10 passed (10)
   Duration  1.53s
```

### `npx vitest run` (full — ABORTED, infra-degraded, see M1)

```
 ❯ tests/integration/archive-project.test.ts (7 tests | 6 failed) 238858ms
     × AS-030: a workspace owner can archive a project (deleted_at is set) 30008ms
     × AS-030: a workspace admin can archive a project 30004ms
     × AS-033 (failure case): a plain member cannot archive a project 30004ms
     × AS-032: an archived project's row remains fully readable ... 30002ms
     × (side effect) archiving one project does not affect another project's row 30002ms
     × (failure case) an unauthenticated caller cannot archive a project 30005ms
 ❯ tests/integration/template-actions.test.ts (13 tests | 13 skipped) 32488ms
 ❯ tests/integration/project-from-template.test.ts (7 tests | 7 skipped) 38064ms
 ❯ tests/integration/f313-mention-visibility-followup.test.ts (4 tests | 4 skipped) 31446ms
 ❯ tests/integration/f316-project-from-template-mentions.test.ts (2 tests | 2 skipped) 33296ms
 ❯ tests/integration/add-comment.test.ts (4 tests | 4 skipped) 32468ms
 ... 87 files with 30s beforeAll hook timeouts, 97 accumulated `×` failures,
     every stack bottoming out at admin.auth.admin.createUser,
     spread across milestones with no relation to M15.
 [run aborted — see M1; not a code regression]
```
