# Scrutiny 3 — Mission 20260902-212300 (post-wave-3, baseline 2db1bad → HEAD 784e76e)

Read-only adversarial review. No code, test, contract or mission state was
modified; `git status --porcelain -- components lib tests scripts supabase`
is clean at exit. Every mutant below was re-run by this round's reviewers,
not taken from a worker's claim.

**Milestone verdict: REJECT.** 0 blockers, 5 majors, 2 minors.
All three of round 2's blockers (BLOCKER-1 project-visibility gap,
BLOCKER-2 zero server-side coverage, BLOCKER-3 silent no-op) are genuinely
closed. The rejection is on two round-2 findings that wave 3 fixed on only
one of two/five symmetric code paths, plus one new data-loss path that
wave 3 itself introduced.

---

## Part 1 — did wave 3 close round 2's findings?

### F020 — `approve_portal_task_atomic` security. CLOSED.

Attacker enumeration re-done from scratch against
`supabase/migrations/20260906010000_portal_task_actions_project_visibility.sql`.
All three functions delegate to `assert_portal_task_actionable_by_client`
(`:35-92`), so both RPCs are subject to an identical gate chain — no gap
was reintroduced by the new sibling.

| Attacker | Result | Gate |
|---|---|---|
| client of W, `project_members` for project A only, acting on a task in project B of W | BLOCKED | `:82` `is_project_visible_to(v_project_id)` |
| non-client active member of W | BLOCKED | `:66-75` `wm.role = 'client'` |
| member of a different workspace | BLOCKED | `:69` `wm.workspace_id = v_workspace_id` |
| unauthenticated | BLOCKED twice | `:51-53` `auth.uid() is null`; `revoke all … from public` + grant only to `authenticated` (`:118-119`, `:145-146`) |
| inactive / pending member | BLOCKED | `:71` `wm.status = 'active'` |

Verified rather than assumed:
- `is_project_visible_to`'s broad branch is `wm.role not in ('guest','client')`
  (`20260902010000_client_role_and_task_client_visibility.sql:83-104`), so for
  a `client` the only satisfiable disjunct really is the `project_members`
  `exists`. The unique constraint
  `workspace_members_workspace_user_unique` (`20260817222532_create_workspaces.sql:33`)
  makes a second non-client row in the same workspace impossible, and the
  join is pinned to `p.workspace_id`, so a row from another workspace cannot
  satisfy it either. `auth.uid()` is a GUC read and still resolves to the
  real caller inside a SECURITY DEFINER frame.
- `search_path` is pinned `public, pg_temp` on all three new functions
  (`:41`, `:105`, `:132`).
- The helper's `revoke all … from public` with no grant does block direct
  PostgREST calls, and `perform * from public.assert_…` (`:108`, `:135`)
  still works because both RPCs run as the owner, who retains implicit
  EXECUTE.
- `request_portal_task_changes_atomic` is subject to exactly the same gates,
  grants, revokes, `search_path` and uniform `'task not found'` message as
  its sibling. `lib/actions/portal-approval.ts:179-190` calls it and treats
  any error as `{ ok: false }` — the silent-no-op class is gone.

### F021 — approval-actions mutants. HALF CLOSED.

| Mutant | Result | Killed by |
|---|---|---|
| `inFlightRef.current = false` out of `finally`, approve (`approval-actions.tsx:77-82`) | KILLED | `test_AS_014_ref_is_cleared_after_a_rejected_action_allowing_retry`, `…_after_ok_false_…` |
| same, request-changes (`approval-actions.tsx:113-118`) | **SURVIVED** | — |
| delete `if (!trimmed) return;` (`:88`) | KILLED | `test_AS_016_handler_guard_rejects_whitespace_only_message_even_when_enabled` |
| delete in-flight guard, approve (`:58`) | KILLED | `test_AS_015_second_synchronous_approve_click_issues_no_second_call` |
| delete in-flight guard, request-changes (`:90`) | KILLED | `test_AS_016_second_synchronous_send_click_issues_no_second_call` |
| `disabled={isPending \|\| !message.trim()}` → `disabled={isPending}` (`:167`) | KILLED | `approval-actions.test.tsx:240,297` |

The test-only Button stub is legitimate and was verified empirically, not
accepted on its comment: with the real Base UI `Button`, a whitespace-only
message renders `disabled` and the click is swallowed inside Base UI's own
closure even after `removeAttribute("disabled")`, so the stub is the only
way to reach `handleRequestChanges` at all. It renders a real `<button>`,
forwards `onClick`/`children`/props, is scoped with
`vi.resetModules()`+`vi.doMock`/`vi.doUnmock` (`approval-actions.test.tsx:262-306`),
and does **not** hide a `disabled`-expression regression, because
`approval-actions.test.tsx:231-244` still asserts `toBeDisabled()` against
the real Button and kills the disabled-expression mutant.

### F022 — board call-site test. PARTLY CLOSED.

Baseline 15/15 across the two board files.

| Mutant | Result |
|---|---|
| invert `board.tsx:291` → `if (!shouldSkipRealtimeUpdate(...))` | **KILLED** (`test_AS_025_a_stale_realtime_UPDATE_…`) |
| delete `addPendingMove(movedTask.id, pendingCallCount)` (`board.tsx:800`) | **KILLED** |
| delete `releasePendingMove` at `board.tsx:826` (moveAndReorderTask) | **KILLED** |
| delete at `:841` (reorderTask, same-column reorder) | **SURVIVED** |
| delete at `:864` (crossLane, groupBy=priority) | **SURVIVED** |
| delete at `:875` (crossLane, groupBy=assignee) | **SURVIVED** |
| delete at `:886` (crossLane, groupBy=tag) | **SURVIVED** |

Survivors were re-run against `f225-swimlane-drag-reassign`,
`f224-board-swimlane-grouping`, `board-move-status-wiring`,
`board-optimistic-rollback-toast`, `f249-quick-add-optimistic` and
`f264-mobile-board` — all green.

The test itself is genuine, not self-mocking: it mounts the real `<Board>`
(`tests/unit/f022-board-realtime-guard-call-site.test.tsx:163`), uses the
real `handleDragEnd` via a captured `onDragEnd` (only `DndContext`/
`DragOverlay` are replaced, everything else is `importOriginal`, `:38-53`),
runs the real `subscribeToBoardRealtime` → `acquireSharedTopicChannel` →
`setTasks` → `reconcileTask` chain with only `@/lib/supabase/client` faked,
keeps the Server Action as a genuinely unresolved deferred (`:92-100`), and
asserts on rendered DOM (`[data-status=…]`, `:189,209,231`) rather than on
`pendingMovesRef`. Its weakness is scope: one `it()`, one drag shape, and
no failing-action drag anywhere.

### F023 — shared realtime helper. CLOSED.

Teardown holds on every enumerated path
(`lib/realtime/subscribe-when-authenticated.ts:36-66`): unmount before
`getSession`, between `getSession` and `setAuth`, after `subscribe`,
`getSession` rejects, `setAuth` rejects, no session, double `release()`
(idempotent via `shared-topic-channel.ts:127-129`). `realtime.setAuth` is
confirmed `async` in the installed `@supabase/realtime-js` 2.112.3
(`RealtimeClient.js:379`), so the `.then` chain at `:51` is sound.

| Mutant | Result |
|---|---|
| delete second `if (cancelled) return;` (`:52`) | KILLED |
| `release?.()` → no-op (`:64`) | KILLED (5 tests) |
| remove `cancelled = true` (`:63`) | KILLED (5 tests) |
| delete `.catch` (`:56`) | KILLED (run exits 1 — via vitest's unhandled-rejection detector, no assertion) |
| delete first `if (cancelled) return;` (`:46`) | SURVIVED (subsumed by the second guard; only a wasted `setAuth`) |
| no-token branch subscribes synchronously | SURVIVED |
| revert helper to a bare synchronous `subscribe(supabase)` | 18 delivery tests still pass; caught only by `subscribe-when-authenticated.test.ts:41` |

Hoisting did **not** change behaviour for the overview hook — it improved
it. Versus the inline `bfccd23` version, the inner `afterAuth.then(...)` is
now `return`ed (`:51`) so a `setAuth` rejection is chained rather than
orphaned, and a `.catch` was added. Ordering, both `cancelled` guards, the
cleanup shape, the `[workspaceId]` deps array and the (pre-existing)
`onChange` staleness are all unchanged; the `workspaceId`-change
re-subscribe is still covered by
`tests/unit/portal-overview-live.test.tsx`'s
`test_AS_024_subscription_is_torn_down_and_reacquired_when_workspace_id_changes`.

---

## Part 2 — final sweep, AS-001 … AS-034

| ID | Verdict | Sev | Evidence |
|---|---|---|---|
| AS-001 | PASS | — | `scripts/check-migration-drift.mjs` `findDrift`; `tests/unit/check-migration-drift.test.ts:56`. Orchestrator: `migrations:check` clean, 149 migrations, 0 drift. |
| AS-002 | PASS | — | Drifted versions named in the message (`check-migration-drift.mjs:88-95`); test asserts the exact version string. |
| AS-003 | PASS | — | `redactSecrets` (`check-migration-drift.mjs:27-42`) applied to child stderr at `:106` and to the realtime API body (`check-realtime-publication.mjs:164,195-202`); `buildChildEnv:56-65` never forwards `SUPABASE_SECRET_KEY`. Test plants a token in mocked stderr and runs full `checkDrift` (`check-migration-drift.test.ts:126-146`). |
| AS-004 | PASS | — | Early return with a plain message before any spawn; `spawnSync` asserted not called (`check-migration-drift.mjs:70-76`). |
| AS-005 | PASS | minor | Real discovery returns the 9 bound tables; orchestrator `realtime:check` clean 9/9. Residual latent parser bound at `check-realtime-publication.mjs:76` (see minor-2). |
| AS-006 | PASS | — | `discoverSubscribedTables → ["tasks","comments"]` mutant KILLED at `tests/unit/check-realtime-publication.test.ts:70,94,118`, one of which cross-checks an independent shell scan. |
| AS-007 | PASS | — | Distinct topics `…:assignees` / `…:tasks`, one `.on()` each (`use-my-tasks-realtime.ts:137-138,146,192`); collapsing fails `f004-my-tasks-realtime-topology.test.ts:74,85,95`. |
| AS-008 | PASS | — | `f008-my-tasks-realtime.test.ts:470-508`. |
| AS-009 | PASS | — | `f008-my-tasks-realtime.test.ts:510-536`, cross-killed by `f004:74,95`. |
| AS-010 | PASS | — | `use-my-tasks-realtime.ts:233-236`; idempotent release `shared-topic-channel.ts:125-129`; asserted `f004:125,132,138`. |
| AS-011 | PASS | — | `new Set(trackedTaskIdsRef.current)` mutant at `use-my-tasks-realtime.ts:283` KILLED by `tests/unit/f019-my-tasks-realtime-hook-set-identity.test.tsx:139`. |
| AS-012 | PASS | — | `setOptimisticApproved(true)` before `startTransition` (`approval-actions.tsx:63`); asserted with the action promise unresolved (`approval-actions.test.tsx:74`). |
| AS-013 | PASS | — | Revert + `toast.error(result.error)` (`approval-actions.tsx:69-73`, `:103-107`); `approval-actions.test.tsx:93`. Server side: every gate in `lib/actions/portal-approval.ts` is killed by a negative test in `tests/unit/portal-approval-action.test.ts` (`:142,149,157,165,173,181,189,197`). |
| AS-014 | PASS | — | Round-2 mutant (reset out of `finally`, `approval-actions.tsx:77-82`) now KILLED by the two retry-after-failure tests (`approval-actions.test.tsx:113-146,148-173`). |
| AS-015 | PASS | — | Guard deletion at `approval-actions.tsx:58` KILLED by `approval-actions.test.tsx:175-199`. |
| AS-016 | **FAIL** | **major** | See MAJOR-1: `inFlightRef.current = false` moved out of `finally` in the request-changes handler (`approval-actions.tsx:113-118`) **SURVIVES**. Whitespace guard (`:88`), double-send guard (`:90`) and the `disabled` expression (`:167`) are all now killed. |
| AS-017 | PASS | — | `client_requests` added to `supabase_realtime` idempotently; orchestrator `realtime:check` 9/9. |
| AS-018 | PASS | — | `lib/portal/reconcile-portal-realtime-task.ts:83-88`; mutants killed at `portal-overview-live.test.tsx:79`, `reconcile-portal-realtime-task.test.ts:131`. |
| AS-019 | PASS | — | `reconcile-portal-realtime-task.ts:90-95`; `portal-overview-live.test.tsx:111`. |
| AS-020 | PASS | — | Single gate `reconcile-portal-realtime-task.ts:59`; DELETE path keyed on `old.id` only (`:101-106`), proven with an id-only payload (`…test.ts:155`, `task-list.test.tsx:127`). |
| AS-021 | PASS | minor | `task-list.tsx:267-278` subscribes through the guard; status/title delivery at `task-list.test.tsx:118`; `resolveCategory` (`task-list.tsx:144-157`) is a real lookup. Minor-1: the component tests would still pass against a synchronous (unhydrated) subscribe. |
| AS-022 | PASS | — | DELETE / `client_visible` removal at `task-list.tsx:219-226`; `task-list.test.tsx:196,215,240`. |
| AS-023 | PASS | — | `request-list.tsx:164-173`; `request-list.test.tsx:122,150,180`. |
| AS-024 | PASS | minor | Teardown holds on every path; `release?.()` and `cancelled = true` mutants both KILLED across all three subscribers (`subscribe-when-authenticated.test.ts`, `task-list.test.tsx`, `request-list.test.tsx`, `portal-overview-live.test.tsx`). Round-2's untested `cancelled` guards and missing `.catch` are closed. Minor-3: a throwing `subscribe()` is swallowed by the new blanket `.catch`. |
| AS-025 | PASS | — | Inverted `board.tsx:291` and deleted `addPendingMove` (`:800`) both KILLED by `tests/unit/f022-board-realtime-guard-call-site.test.tsx:200-211`, asserting rendered column. |
| AS-026 | PASS | minor | Deleting `releasePendingMove` at `board.tsx:826` KILLED (`f022…test.tsx:216-232`). Minor-4: only the `moveAndReorderTask` path; the `reorderTask` release at `:841` is untested. |
| AS-027 | **FAIL** | **major** | See MAJOR-2. No test drives board.tsx's rollback path and then a realtime update. `board-optimistic-move-realtime-guard.test.ts:127-141` calls `releasePendingMove` on a bare Map and self-describes as "simulating the failure path". Narrowing any `.finally` to `.then`, or deleting the release at `:841/:864/:875/:886`, leaves the suite green. |
| AS-028 | PASS | minor | Predicate covered at `board-optimistic-move-realtime-guard.test.ts:143-159`; the call site is covered transitively by the inverted-guard mutant kill. Minor-5: no component-level dispatch with an empty pending map. |
| AS-029 | PASS | — | `tests/e2e/portal-approve.spec.ts:289-296,345-356` (sentinel + `load`-event counter + admin-client persistence poll). Orchestrator: spec passes. |
| AS-030 | PASS | — | Full teardown chain `:194-211` including `project_members` and `auth.admin.deleteUser`. |
| AS-031 | PASS | — | Orchestrator: `npx tsc --noEmit` exit 0. |
| AS-032 | PASS | — | Orchestrator: 0 errors / 15 warnings, all pre-existing `no-unused-vars` on `_`-prefixed mock params. |
| AS-033 | PASS | — | Orchestrator: 209 files / 1627 tests pass. |
| AS-034 | PASS | — | Every new test mocks `createClient` / injects fakes; `tests/unit/portal-approval-action.test.ts` mocks the Supabase client wholesale. No new unit test opens a live connection. |

## Findings

**MAJOR-1 (AS-016) — blocker-class fix applied to one of two symmetric handlers.**
Round 2 named `approval-actions.tsx:80-82` *and* `:116-118`. F021 pinned only
the approve side. Moving `inFlightRef.current = false` out of the
request-changes `finally` (`components/portal/approval-actions.tsx:113-118`)
still leaves the suite green, so a Send button that is permanently inert
after any single failed request-changes would ship undetected —
`test_AS_016_request_changes_gets_optimistic_apply_and_revert_on_failure`
(`approval-actions.test.tsx:201`) exercises the `ok:false` revert but never
re-clicks.

**MAJOR-2 (AS-027) — rollback release still unproven at the call site.**
F022 covered one of five release sites. Four (`board.tsx:841,864,875,886`)
survive deletion, and no test anywhere resolves a board drag action with
`{ ok: false }` or a rejection and then delivers a realtime update. A
same-column reorder or any cross-lane drag can leave a task permanently deaf
to realtime with nothing failing.

**MAJOR-3 (new, wave 3) — `requestPortalTaskChanges` clears the flag before
the client's note is guaranteed to land.** `lib/actions/portal-approval.ts:179-206`
now really flips `pending_client_approval` (that is the BLOCKER-3 fix), then
posts the comment; if `addComment` fails it returns `{ ok: false }`. The UI
reverts to the pre-click pending state and toasts an error, but the row is
already non-pending and no message was recorded. The client's note is lost,
the task silently stops being pending, and a retry cannot recover: the RPC's
`v_pending` check (`20260906010000…sql:86-88`) now raises `'task not found'`,
so every subsequent attempt fails generically. Approve's equivalent
(`:138-141`) is deliberately best-effort and does not have this problem.
This path was unreachable before wave 3 because the UPDATE never applied.

**MAJOR-4 (new) — the authorization boundary now rests on a function whose
`search_path` omits `pg_temp`.** The new RPCs correctly pin
`public, pg_temp`, but the predicate they delegate to,
`public.is_project_visible_to` — along with `is_project_client`,
`is_project_workspace_writer`, `is_task_workspace_writer` —
sets only `search_path = public`
(`20260902010000_client_role_and_task_client_visibility.sql:56,82,122,140,198`).
Postgres searches `pg_temp` first when it is not explicitly listed, so a role
with TEMP privileges (the Supabase default for `authenticated`) can create
`pg_temp.projects` / `pg_temp.project_members` / `pg_temp.workspace_members`
and shadow the tables inside these SECURITY DEFINER functions. Pre-existing,
but round 2's BLOCKER-1 fix is exactly as strong as this function.

**MAJOR-5 (new) — the two RPCs are byte-identical, so the "request changes
always carries a note" invariant is not enforced anywhere.**
`20260906010000…sql:110-114` and `:137-141` have identical bodies. A client
can call `request_portal_task_changes_atomic` directly through PostgREST and
clear the pending flag with no message at all. The header comment at `:121-125`
("neither can be invoked with the other's semantics by accident") is
factually wrong — there is no DB-level distinction between them.

**MINOR-1 (AS-021/022/023)** — reverting `subscribeWhenAuthenticated` to a
bare synchronous `subscribe(supabase)` leaves all 18 component delivery
tests green; only `subscribe-when-authenticated.test.ts:41` catches it.
Flushing microtasks is a no-op for a synchronous subscribe, so the component
tests prove reconciliation, not hydration ordering.

**MINOR-2 (AS-005)** — `scripts/check-realtime-publication.mjs:76` still
bounds its window at the first `)` after `"postgres_changes"`; a binding with
a paren before `table:` is silently dropped. Fail-open, latent, unchanged
from round 2.

**MINOR-3 (AS-024)** — if `subscribe(supabase)` throws,
`lib/realtime/subscribe-when-authenticated.ts:56` swallows it and `release`
stays null. `acquireSharedTopicChannel` builds and joins the channel before
registering it (`lib/realtime/shared-topic-channel.ts:113-119`), so a throw
from `.on()` leaves a channel created, unregistered and unreleasable — and
the new blanket `.catch` now hides the error that used to surface.

**MINOR-4 / MINOR-5** — as noted in the AS-026 / AS-028 rows.

**MINOR-6** — test gaps in `tests/unit/portal-approval-action.test.ts`:
`taskLookupError` is never set; approve's best-effort comment semantics are
unpinned (flipping approve to return `{ ok: false }` on comment failure
passes the whole suite); no test covers zero-rows-without-error from either
RPC. Also, `subscribe-when-authenticated.test.ts`'s `.catch` coverage relies
on vitest's unhandled-rejection detector rather than on an assertion, and
the `session === null` async-ordering branch is unproven.

**Systemic carryover (out of contract scope, not counted above).** F023
routed only the three portal subscribers through the helper.
`components/board/use-board-realtime.ts`,
`components/my-tasks/use-my-tasks-realtime.ts` and the calendar hook still
create and `.subscribe()` a channel synchronously on mount (no `getSession`/
`setAuth` anywhere in those files), so on a fresh page load they join
unauthenticated and every RLS-gated INSERT/UPDATE is filtered out by the
mechanism F012 documented. No AS-001..034 assertion covers their live
delivery, so this does not fail an assertion, but it is the same production
bug on three more surfaces.

## Recommended follow-up features

**FU-P — Pin the request-changes in-flight reset.** `components/portal/approval-actions.tsx:113-118`
resets `inFlightRef.current` in a `finally`, but nothing proves it: moving
that reset into the success path leaves the whole suite green while making
the Send button permanently inert after any single failed request-changes.
Add the request-changes analogue of
`test_AS_014_ref_is_cleared_after_a_rejected_action_allowing_retry` — reject
the first `requestPortalTaskChanges`, wait for the form to return, click Send
again, and assert a second call is issued — plus an `{ ok: false }` variant
matching the approve side. Both must fail against the reset-out-of-`finally`
mutant.

**FU-Q — Cover the board's four remaining release sites and its rollback
path.** Deleting `releasePendingMove` at `components/board/board.tsx:841`
(same-column reorder), `:864` (crossLane priority), `:875` (crossLane
assignee) or `:886` (crossLane tag) leaves every test green, and no test
anywhere resolves a board drag action with `{ ok: false }` or a rejection and
then delivers a realtime update — so AS-027 is asserted only by a bare-Map
simulation that never invokes board.tsx. Extend
`tests/unit/f022-board-realtime-guard-call-site.test.tsx` with one component
test per remaining path: a same-column reorder drag, and a cross-lane drag
under each `groupBy`, each resolving the action with a failure (and one with
a thrown rejection) and then asserting a later realtime UPDATE for that task
IS applied to the rendered DOM. Each must fail when its release site is
deleted or its `.finally` is narrowed to `.then`.

**FU-R — Make request-changes atomic, or order it so the note cannot be
lost.** `lib/actions/portal-approval.ts:179-206` clears
`pending_client_approval` via the RPC and only then posts the client's
message; if `addComment` fails, the action returns `{ ok: false }` and the UI
reverts, but the row is already non-pending, the note is gone, and the RPC's
`v_pending` check makes every retry raise `'task not found'` — the client is
permanently stuck with a generic error. Either post the comment first and
flip the flag only after it lands, or take a reason/comment parameter into
`request_portal_task_changes_atomic` so the flip and the note happen in one
transaction. Add a test that fails `addComment` and asserts the flag was not
cleared (or that the failure is recoverable by retrying).

**FU-S — Add `pg_temp` to the schema's SECURITY DEFINER predicates.**
`public.is_project_visible_to`, `is_project_client`,
`is_project_workspace_writer` and `is_task_workspace_writer`
(`supabase/migrations/20260902010000_client_role_and_task_client_visibility.sql:56,82,122,140,198`)
set `search_path = public` only. Postgres implicitly searches `pg_temp`
ahead of an unlisted schema, so a role with TEMP privileges can shadow
`projects`/`project_members`/`workspace_members` inside these SECURITY
DEFINER bodies. Since `is_project_visible_to` is now the authorization
boundary for both portal RPCs, change all four to
`set search_path = public, pg_temp` in a NEW migration and sweep the rest of
the repo's SECURITY DEFINER functions for the same pattern.

**FU-T — Enforce the "request changes carries a note" invariant in SQL, or
stop claiming it.** `request_portal_task_changes_atomic` and
`approve_portal_task_atomic`
(`supabase/migrations/20260906010000_portal_task_actions_project_visibility.sql:110-114,137-141`)
have identical bodies, so a client can call the request-changes RPC directly
via PostgREST and clear the pending flag with no message — the header comment
at `:121-125` asserting otherwise is wrong. Either give the request-changes
RPC a required `p_message` parameter and have it write the comment itself, or
correct the comment and document that the note is an application-layer
convention only.

**FU-U — Close the remaining test-quality gaps.** (a) Reverting
`lib/realtime/subscribe-when-authenticated.ts` to a synchronous subscribe
leaves all 18 portal delivery tests green — add a component-level test whose
`getSession` stays pending while a realtime event is dispatched, asserting
the event is not missed. (b) Wrap `release = subscribe(supabase)` in its own
try so a throwing `.on()` cannot leave an orphan channel behind the blanket
`.catch`, and test it. (c) Add a `session === null` variant of the
"unmount before hydration" test. (d) In
`tests/unit/portal-approval-action.test.ts`, cover `taskLookupError`,
approve's best-effort comment semantics, and a zero-rows-without-error RPC
response.

**FU-V — Route the remaining three subscribers through the auth-hydration
helper.** `components/board/use-board-realtime.ts`,
`components/my-tasks/use-my-tasks-realtime.ts` and the calendar hook still
subscribe synchronously on mount (no `getSession`/`setAuth` in any of them),
so on a fresh page load they join unauthenticated and RLS-gated INSERT/UPDATE
events are silently dropped — the same bug F012 diagnosed and F023 fixed for
the portal. Route each through `subscribeWhenAuthenticated` and add, per
surface, a test that unmounts before the session promise resolves and asserts
no channel is created.

---

## Appendix — gate output

Verified by the orchestrator this round and not re-run here:
`npx tsc --noEmit` exit 0; `npm run lint` 0 errors / 15 warnings (all
`no-unused-vars` on `_`-prefixed mock params in tests); 209 files / 1627
tests passing; `npm run migrations:check` clean (149 migrations, 0 drift);
`npm run realtime:check` clean (9/9 tables published);
`tests/e2e/portal-approve.spec.ts` passing.

Reviewer-run baselines during mutation testing:
- `components/portal/approval-actions.test.tsx`: 10/10 green.
- `tests/unit/f022-board-realtime-guard-call-site.test.tsx` + `tests/unit/board-optimistic-move-realtime-guard.test.ts`: 15/15 green.
- `tests/unit/subscribe-when-authenticated.test.ts` + the three portal component suites: 29/29 green.

All mutants restored; `git status --porcelain -- components lib tests scripts supabase` clean at exit.

| Mutant | Result |
|---|---|
| invert `board.tsx:291` | KILLED |
| delete `addPendingMove`, `board.tsx:800` | KILLED |
| delete `releasePendingMove`, `board.tsx:826` | KILLED |
| delete `releasePendingMove`, `board.tsx:841` | **SURVIVED** |
| delete `releasePendingMove`, `board.tsx:864` | **SURVIVED** |
| delete `releasePendingMove`, `board.tsx:875` | **SURVIVED** |
| delete `releasePendingMove`, `board.tsx:886` | **SURVIVED** |
| reset out of `finally`, approve (`approval-actions.tsx:77-82`) | KILLED |
| reset out of `finally`, request-changes (`:113-118`) | **SURVIVED** |
| delete `if (!trimmed) return`, `:88` | KILLED |
| delete in-flight guard, `:58` | KILLED |
| delete in-flight guard, `:90` | KILLED |
| `disabled={isPending}`, `:167` | KILLED |
| delete second `if (cancelled) return`, helper `:52` | KILLED |
| delete first `if (cancelled) return`, helper `:46` | SURVIVED (subsumed) |
| `release?.()` → no-op, helper `:64` | KILLED |
| remove `cancelled = true`, helper `:63` | KILLED |
| delete `.catch`, helper `:56` | KILLED (via unhandled-rejection detector) |
| no-token branch subscribes synchronously | SURVIVED |
| revert helper to synchronous subscribe | 18 delivery tests still green |
