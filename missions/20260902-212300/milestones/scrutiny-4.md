# Scrutiny 4 — Mission 20260902-212300 (post-wave-4, baseline 2db1bad → HEAD 980a1bf)

Read-only adversarial review. No code, test, contract or mission state was
modified. `git status --porcelain -- components lib tests scripts supabase`
is clean at exit. Every mutant below was re-run by this round, not taken
from a worker's claim.

**Milestone verdict: REJECT.** 0 blockers, 2 majors, 5 minors.
AS-006 FAILS. **Nothing here blocks shipping** — see "Does this block
shipping?" below. All four wave-4 fixes are genuine and hold under
independent mutation.

---

## Part 1 — did wave 4 close round 3's findings?

### F025 / MAJOR-1 (AS-016) — CLOSED.

Baseline 12/12 in `components/portal/approval-actions.test.tsx`.

| Mutant (request-changes handler) | Result | Killed by |
|---|---|---|
| `inFlightRef.current = false` out of `finally` → success path only | **KILLED** | `test_AS_016_ref_is_cleared_after_a_rejected_action_allowing_retry`, `..._after_ok_false_...` |
| reset into `catch` only (not on `ok:false`) | **KILLED** | `..._ref_is_cleared_after_ok_false_allowing_retry` |
| delete `if (!trimmed) return;` | KILLED | `..._handler_guard_rejects_whitespace_only_message_even_when_enabled` |
| delete in-flight guard | KILLED | `..._second_synchronous_send_click_issues_no_second_call` |
| remove `setOptimisticSent(true)` before `startTransition` | KILLED (4) | 4 tests |
| remove both `setOptimisticSent(false)` reverts | KILLED (3) | 3 tests |
| `disabled={isPending \|\| !message.trim()}` → `disabled={isPending}` | KILLED | 2 tests |
| remove success `toast.success` + `router.refresh()` | **SURVIVED** | — (minor-1) |

Round 3's surviving mutant is dead. The two new tests are behavioural, not
ref-peeking: they re-click Send and assert
`expect(requestChangesMock).toHaveBeenCalledTimes(2)` plus the optimistic
state re-rendering. The test-only Button stub never enforces `disabled`,
but that hole is plugged by `test_AS_016_request_changes_with_whitespace_only_message_issues_no_call`,
which uses the real Base UI Button and asserts `toBeDisabled()` — the
`disabled`-expression mutant dies against both.

The worker's claim that there was no production defect is correct: the
`finally` was already right; only the net was missing.

### F026 / MAJOR-2 (AS-027) — CLOSED.

Baseline 19 passed across the two board files. Call sites unchanged:
`addPendingMove` `board.tsx:800`; `releasePendingMove` `:826, :841, :864,
:875, :886`; guard at `:291`.

| Mutant | Result | Killed by |
|---|---|---|
| delete release `:826` (moveAndReorderTask) | KILLED | AS-025 test's AS-026 tail |
| delete `:841` (reorderTask) | **KILLED** (4 failures) | all four new AS-027 tests |
| delete `:864` (editTask, groupBy=priority) | **KILLED** | `..._editTask_thrown_rejection_...` only |
| delete `:875` (setTaskAssignees) | **KILLED** | `..._setTaskAssignees_ok_false_...` only |
| delete `:886` (updateTaskTags) | **KILLED** | `..._updateTaskTags_thrown_rejection_...` only |
| delete `addPendingMove` `:800` | KILLED | AS-025 test |
| invert guard `:291` | KILLED (5) | every test in the file |
| `.finally(` → `.then(` at all five sites | SURVIVED — **equivalent mutant** | — |

All four previously-surviving sites now die, with clean 1:1 targeting at
`:864/:875/:886`. The `.finally`→`.then` survivor is not a coverage gap:
`.catch()` sits before the release, so the promise is already fulfilled by
the time the next link runs; `.then` and `.finally` are behaviourally
identical there and no test can distinguish them.

The four new tests are real. They render the actual component
(`render(createElement(Board, {...}))` — board.tsx is never mocked), drive
the genuine `handleDragEnd` via a captured `onDragEnd` (only
`DndContext`/`DragOverlay` replaced, `...actual` spread for the rest),
alternate real failure branches (`mockResolvedValueOnce({ ok: false })`
and `mockRejectedValueOnce(new Error("network error"))`), run the real
`useBoardRealtime` callback, and assert on rendered DOM
(`[data-status="in_review"]`), never on `pendingMovesRef`. No mock
neutralises the code under test.

Caveat (minor-2): the three cross-lane assertions use `.some(...)` across
all `[data-status="in_review"]` nodes, proving the update was applied but
not which swimlane it landed in. Adequate for AS-026/027, weaker than the
AS-025 test.

### F024 / MAJOR-3 (request-changes data loss) — CLOSED, and the fix is correct.

Baseline 23/23 in `tests/unit/portal-approval-action.test.ts`.

| Mutant | Result | Killed by |
|---|---|---|
| revert ordering (RPC before `addComment`) | **KILLED** (2) | `..._comment_failure_leaves_the_task_pending_and_retryable`, `..._retry_after_a_comment_failure_succeeds_with_the_same_message` |
| comment-failure branch falls through, RPC still runs | KILLED (3) | + `..._surfaces_failure_when_the_trail_comment_fails` |
| delete the `if (!commentResult.ok)` check | KILLED (3) | same 3 |
| drop `parsed.data.message` from the comment body | KILLED (2) | both assert the exact `"Requested changes: please fix this"` |
| RPC error branch returns `{ok: true}` | KILLED | `..._rpc_error_is_treated_as_a_failure_not_a_silent_success` |
| drop `.min(1)` on `message` | KILLED | `..._request_changes_rejects_an_empty_message` |

Independent correctness trace of the current code
(`lib/actions/portal-approval.ts:167-224`): both gates —
`resolvePendingClientTask` (`:167`) and `requireClientCaller` (`:170`) —
run *before* `addComment` (`:183`), and `addComment`
(`lib/actions/comments.ts:83-227`) independently re-checks auth, active
membership, `client_visible` for client callers, and project visibility.
Reordering did **not** widen the attack surface: a client cannot post a
comment on a non-actionable task through this action.

No remaining path loses the message: comment-fail returns before the RPC
(row stays pending → retryable); RPC-fail leaves the comment written and
the row still pending. Three residual issues, all minor (see minors 3–5).

### F027 / MAJOR-4 (`pg_temp`) — CLOSED for the five named predicates,
### with **no** behavioural change. Scope gap remains.

`supabase/migrations/20260908010000_pin_pg_temp_on_client_visibility_predicates.sql`
uses `CREATE OR REPLACE` throughout and contains **no `DROP FUNCTION`**
(repo-wide grep confirms), so grants survive.

Baselines: all five latest-prior definitions live in
`20260902010000_client_role_and_task_client_visibility.sql` (`:51, :77,
:117, :135, :193`). Earlier `20260821*` hits are superseded; the
`is_project_visible_to_row` hit in `20260902020000` is a *different*
function.

Function-by-function diff (bodies whitespace-normalised): for all five,
args, `returns boolean`, `language sql`, `stable`, `security definer` and
the full body are **byte-identical**. The only differing line in each:

```
-  set search_path = public
+  set search_path = public, pg_temp
```

Live verification against the linked project (Management API; no
credential values printed):
- `proconfig = {"search_path=public, pg_temp"}` — all five ✅
- `prosecdef = true` — all five ✅
- `provolatile = 's'` (STABLE) — all five ✅
- identity args match the repo exactly ✅
- `pg_get_functiondef` bodies match the repo migration exactly — **no drift,
  no manual edit** ✅
- `proacl`: `is_project_visible_to`, `is_project_workspace_writer`,
  `is_task_workspace_writer`, `is_task_visible_to` all
  `{postgres=X,anon=X,authenticated=X,service_role=X}` — PUBLIC correctly
  absent, the old `revoke all ... from public` held.

The feared silent alteration did **not** occur. The migration does exactly
and only what it claims.

---

## Part 2 — final sweep, AS-001 … AS-034

| ID | Verdict | Sev | Evidence |
|---|---|---|---|
| AS-001 | PASS | — | `check-migration-drift.mjs:80` `findDrift`; inverting the filter KILLED by "AS-001: exits 0 when the fixture is clean" + 3 more. Orchestrator: `migrations:check` clean, 0 drift. |
| AS-002 | PASS | — | Drifted versions named at `:141`; emitting a count instead of `${names}` KILLED; `remote === undefined` narrowing KILLED. |
| AS-003 | PASS | minor | Scope is `migrations:check` = `check-migration-drift.mjs`, whose own `redactSecrets` (`:27-42`) **does** cover `SUPABASE_SECRET_KEY`. Stripping both redaction layers KILLED; appending the token to spawn argv KILLED; `buildChildEnv` returning full `process.env` KILLED. Minor-6: `redactSecrets` no-ops for values under 6 chars (`:36`), untested. (The *realtime* script has a separate, genuinely leaky `redactSecrets` — see MAJOR-2 below; it is outside AS-003's wording.) |
| AS-004 | PASS | — | Missing-env guard `:116-122`, early return before any spawn; deletion KILLED by "AS-004: exits 1 with a plain message…". |
| AS-005 | PASS | minor | `findUnpublishedTables` returning `[]` KILLED; count-instead-of-names KILLED. Orchestrator `realtime:check` 9/9. Minor-7: every `checkRealtimePublication` test injects both `discover` and `queryPublished` (`test:129-166`), so the real scanner is never proven to be what feeds `findUnpublishedTables`. |
| AS-006 | **FAIL** | **major** | See MAJOR-1. Replacing `discoverSubscribedTables`' entire body (`check-realtime-publication.mjs:121-130`) with a hardcoded 9-element array **SURVIVES** all three AS-006 tests. |
| AS-007 | PASS | — | Distinct topics `use-my-tasks-realtime.ts:137-138`. Collapsing `tasksTopic` onto `assigneesTopic` KILLED (13 tests); wiring the tasks binding onto the assignees *channel object* while keeping distinct strings also KILLED by `f004`'s per-object binding count. |
| AS-008 | PASS | minor | Removing the `onUpdate` call (`:215`) KILLED by `f008-my-tasks-realtime.test.ts:470` + 4. Minor-8: that test simulates "binding dead" by simply not firing the other callback, which would pass on a single-channel impl too; the real independence guarantee is carried by `f004:63`. |
| AS-009 | PASS | minor | Removing `onAssigned` (`:169`) KILLED by `f008:510` + 3. Same minor-8 caveat. |
| AS-010 | PASS | — | `:233-236`; releasing only assignees, and only tasks, each KILLED by all 3 AS-010 tests. |
| AS-011 | PASS | — | Giving the tasks channel its own cloned tracked-id Set (`:186, :213-222`) KILLED by `f008:538` and `f019`; removing the tracked-set gate (`:213`) KILLED. |
| AS-012 | PASS | — | `approval-actions.tsx:63`; removing the pre-`startTransition` optimistic set KILLED (4 tests, both handlers). |
| AS-013 | PASS | — | Revert + `toast.error(result.error)`; removing the reverts KILLED (3). Server side: every gate in `lib/actions/portal-approval.ts` killed by a negative test (`portal-approval-action.test.ts:147-218`). |
| AS-014 | PASS | — | Reset-out-of-`finally` on the approve path KILLED (round 3, re-confirmed). |
| AS-015 | PASS | — | Approve in-flight guard deletion KILLED. |
| AS-016 | **PASS** | minor | Round 3's survivor is dead — all 7 mutants killed (table above). Minor-1: the request-changes **success** path has no test at all; deleting `toast.success` + `router.refresh()` leaves 12/12 green. |
| AS-017 | PASS | — | `client_requests` in `supabase_realtime`; orchestrator `realtime:check` 9/9. |
| AS-018 | PASS | — | `portal-overview-live.test.tsx:123-152` asserts DOM (`queryByText(...).not.toBeInTheDocument()` + the empty state). Non-removing UPDATE (`reconcile:86-87`) and `waitingOnYouPredicate → true` (`portal-overview-live:94`) both KILLED. |
| AS-019 | PASS | — | `:154-178`; suppressing the "newly qualifies" insert (`reconcile:94`) and dropping `title` from the reconciled task (`:83`) both KILLED. |
| AS-020 | PASS | — | Dropping `client_visible` from the gate (`reconcile:59`), dropping `deleted_at`, and letting INSERT skip the gate (`:72`) all KILLED. |
| AS-021 | PASS | minor | `task-list.test.tsx:133-192`; the strong test asserts the *heading* moves. Stale-title merge (`task-list:171`), stale-status merge (`:166`) and a `resolveCategory` that always falls back (`:151-157`) all KILLED. Minor-9: the payload carries both `status` and `status_id`, so the id-path and name-path are mutually redundant — either alone can be deleted undetected. |
| AS-022 | PASS | — | `task-list.test.tsx:194-236`; DELETE keyed on `event.new` instead of `event.old` (`reconcile:102`), unfiltered DELETE (`:105`) and a dead DELETE branch (`task-list:219`) all KILLED. |
| AS-023 | PASS | — | `request-list.test.tsx:120-175`; dropping UPDATE (`:128`), not prepending INSERT (`:141`), stale-status merge (`:85`) and mapping to the old row (`:138`) all KILLED. |
| AS-024 | PASS | — | Strongest of the set. Six teardown mutants all KILLED: no-op release (`subscribe-when-authenticated:64`), dropped post-`setAuth` `cancelled` guard (`:52`), `removeChannel` never called (`shared-topic-channel:136`), listener never removed (`:129`), early-returning deferred timer (`:132`), and missing effect cleanup in all three subscribers. Components assert the *real* registry's `removeChannel` call count plus a no-leak-across-remount count. |
| AS-025 | PASS | — | Guard inversion (`board.tsx:291`) and `addPendingMove` deletion (`:800`) both KILLED, asserting rendered column. |
| AS-026 | PASS | — | Release deletion at `:826` KILLED; guard inversion KILLED (5). |
| AS-027 | **PASS** | — | All four previously-surviving sites (`:841/:864/:875/:886`) now die individually, each via a real drag with a failing Server Action followed by a realtime UPDATE asserted on rendered DOM. Both `{ok:false}` and thrown-rejection paths exercised. |
| AS-028 | PASS | minor | Guard inversion KILLED; predicate covered at `board-optimistic-move-realtime-guard.test.ts:143-159`. Minor-10: still no dedicated component test firing an UPDATE for a task that never had any in-flight move; coverage comes from the post-release state, which is observationally the same map state. |
| AS-029 | PASS | — | `tests/e2e/portal-approve.spec.ts:289-296, 345-356` — window sentinel + Playwright `load`-event counter + admin-client persistence poll. Orchestrator: spec passes. |
| AS-030 | PASS | — | Full teardown `:194-211` incl. `project_members`, workspaces and `auth.admin.deleteUser`. |
| AS-031 | PASS | — | Orchestrator: `npx tsc --noEmit` exit 0. |
| AS-032 | PASS | — | Orchestrator: 0 errors / 15 warnings, all pre-existing `no-unused-vars` on `_`-prefixed mock params. |
| AS-033 | PASS | — | Orchestrator: 209 files / 1636 tests pass. |
| AS-034 | PASS | — | Every new test mocks `createClient` / injects fakes. No new unit test opens a live connection. |

**Totals: 33 PASS, 1 FAIL (AS-006). 0 blockers, 2 majors, 5 minors** (the
known residual RPC-parity minor is excluded per the orchestrator's
acceptance).

---

## Findings

**MAJOR-1 (AS-006) — the test that claims to catch a hand-maintained list
does not catch one.** `tests/unit/check-realtime-publication.test.ts:113-117`
is named "a hardcoded stand-in … would be caught" but only asserts
`discovered !== ["tasks","comments"]` — trivially true for any array of
length ≠ 2. The companion "independent grep" test (`:93-111`) computes
`filesWithBindings` via `execSync` and then **never compares it to
`discovered`**; it asserts only `filesWithBindings.length > 0` and
`discovered.length >= 9`. The independent signal is computed and discarded.
Consequence: replacing the whole body of `discoverSubscribedTables`
(`scripts/check-realtime-publication.mjs:121-130`) with a literal 9-element
sorted array satisfies every AS-006 test. That is precisely the substitution
AS-006 forbids.
*Mitigating:* the implementation is correct — three other mutants (ignoring
multi-line bindings `:80`, non-recursing `walkSourceFiles` `:108`, dropping
`lib` from `SCAN_DIRS` `:23`) are all KILLED, proving discovery genuinely
walks the real `components/`+`lib/` trees today. This is a hole in the
regression net, not a production defect. Marked FAIL per the standing rule
that a test which cannot fail for the assertion's stated reason does not
discharge it.

**MAJOR-2 (new, out of contract) — `npm run realtime:check` can print
`SUPABASE_SECRET_KEY` verbatim.** `scripts/check-realtime-publication.mjs`
has its **own** `redactSecrets` (`:35`), distinct from the drift script's,
and the only call site passes `[accessToken, projectRef]` (`:188`) —
`SUPABASE_SECRET_KEY` is absent. `queryPublishedTables` throws
`new Error(body)` on any non-2xx (`:161`) with server-controlled text, which
reaches stderr through `main()`. Verified with a planted token against
unmutated code:

```
Failed to query the realtime publication from the linked Supabase project. db error: password=sb_secret_LEAKED_VALUE_123 rejected
```

No test covers it. This does **not** fail AS-003, whose wording is scoped to
`migrations:check` (`check-migration-drift.mjs`, whose redaction list at
`:30-33` correctly includes `SUPABASE_SECRET_KEY`) — but it is the same
class of defect AS-003 exists to prevent, on the sibling script, and it is
real.

**MINOR-1 (AS-016)** — the request-changes success path is entirely
untested: deleting `toast.success(...)` and `router.refresh()` leaves 12/12
green. The approve path has this coverage; request-changes does not.

**MINOR-2 (AS-027)** — the three cross-lane assertions in
`tests/unit/f022-board-realtime-guard-call-site.test.tsx` use `.some(...)`
over all `[data-status="in_review"]` nodes, so they prove the update landed
but not in which swimlane.

**MINOR-3 (F024)** — unbounded duplicate comments on a persistently-failing
RPC. `lib/actions/portal-approval.ts:183-219`: if
`request_portal_task_changes_atomic` fails non-transiently (undeployed
migration, permission drift), the comment has already landed and the row is
still pending, so every retry posts another identical
`Requested changes: …` with no idempotency key. The comment at `:202-206`
acknowledges this but assumes transience.

**MINOR-4 (F024)** — a message longer than ~9981 chars is permanently
unsubmittable with a misleading error. `portal-approval.ts:156` has
`.min(1)` but no `.max()`, while `addCommentSchema`
(`lib/validation/comments.ts:26-33`) caps `text` at 10000 and the action
prepends the 19-char `"Requested changes: "` prefix at `:185`. The resulting
validation failure is swallowed into the generic "Something went wrong.
Please try again in a moment." (`:188-193`) — the client is told to retry an
operation that can never succeed.

**MINOR-5 (F024)** — TOCTOU between `resolvePendingClientTask` (`:167`) and
the RPC (`:208`). If the team clears `pending_client_approval` in between,
the comment posts but the RPC rejects; the client sees a generic error and
can never retry, even though the note did land. Not data loss; the pre-check
is advisory and the RPC is the real boundary.

**MINOR-6 (AS-003)** — `redactSecrets` in `check-migration-drift.mjs:36`
silently no-ops for credential values under 6 characters. Verified:
`redactSecrets("tok=abc12", {SUPABASE_ACCESS_TOKEN:"abc12"})` returns the
token intact. Untested.

**MINOR-7 (AS-005)** — every `checkRealtimePublication` test injects both
`discover` and `queryPublished` (`check-realtime-publication.test.ts:129-166`),
so no test proves the real scanner output is what feeds
`findUnpublishedTables`. Combined with MAJOR-1, a substituted scanner yields
a green suite *and* a green `npm run realtime:check`.

**MINOR-8 (AS-008/AS-009)** — `f008-my-tasks-realtime.test.ts:470,510`
simulate "binding dead" by simply not invoking the other channel's callback,
which would pass on a single-channel implementation too. The genuine
independence guarantee comes from `f004-my-tasks-realtime-topology.test.ts:63`.
The assertions hold; the credit belongs elsewhere than the tests named for
them.

**MINOR-9 (AS-021)** — the UPDATE payload at `task-list.test.tsx:171-178`
carries both `status: "Done"` and `status_id: "status-2"`, so
`resolveCategory`'s id-lookup (`task-list.tsx:151`) and name-lookup (`:154`)
are mutually redundant — either alone can be deleted undetected. Untested:
rename-resilience (`status_id` present, name changed).

**MINOR-10 (AS-028)** — no dedicated component test fires a realtime UPDATE
for a task that never had any in-flight move.

**Additional non-assertion finding — `is_project_client` is executable by
PUBLIC.** Live `proacl` is
`{=X/postgres,postgres=X,anon=X,authenticated=X,service_role=X}` — the
leading `=X` is EXECUTE granted to PUBLIC. It was introduced in
`20260902010000` without the `revoke all on function ... from public` its
four siblings received in August. Low severity (a `stable` boolean predicate
keyed on `auth.uid()`, so a caller learns nothing about anyone but
themselves). Pre-existing; **not** caused by F027.

**Systemic carryover (unchanged from round 3, out of contract scope).**
`components/board/use-board-realtime.ts`,
`components/my-tasks/use-my-tasks-realtime.ts` and the calendar hook still
subscribe synchronously on mount with no `getSession`/`setAuth`, so on a
fresh page load they join unauthenticated and RLS-gated events are dropped.
No AS-001..034 assertion covers their live delivery.

**F027 scope carryover.** The migration hardened 5 of 50 exposed
SECURITY DEFINER functions. Live census: 8 on `public, pg_temp`; 13 on
`search_path=""` (safe — fully schema-qualified); **45 still on bare
`search_path=public`**. Highest-value misses: `is_project_visible_to_row`
(the near-duplicate of the function just fixed, used by the `projects`
SELECT policy), `is_workspace_client`, `is_task_client`,
`is_project_workspace_member`, `is_task_workspace_member`,
`is_project_workspace_admin`, `is_project_lead_or_workspace_admin`,
`can_modify_comment`, plus write-path RPCs (`accept_client_request_atomic`,
`create_notification`, `purge_task`, `cascade_delete_task`,
`create_workspace_with_owner`, `start_timer_atomic`, `stop_timer_atomic`)
and ~20 trigger functions.

---

## Does this block shipping?

**No.** Reasoning, explicitly:

- **Zero blockers.** No assertion describes a behaviour the shipped code
  fails to exhibit. Every production defect found in rounds 1–3 is closed
  and independently re-verified here.
- **AS-006's FAIL is a test-net gap, not a broken behaviour.** The verifier
  genuinely scans the source tree today (three separate mutants prove it).
  The risk is future: someone could replace the scanner with a list and CI
  would not notice. That is regression insurance, not a shipping defect.
- **MAJOR-2 (the `realtime:check` secret leak) is a developer-tooling
  path**, not a user-facing or production runtime path. It requires a
  non-2xx from the Supabase Management API whose body echoes the secret
  key, on a script only run locally/CI by the maintainer. It should be
  fixed promptly — it is a one-line change — but it does not gate release.
- All ten minors are hardening or coverage-quality items.

The REJECT is a contract-strictness call (one assertion is not defended by
a discriminating test), not a judgement that the software is unsafe to
ship. Recommended disposition: **ship, and carry FU-W and FU-X as the next
wave.**

---

## Recommended follow-up features

**FU-W — Make the AS-006 test actually discriminate.** `tests/unit/check-realtime-publication.test.ts:93-117`
contains two tests that name the guarantee AS-006 states but cannot fail
for it: the "hardcoded stand-in" test compares against a 2-element array,
and the "independent grep" test computes `filesWithBindings` and never uses
it. Replacing the entire body of `discoverSubscribedTables`
(`scripts/check-realtime-publication.mjs:121-130`) with a literal sorted
9-element array leaves the suite green. Rewrite the grep test to derive the
expected table *set* from the shell scan (e.g. `grep -oh 'table: *"[^"]*"'`
across files containing `"postgres_changes"`, deduped and sorted) and assert
set equality against `discoverSubscribedTables()`, so a subscription added
anywhere in `components/`/`lib/` fails the suite until real discovery picks
it up. Additionally, add one `checkRealtimePublication` test that does *not*
inject `discover`, so the real scanner is proven to be what feeds
`findUnpublishedTables` (closes MINOR-7). Both new tests must fail against
the hardcoded-array mutant.

**FU-X — Redact `SUPABASE_SECRET_KEY` in the realtime verifier, and unify
the two redactors.** `scripts/check-realtime-publication.mjs:188` calls its
local `redactSecrets` (`:35`) with only `[accessToken, projectRef]`, so a
non-2xx Management API body containing the secret key — thrown verbatim at
`:161` and printed by `main()` at `:214` — reaches stderr unredacted
(reproduced with a planted token). Export the drift script's env-keyed
`redactSecrets` (`scripts/check-migration-drift.mjs:27-42`, which covers
`SUPABASE_ACCESS_TOKEN`, `SUPABASE_SECRET_KEY`, `SUPABASE_DB_PASSWORD`,
`SUPABASE_SERVICE_ROLE_KEY`) into a shared module and use it in both
scripts, then delete the local variant. While there, drop the `length >= 6`
early-out (`:36`) or lower it, since it silently no-ops for short
credentials (MINOR-6). Add a test that plants each credential in a simulated
API error body and asserts none of them appears in the returned message.

**FU-Y — Close the request-changes robustness gaps.**
`lib/actions/portal-approval.ts`: (a) add `.max(9981)` to the `message`
schema at `:156`, or surface validation-class `commentResult.error` instead
of the generic retry message at `:188-193`, so a client with a long note is
not told to retry something that can never succeed (MINOR-4); (b) make the
retry-after-RPC-failure path idempotent so a persistently failing RPC does
not accumulate identical `Requested changes: …` comments (MINOR-3);
(c) add the missing success-path test for the request-changes handler in
`components/portal/approval-actions.test.tsx` — deleting `toast.success`
and `router.refresh()` currently leaves the suite green (MINOR-1); and
(d) rewrite `test_AS_016_request_changes_posts_the_comment_before_flipping_the_pending_flag`
(`tests/unit/portal-approval-action.test.ts:334-348`) to record both events
in one shared ordered call-log — it currently asserts the two call arrays
separately and survives the ordering-reversal mutant, so it does not test
what its name claims.

**FU-Z — Finish the `pg_temp` sweep.** F027 hardened 5 of 50 exposed
SECURITY DEFINER functions; 45 remain on bare `search_path = public` per a
live `pg_proc` census. In a NEW migration, pin `public, pg_temp` on the
remaining authorization-boundary predicates first —
`is_project_visible_to_row` (the near-duplicate of the function F027 just
fixed, backing the `projects` SELECT policy), `is_workspace_client`,
`is_task_client`, `is_project_workspace_member`, `is_task_workspace_member`,
`is_project_workspace_admin`, `is_project_lead_or_workspace_admin`,
`can_modify_comment` — then the write-path RPCs and trigger functions. Use
`CREATE OR REPLACE` only (never `DROP`), keep bodies byte-identical, and
re-verify `proconfig`/`prosecdef`/`provolatile`/`proacl` live afterwards, as
was done for F027. Separately, add the missing
`revoke all on function public.is_project_client(uuid) from public;` — it
still carries the default PUBLIC EXECUTE grant its four siblings had revoked
in August.

**Carried forward unchanged from round 3:** FU-U (remaining test-quality
gaps), FU-V (route `use-board-realtime`, `use-my-tasks-realtime` and the
calendar hook through `subscribeWhenAuthenticated`).

---

## Appendix — gate output

Verified by the orchestrator this round and not re-run here:
`npx tsc --noEmit` exit 0; `npm run lint` 0 errors / 15 warnings (all
`no-unused-vars` on `_`-prefixed mock params in tests); 209 files / 1636
tests passing; `npm run migrations:check` clean, 0 drift;
`npm run realtime:check` clean, 9/9 tables published.

Reviewer-run baselines during this round's mutation testing:
- `components/portal/approval-actions.test.tsx`: 12/12 green.
- `tests/unit/f022-board-realtime-guard-call-site.test.tsx` +
  `tests/unit/board-optimistic-move-realtime-guard.test.ts`: 19/19 green.
- `tests/unit/portal-approval-action.test.ts`: 23/23 green.
- Portal realtime suite (7 files): 54/54 green.
- Verifier + My Tasks suites: 51/51 green.

Live DB verification used the Supabase Management API with credentials read
from `.env`; no credential value was printed or written.

**Harness caveat for future rounds:** `vitest run --reporter=basic` exits 1
unconditionally on the installed vitest 4.1.10 (reporter removed), so a
mutation run using it reports a spurious 100% kill rate. Use
`--reporter=verbose`.

All mutants restored. `git status --porcelain -- components lib tests
scripts supabase` clean at exit.

| Mutant | Result |
|---|---|
| reset out of `finally`, request-changes | **KILLED** |
| reset into `catch` only, request-changes | **KILLED** |
| delete `if (!trimmed) return`, request-changes | KILLED |
| delete in-flight guard, request-changes | KILLED |
| remove optimistic set / reverts, request-changes | KILLED |
| `disabled={isPending}` | KILLED |
| delete success toast + refresh, request-changes | SURVIVED |
| delete release `board.tsx:826` | KILLED |
| delete release `board.tsx:841` | **KILLED** |
| delete release `board.tsx:864` | **KILLED** |
| delete release `board.tsx:875` | **KILLED** |
| delete release `board.tsx:886` | **KILLED** |
| `.finally` → `.then`, all five sites | SURVIVED (equivalent) |
| delete `addPendingMove` `:800` | KILLED |
| invert guard `:291` | KILLED |
| revert comment/flag ordering | **KILLED** |
| comment-failure falls through to RPC | KILLED |
| delete comment-failure check | KILLED |
| drop client message from comment body | KILLED |
| RPC error returns `{ok:true}` | KILLED |
| drop `.min(1)` on message | KILLED |
| `discoverSubscribedTables` → hardcoded 9-table array | **SURVIVED** |
| ignore multi-line bindings `:80` | KILLED |
| non-recursing `walkSourceFiles` `:108` | KILLED |
| drop `lib` from `SCAN_DIRS` `:23` | KILLED |
| `findUnpublishedTables` → `[]` | KILLED |
| strip drift redaction layers | KILLED |
| token appended to spawn argv | KILLED |
| `buildChildEnv` → full `process.env` | KILLED |
| delete missing-env guards (both scripts) | KILLED |
| collapse My Tasks topics | KILLED |
| tasks binding onto assignees channel object | KILLED |
| unsubscribe releases one channel only (×2) | KILLED |
| tasks channel gets its own cloned tracked Set | KILLED |
| remove tracked-set gate | KILLED |
| remove `onUpdate` / `onAssigned` | KILLED |
| 27 portal-realtime mutants (AS-018..024) | 25 KILLED, 2 SURVIVED (redundant `resolveCategory` pair) |
