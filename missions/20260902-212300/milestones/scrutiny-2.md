# Scrutiny 2 — Mission 20260902-212300 (post-fix-wave, HEAD bfccd23)

Read-only adversarial re-review. No code, test, or contract was modified.
Part 1 re-checks the 11 round-1 findings by running the mutants the fix
workers claimed to have killed. Part 2 is a first review of F012.

**Milestone verdict: REJECT.** 3 blockers, 9 majors.
Round 1's three blockers (AS-015, AS-028, AS-032) are all genuinely closed.
Three new blockers replace them, all in F012's previously unreviewed work.

## Verdict table (assertions re-examined this round)

| ID | Verdict | Sev | Reason |
|---|---|---|---|
| AS-003 | PASS | — | Every path that surfaces child output is redacted (`scripts/check-migration-drift.mjs:102-107,135`; realtime API body at `check-realtime-publication.mjs:164,195-202`). `buildChildEnv` (`:56-65`) does not forward `SUPABASE_SECRET_KEY` at all. The test plants `sbp_super-secret-token-value` in mocked **stderr** and runs full `checkDrift` (`tests/unit/check-migration-drift.test.ts:126-146`) — end-to-end, not a helper-only test. |
| AS-006 | PASS | minor | Mutant `discoverSubscribedTables → return ["tasks","comments"]` is **KILLED** (3 failures at `tests/unit/check-realtime-publication.test.ts:70,94,118`); one of those cross-checks against an independent shell grep. Residual: the parser still bounds its window at the first `)` after `"postgres_changes"` (`check-realtime-publication.mjs:76`), so a binding with a paren before `table:` is silently dropped — confirmed by probe, fail-open, latent (no current binding hits it). |
| AS-011 | PASS | — | Mutant `new Set(trackedTaskIdsRef.current)` at `components/my-tasks/use-my-tasks-realtime.ts:283` is **KILLED** by `tests/unit/f019-my-tasks-realtime-hook-set-identity.test.tsx:139`, which mounts the real hook and drives a real `task_assignees` INSERT. Round-1 gap closed. |
| AS-014 | FAIL | major | **Unchanged from round 1 — not addressed.** Mutant: move `inFlightRef.current = false` out of `finally` (`components/portal/approval-actions.tsx:80-82`) into the success path only. **All 7 tests still pass.** After any failure the Approve button is permanently inert — the exact "nothing left permanently pending" clause. `approval-actions.test.tsx:93-111` never re-clicks after the failure. Same hole on the request-changes side (`approval-actions.tsx:116-118`). |
| AS-015 | PASS | — | Round-1 blocker closed. Mutant "delete the `inFlightRef` guard in `handleApprove`" (`approval-actions.tsx:58-59`) is **KILLED** at `approval-actions.test.tsx:136`. The `act(() => { button.click(); button.click(); })` rewrite (`:130-133`) is genuinely discriminating. |
| AS-016 | FAIL | major | Half fixed. Double-send mutant (`approval-actions.tsx:90-91`) is **KILLED** at `approval-actions.test.tsx:210`. But the whitespace half still fails: deleting `if (!trimmed) return;` (`approval-actions.tsx:88`) **SURVIVES** — `approval-actions.test.tsx:169-182` clicks a *disabled* button, and jsdom does not dispatch clicks to disabled nodes, so `expect(requestChangesMock).not.toHaveBeenCalled()` is vacuous. Only the `disabled` expression is tested; the handler guard is unenforced. |
| AS-021 | PASS | — | Both round-1 mutants **KILLED** by `components/portal/task-list.test.tsx:128-158`, which now sends `status:"Done"` + a different `status_id` and asserts the row regroups under "Delivered". `resolveCategory` (`task-list.tsx:144-157`) is a real lookup, not the old `?? "not_started"` pin. |
| AS-022 | FAIL | major | Logic is correct and unit-tested, but see the systemic finding below: `components/portal/task-list.tsx` subscribes synchronously on mount with no auth await, which by F012's own written diagnosis means the channel joins unauthenticated on a fresh load and RLS silently drops every UPDATE. The "without a page reload" claim is not true in production. |
| AS-021/AS-023 (runtime) | FAIL | major | Same systemic cause — `components/portal/request-list.tsx:163-170` subscribes synchronously on mount. AS-021's *reconciler* logic passes (row above); its live delivery does not. |
| AS-024 | FAIL | major | F015's fix is real: the `[workspaceId]` deps mutant is now killed by `tests/unit/portal-overview-live.test.tsx:243-268`. But F012's new async path reopened the assertion. `components/portal/use-portal-overview-realtime.ts:58-72` subscribes inside a two-deep `.then` chain guarded only by a `cancelled` flag; **no test unmounts before `getSession()` resolves**, so deleting either `if (cancelled) return` (`:59`, `:65`) creates a channel after unmount that is never torn down — a literal leak, the exact thing AS-024 forbids. The chain also has no `.catch`: a rejected `getSession()`/`setAuth()` yields an unhandled rejection and a silently dead subscription. `onChange` is still omitted from deps with `exhaustive-deps` suppressed (`:78`). |
| AS-025 | FAIL | major | F017's extraction is real and genuinely wired in (`lib/board/pending-moves.ts` ← `components/board/board.tsx:272,291,800,826,841,864,875,886`), and the module tests execute behaviour rather than regex. But the guard's **polarity at its single call site is untested**. Mutant: `board.tsx:291` → `if (!shouldSkipRealtimeUpdate(...))`. **1573/1573 still pass.** The only test touching `board.tsx` is a `renderToStaticMarkup` smoke assertion (`tests/unit/board-optimistic-move-realtime-guard.test.ts:174-199`) that never mounts the realtime handler. |
| AS-026 | FAIL | major | Module-level release→apply transition is real (`…guard.test.ts:110-122`; the unconditional-`map.delete` mutant is KILLED at `:74-81`). But deleting `releasePendingMove(movedTask.id)` from `board.tsx:826` leaves the suite green — no test proves the board's success path releases. |
| AS-027 | FAIL | major | `…guard.test.ts:127-139` is byte-identical to the AS-026 test but for its comment: it calls `releasePendingMove` directly and never proves board.tsx's rollback paths do. Deleting release from `board.tsx:841/864/875/886` survives. |
| AS-028 | FAIL | major | Round-1's "no coverage at all" is fixed at module level (`…guard.test.ts:143-153`), but the same `board.tsx:291` inversion mutant that breaks AS-025 also makes every *unguarded* UPDATE skipped, and no test fails. |
| AS-029 | PASS | — | Not weakened — strengthened. `tests/e2e/portal-approve.spec.ts:289-296,345-356` keeps both the `window.__f011NoReloadSentinel` and the Playwright `load`-event counter, and adds an admin-client `toPass` poll proving the write actually persisted server-side before asserting the row leaves. The removal proof is still `expect(loadEventCount).toBe(0)` plus sentinel survival. |
| AS-030 | PASS | — | Teardown extended, not weakened: `project_members` delete added ahead of `projects` (`:200`), full chain tasks → project_members → projects → workspace_members → workspaces → `auth.admin.deleteUser` (`:194-211`). |
| AS-032 | PASS | — | Round-1 blocker closed. `npm run lint`: 0 errors / 15 warnings, all pre-existing `no-unused-vars`. The `F012_DEBUG` `console.log` and its `as any` are gone from `components/portal/portal-overview-live.tsx`. `git diff 2db1bad -- components lib app \| grep '^+.*console\.\(log\|debug\|info\)'` returns zero matches. |

Assertions not re-examined (AS-001, AS-002, AS-004, AS-005, AS-007–AS-010,
AS-012, AS-013, AS-017–AS-020, AS-031, AS-033, AS-034) retain their round-1
verdicts.

## Part 2 — F012 security review (new, previously unreviewed)

### BLOCKER-1 — `approve_portal_task_atomic` omits the project-visibility check

`supabase/migrations/20260905130000_approve_portal_task_atomic.sql:55-64`
authorizes on **workspace** membership only: active + `role = 'client'` in
the task's workspace. But `is_project_visible_to()`
(`20260902010000_client_role_and_task_client_visibility.sql`) makes an
explicit `project_members` row the *only* way a `client` can see a project —
F012's own E2E fix had to seed one for exactly this reason
(`tests/e2e/portal-approve.spec.ts:155-167`). SECURITY DEFINER bypasses RLS,
so the RPC's own checks are the entire boundary, and they are strictly
weaker than the read boundary.

Concrete attack: an authenticated user who is an active `client` in
workspace W with a `project_members` row for project A only can call
`approve_portal_task_atomic(<task in project B of W>)` and flip
`pending_client_approval` to false on a task in a project they cannot read.
They silently clear another client's approval gate; the team sees the item
leave its "awaiting client" queue with no audit of who did it. Mitigation is
uuid unguessability alone — not an authorization control, and task ids leak
via portal URLs and comment bodies. Non-client workspace members and members
of other workspaces *are* correctly rejected (`:55-64`); anon is correctly
excluded by the grant (`:78-79`); the uniform `'task not found'` message
gives no oracle. Fix: add an `exists (select 1 from project_members …)`
check, or call `is_project_visible_to(v_project_id)` directly.

Secondary, minor: `set search_path = public` (`:30`) omits `pg_temp`, so the
temp schema is still searched ahead of it and a role able to `CREATE TEMP
TABLE` could shadow `tasks`/`workspace_members`. This matches the existing
house convention across the repo, so it is a pre-existing pattern, not a
mission regression — but it is worth `public, pg_temp` on a new SECURITY
DEFINER function.

### BLOCKER-2 — `lib/actions/portal-approval.ts` has zero server-side tests

`grep -rl "portal-approval\|approvePortalTask" tests/ components/` matches
only `components/portal/approval-actions.test.tsx` (the UI). The action's
entire authorization chain — `resolvePendingClientTask` (`:36-77`),
`requireClientCaller` (`:79-97`), and the new
`supabase.rpc("approve_portal_task_atomic", …)` call (`:122-125`) — is
executed by no test at any level, despite a ~190-file `tests/integration/`
suite that covers client-role RLS elsewhere. Deleting the
`requireClientCaller` call, or the `isClient` check inside it, or swapping
the RPC name, leaves the whole suite green. The pre-existing gates were not
weakened (both are still called before the RPC, in the same order), but they
are now the *only* project-agnostic layer in front of a SECURITY DEFINER
function, and nothing verifies they still run.

### BLOCKER-3 — `requestPortalTaskChanges` still silently no-ops

F012 correctly diagnosed that a client cannot UPDATE `tasks` (only
`tasks_update_active_members` from `20260821194500` exists, gated by
`is_project_workspace_writer()`, which excludes `role='client'`) and fixed
`approvePortalTask` with the RPC — then left the identical write on the
adjacent function untouched: `lib/actions/portal-approval.ts:174-177` is
still a plain RLS-respecting `.update({ pending_client_approval: false })`.
PostgREST returns 0 rows with no error, so the function proceeds, posts the
comment, and **returns `{ ok: true }`**. Every real client's "Request
changes" reports success while the flag never flips. Same root cause, one
line away, diagnosed in the same commit.

### MAJOR — the Realtime auth-hydration race was fixed at exactly one of six call sites

`components/portal/use-portal-overview-realtime.ts:58-72` now awaits
`getSession()` + `realtime.setAuth()` before subscribing. `grep -rn
"getSession\|setAuth"` across the other subscribers returns nothing:
`components/portal/task-list.tsx:200-215`,
`components/portal/request-list.tsx:163-170`,
`components/board/use-board-realtime.ts`, and the My Tasks/calendar hooks
all still create and `.subscribe()` a channel synchronously on mount. By the
mechanism F012 itself documented in that file's own comment, each of those
joins unauthenticated on a fresh page load and has every RLS-gated
INSERT/UPDATE silently filtered out. That is precisely what AS-021, AS-022
and AS-023 assert does *not* happen. Their unit tests pass because they
inject fake channels and never exercise the socket.

## Recommended follow-up features

**FU-I — Add the project-visibility check to `approve_portal_task_atomic`.**
The SECURITY DEFINER function authorizes on workspace-level client
membership alone, which is strictly weaker than `is_project_visible_to()`'s
rule that a `client` needs an explicit `project_members` row. Add a
`project_members`/`is_project_visible_to(v_project_id)` check alongside the
existing `workspace_members` test, in a NEW migration (do not edit the
applied one), keeping the uniform `'task not found'` error so no oracle is
introduced. While there, change `set search_path = public` to `set
search_path = public, pg_temp` on this function. Add an integration test in
the style of `tests/integration/client-role-rls.test.ts` that seeds two
projects in one workspace, makes the client a member of only the first, and
asserts the RPC rejects a task id from the second while accepting one from
the first.

**FU-J — Give `lib/actions/portal-approval.ts` real server-side coverage.**
This file is the authorization boundary in front of a SECURITY DEFINER RPC
and has no test at any level. Add tests (unit with a mocked Supabase client
plus integration where practical) that pin: an unauthenticated caller is
rejected; a non-client active workspace member is rejected; a client from a
different workspace is rejected; a task that is not `client_visible`, not
`pending_client_approval`, or soft-deleted is rejected with the generic
message; and the happy path calls `approve_portal_task_atomic` with the
parsed uuid. Each must fail if the corresponding gate is deleted.

**FU-K — Make "Request changes" actually persist.** `requestPortalTaskChanges`
(`lib/actions/portal-approval.ts:174-177`) still issues the plain
RLS-respecting UPDATE that F012 proved is unreachable for a `client` role,
gets 0 rows and no error back, and returns `{ ok: true }`. Route it through
a narrow SECURITY DEFINER RPC on the same terms as the approve path (same
caller/visibility/pending re-verification, same project-membership check
from FU-I), or generalise the existing RPC with a reason parameter. Add a
test asserting a zero-row update is treated as a failure rather than
success, so this class of silent no-op cannot recur.

**FU-L — Hoist the Realtime auth-hydration fix to every subscriber.** F012
fixed a systemic bug in one file. Extract the "await `getSession()`, call
`realtime.setAuth(token)`, then subscribe, with a `cancelled` guard and a
`.catch`" sequence into a shared helper (e.g.
`lib/realtime/subscribe-when-authenticated.ts`) and route
`components/portal/task-list.tsx`, `components/portal/request-list.tsx`,
`components/board/use-board-realtime.ts`, the My Tasks hook and the calendar
hook through it. Add a test that unmounts before the session promise
resolves and asserts no channel is ever created (this also closes the
untested `cancelled` guards that currently make AS-024 fail), and a test
that a rejected `getSession()` is handled rather than becoming an unhandled
rejection.

**FU-M — Test the board's realtime guard at its call site, not just in the
module.** `lib/board/pending-moves.ts` is now correct and behaviourally
tested, but inverting `board.tsx:291` to
`if (!shouldSkipRealtimeUpdate(...))`, or deleting any of the five
`releasePendingMove` calls at `board.tsx:826/841/864/875/886`, leaves all
1573 tests green — the only board-level test is a `renderToStaticMarkup`
smoke check. Mount the board with a mocked `useBoardRealtime`/Supabase
channel (the pattern `components/portal/task-list.test.tsx` already uses
successfully) and assert the rendered card's column after: a guarded UPDATE
(unchanged, AS-025), an unguarded UPDATE (applied, AS-028), an UPDATE after
a successful settle (applied, AS-026), and an UPDATE after a failing settle
(applied, AS-027). Each must fail under the inversion mutant.

**FU-N — Close the two surviving approval-actions mutants.** Two round-1
findings were not addressed. (1) AS-014: moving `inFlightRef.current = false`
out of `finally` (`approval-actions.tsx:80-82`, and `:116-118` for request
changes) leaves the suite green while making the button permanently inert
after any failure — add a test that, after a rejected approve, clicks again
and asserts a second call. (2) AS-016: deleting `if (!trimmed) return`
(`:88`) survives because the whitespace test clicks a *disabled* button and
jsdom drops the event — exercise the submit handler directly with a
whitespace message, independent of the `disabled` attribute.

**FU-O — Harden the realtime verifier's parser and both scripts' top level.**
`scripts/check-realtime-publication.mjs:76` bounds its search window at the
first `)` after `"postgres_changes"`, so any binding whose options object
contains a paren before `table:` is silently dropped and the verifier
reports a clean pass over a smaller set — confirmed by probe, fail-open, and
latent only because no current binding is written that way. Replace the
window bound with brace-matching over the options object, or at minimum warn
when a `"postgres_changes"` occurrence yields no table, and add fixtures for
the three shapes that currently escape. Separately, neither script's
`main()` has a try/catch (`check-migration-drift.mjs:163-171`,
`check-realtime-publication.mjs:222-230`), so an unexpected throw prints a
raw stack trace, contrary to the "explanatory message, not a stack trace"
shape AS-004 establishes.

---

## Appendix — gate output

Independently confirmed by the orchestrator this round and not re-run here:
`npx tsc --noEmit` exit 0; `npm run lint` 0 errors / 15 warnings (all
pre-existing `no-unused-vars` on underscore-prefixed mock params);
1590/1590 unit+component tests across 206 files.

Reviewer-run baselines during mutation testing:
- `tests/unit/` + `components/portal/task-list.test.tsx`: 203 files / 1573 tests green.
- `components/portal/approval-actions.test.tsx`: 7/7 green.
- `tests/unit/check-realtime-publication.test.ts`: 28/28 green.

Mutants run this round (all source restored; `git status --porcelain --
components lib tests scripts` clean at exit):

| Mutant | Result |
|---|---|
| delete `inFlightRef` guard, `approval-actions.tsx:58-59` | KILLED |
| delete `inFlightRef` guard, `approval-actions.tsx:90-91` | KILLED |
| delete `if (!trimmed) return`, `approval-actions.tsx:88` | **SURVIVED** |
| `inFlightRef` reset out of `finally`, `approval-actions.tsx:80-82` | **SURVIVED** |
| invert guard, `board.tsx:291` | **SURVIVED** (1573/1573 pass) |
| `releasePendingMove` → unconditional `map.delete` | KILLED |
| `new Set(...)`, `use-my-tasks-realtime.ts:283` | KILLED |
| `status: existing?.status ?? raw.status`, `task-list.tsx:165` | KILLED |
| `category: existing?.category ?? "not_started"`, `task-list.tsx:182-187` | KILLED |
| `discoverSubscribedTables → return ["tasks","comments"]` | KILLED (3 failures) |
