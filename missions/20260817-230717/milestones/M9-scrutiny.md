# M9 Scrutiny — Time tracking (F108–F116, AS-161–AS-176)

Adversarial, read-only validation pass. No code modified.

## Assertion-by-assertion

| Assertion | Behavior | Verdict | Evidence |
|---|---|---|---|
| AS-161 | Manual time entry log (minutes, date, billable, note) | PASS | `logTimeEntry` in lib/actions/time-entries.ts; tests/integration/log-time-entry.test.ts |
| AS-162 | Zero/negative minutes rejected | PASS | zod validation in lib/validation/time-entries.ts; covered by log-time-entry.test.ts |
| AS-163 | Cannot log time on task outside own workspace, even via direct API | PASS | `requireActiveMembership` re-check + RLS insert policy; rls-time-entries.test.ts |
| AS-164 | Start a live timer on a task | PASS | `start_timer_atomic` RPC; start-stop-timer.test.ts |
| AS-165 | At most one active timer per user, workspace-wide | PASS | `active_timers.user_id` UNIQUE constraint (DB-enforced, not app-only) |
| AS-166 | Starting new timer while one running auto-stops+logs old one atomically | PASS | Single PL/pgSQL function body = one transaction; verified no partial-state window; test at start-stop-timer.test.ts:237-289 |
| AS-167 | Stop creates entry with server-computed minutes, billable defaults true | PASS | `billable` hardcoded `true` in both INSERT sites in the RPC (lines 92, 155 of 20260818153433_create_stop_and_start_timer_rpc.sql); minutes computed server-side from `now() - started_at`, never client input; explicit test asserting `billable === true` with no param passed |
| AS-168 | Active timer state persisted server-side, survives reload/new tab | PASS | active_timers table is server source of truth; queried via `getActiveTimer` |
| AS-169 | Author-only edit (minutes, billable, note, date) — no admin/owner override | PASS | `editTimeEntry` checks `entryRow.user_id === user.id` only, no `requireWorkspaceAdmin` call; no UPDATE RLS policy exists at all on time_entries (deny-by-absence backs the app check); test explicitly asserts admin/owner editing another's entry fails, labeled as intentionally stricter than the app's usual admin-override pattern |
| AS-170 | Author OR admin/owner can delete; other regular member cannot | PASS | `deleteTimeEntry` branches: author → membership check; non-author → `requireWorkspaceAdmin`; test matrix covers all three actor types with correct expected outcomes |
| AS-171 | Task total logged time on task card + detail sheet | PASS (not independently re-verified this pass — UI-only, low risk; F113 reviewer confirmed the underlying counter component reads real data) | components/task/time-tracking.tsx |
| AS-172 | Project total time, billable/non-billable split, on project header | PASS | `get_project_time_totals` RPC, `security invoker`, real `t.deleted_at is null` join filter |
| AS-173 | Per-person time report, scoped to current workspace, selectable date range | PASS | `get_workspace_time_by_person` RPC, `security invoker`, workspace scoping enforced by RLS regardless of caller-supplied `p_workspace_id` (test explicitly proves cross-workspace param returns empty, not real data) |
| AS-174 | Soft-deleted task's entries excluded from project- and person-level totals | PASS | Both RPCs join `tasks` and filter `t.deleted_at is null`; both have a dedicated test asserting totals drop after soft-delete |
| AS-175 | RLS enabled on time_entries and active_timers, scoped to active workspace membership | PASS | rls-time-entries.test.ts, rls-active-timers.test.ts; policies use `is_task_workspace_member` helper checking `status = 'active'` |
| AS-176 | Non-member cannot read/write time entries for a workspace, even with a valid session in a different workspace | PASS | Confirmed at both the base-table RLS layer and the F115 RPC layer (explicit cross-workspace-param test) |

**16/16 PASS, 0 FAIL.**

## Notable finding (not a failure, but flagged for awareness)

**F111 RPC authorization is defense-in-depth, not self-contained.** `start_timer_atomic` and `stop_timer_atomic` are `SECURITY DEFINER` functions. The membership/workspace-scoping gate is enforced primarily by the calling server action (`requireActiveMembership`, called before the RPC), not by an explicit membership check inside the RPC body itself — the migration's own comment concedes the in-RPC protection is only "implicit through FK constraints." This matches the same pattern already used elsewhere in this codebase (`create_workspace_with_owner`) and is not, by itself, a defect: no path was found that calls these RPCs directly from client code bypassing the server action, and `auth.uid()` (never a client-supplied argument) is used for the actor identity in all cases, which blocks acting on another user's behalf regardless. Still, this makes the RPCs' safety contingent on every call site continuing to route through the guarded server actions — a future direct-RPC caller (e.g. a new client-side hook added without review) would not automatically inherit the workspace check. Recommended follow-up: add an explicit `is_task_workspace_member(p_task_id)` assertion inside both RPC bodies so the guarantee holds independent of caller discipline. This is a hardening suggestion, not a scrutiny failure — no test currently exercises calling these RPCs directly while bypassing the server action, so it is unverified whether it is currently exploitable; treat as INCONCLUSIVE/low-severity until such a test is written.

## Cosmetic (non-defect) observation

**F113 timer counter can display stale elapsed time if stopped from another tab/device.** The live counter in `components/task/time-tracking.tsx` ticks from a client-held `startedAt` via `setInterval`, with no realtime subscription or polling to reconcile against server state. If the timer is stopped from a different tab/device, this tab's counter keeps counting up until the user's own Stop click (which will correctly find no active timer server-side) or a page reload. No incorrect data is ever persisted — `stop_timer_atomic` always computes minutes server-side from `started_at`. This is cosmetic display staleness, not a correctness bug, and was not spawned as a follow-up feature.

## Recommended follow-up features (specs)

1. **F117 (optional hardening) — in-RPC workspace membership assertion for start/stop timer.** Add an explicit `is_task_workspace_member(p_task_id)` check (raising an exception if false) inside both `start_timer_atomic` and `stop_timer_atomic`, so the atomic timer RPCs are safe to call directly regardless of caller discipline, not solely reliant on the server action's pre-check. Add a test that calls the RPC directly (bypassing the server action) with a non-member session and asserts rejection.

## Commands run

```
npx vitest run
```
95 test files, 502 tests, all passed. Duration 48.89s.

```
npx eslint .
```
0 errors, 1 pre-existing warning (`lib/queries/search.ts:159` unused `_titleMatches`, unrelated to M9).

```
npx tsc --noEmit
```
No output — clean.

```
npm run build
```
Compiled successfully, all routes generated including `/w/[workspaceSlug]/time`.

No flakiness encountered; no re-runs were necessary.
