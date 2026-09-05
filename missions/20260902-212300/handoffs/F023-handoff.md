# Handoff: F023 — Fix-up: hoist Realtime auth-hydration fix to portal subscribers, close AS-024 regression

## Status
COMPLETE

## Assertions covered
AS-021: PASS — `components/portal/task-list.test.tsx` (`test_AS_021_status_or_title_change_lands_live`, `test_AS_021_status_change_to_done_moves_row_and_updates_heading_live`) still pass unchanged in behaviour, now against the async-subscribe path. The systemic gap scrutiny-2 flagged (channel joins unauthenticated on a fresh page load) is closed by routing `task-list.tsx` through `subscribeWhenAuthenticated`.
AS-022: PASS — same file, `test_AS_022_delete_removes_the_row_live`, `test_AS_022_client_visible_false_removes_the_row_live`, `test_AS_022_update_for_a_different_project_is_ignored` pass; mutation-verified the effect actually calls the new helper (see Commands run).
AS-023: PASS — `components/portal/request-list.test.tsx` (`test_AS_023_insert_lands_live`, `test_AS_023_status_change_lands_live`) pass against the now-async-subscribing `request-list.tsx`; mutation-verified.
AS-024: PASS — teardown-on-unmount and no-leak-across-remount tests in both component test files still pass, PLUS new tests close the regression scrutiny-2 found in F012's own fix: `test_AS_024_unmount_before_session_resolves_never_subscribes` and `test_AS_024_rejected_getSession_does_not_throw_or_subscribe` in `task-list.test.tsx`, `request-list.test.tsx`, `tests/unit/portal-overview-live.test.tsx`, and dedicated unit coverage of the shared helper itself in `tests/unit/subscribe-when-authenticated.test.ts` (including a test that isolates the second `cancelled` guard, between `getSession()` resolving and `setAuth()` resolving, from the first).

## Files changed
lib/realtime/subscribe-when-authenticated.ts (new)
components/portal/use-portal-overview-realtime.ts
components/portal/task-list.tsx
components/portal/request-list.tsx
components/portal/task-list.test.tsx
components/portal/request-list.test.tsx
tests/unit/portal-overview-live.test.tsx
tests/unit/subscribe-when-authenticated.test.ts (new)

## Commands run
`npx vitest run tests/unit/subscribe-when-authenticated.test.ts tests/unit/portal-overview-live.test.tsx components/portal/task-list.test.tsx components/portal/request-list.test.tsx` (0, 29/29)
`npx vitest run --exclude "**/tests/integration/**"` (0, 209 files / 1627 tests passed)
`npx tsc --noEmit` (0)
`npm run lint` (0 errors, 15 pre-existing warnings, none in touched files)
Mutation testing (all mutants restored after; final `git status --porcelain` on touched files clean before commit):
- Delete second `if (cancelled) return` in `subscribe-when-authenticated.ts` (inside `afterAuth.then`) → **KILLED** by `test_AS_024_release_after_getSession_but_before_setAuth_resolves_prevents_subscribe`.
- Delete the `.catch(() => {})` block → **KILLED** (test run reports 2 unhandled rejections / errors, which fails the suite).
- Delete the first `if (cancelled) return` (before computing `accessToken`) → SURVIVED — the second guard is a stricter checkpoint immediately before `subscribe()` is called, so this one is behaviourally redundant (an optimization to skip an unnecessary `setAuth()` call, not a correctness guard); left as-is since AS-024 only concerns whether `subscribe()`/a channel gets created after unmount, which the second guard alone already guarantees.
- Revert `task-list.tsx`'s effect to call `subscribeToPortalTaskListRealtime` directly (bypassing `subscribeWhenAuthenticated`) → **KILLED** (2 of 9 tests fail: the two new AS-024 unmount/reject tests).
- Revert `request-list.tsx`'s effect the same way → **KILLED** (2 of 5 tests fail, same shape).

## Decisions made
- Extracted F012's inline getSession→setAuth→subscribe sequence into `lib/realtime/subscribe-when-authenticated.ts`, a small generic helper (`(supabase, subscribe: (supabase) => unsubscribe) => release`), per the mission's explicit preference for a single shared helper over three copies of the same fix. `use-portal-overview-realtime.ts`, `task-list.tsx`, and `request-list.tsx` all now call it identically.
- Kept the helper's public contract intentionally minimal (one function, one callback) so it composes with each subscriber's own `subscribeToPortal*Realtime` function unchanged — no changes needed to `subscribeToPortalTaskListRealtime`, `subscribeToPortalRequestListRealtime`, or `subscribeToPortalOverviewRealtime` themselves, only to the three `useEffect`s that call them.
- Swallowed a rejected `getSession()`/`setAuth()` silently (no `console.error`) rather than logging, to match the rest of `lib/realtime/` which has no console usage and to avoid reintroducing anything resembling the `F012_DEBUG` console-log AS-032 required removing in a prior round; the failure is still fully covered by tests (no unhandled rejection, no subscribe call).
- For the second `cancelled` guard mutation test, deliberately built a scenario where `getSession()` has already resolved but `setAuth()` is still pending, to isolate that guard from the first one (which alone would make the "unmount before getSession resolves" case pass even with the second guard deleted, since cancellation happens before the first check runs in that case).
- Updated `tests/unit/portal-overview-live.test.tsx`'s mocked `getSession` from a fixed inline `vi.fn()` to a reassignable module-level `getSessionMock` variable (reset in `afterEach`) so the same file could add the two new AS-024 regression tests without a second `vi.mock` block.

## Out-of-scope work needed
- **`components/board/use-board-realtime.ts`** (`useEffect` at line 57, `createClient()` at line 60) still subscribes synchronously on mount with no auth await — same race, out of this mission's contract per the assignment ("do NOT fix"; owned by another concurrently-running worker this session per `git status` showing `components/board/*` under active modification).
- **`components/my-tasks/use-my-tasks-realtime.ts`** (`useEffect` at lines 263 and 270, two channels — `assigneesTopic` at line 145/157 and `tasksTopic` at line 191/203) — same race, two separate subscriptions in one hook.
- **`components/calendar/use-calendar-realtime.ts`** (`useEffect` at line 47, `createClient()` at line 50) — same race.
  All three are drop-in candidates for `subscribeWhenAuthenticated(supabase, (client) => subscribe...(client, ...))`, same pattern as the three files this feature touched. Recommend a follow-up feature (mirroring scrutiny-2's own FU-L) scoped to exactly these three files plus their existing test suites (which will need the same `auth.getSession`/`realtime.setAuth` mock additions and `flushAuthHydration`-style await this feature added to `task-list.test.tsx`/`request-list.test.tsx`).
- Did not touch `components/portal/approval-actions.tsx`, `lib/actions/portal-approval.ts`, or `components/board/` per the explicit prohibition — these were visibly under concurrent modification by other workers during this session (see Notes below).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to swallow (not log) a rejected `getSession()`/`setAuth()` in the shared helper's `.catch`, since the spec only required "must not surface as an unhandled rejection," not any particular logging behaviour, and no other file in `lib/realtime/` logs.
AUTONOMOUS_DECISION: Left the first (outer) `cancelled` guard in place even though its own deletion mutant survives all tests, because it is still correct defensive code (skips an unnecessary `setAuth()` network call after an unmount) and removing it would be an unrelated behavioural change outside this feature's scope — documented the survival honestly above rather than deleting the "redundant" guard to force a kill.

## Notes for the next worker
No MCP tools used — this feature is pure client-side React/TypeScript, no schema or live-service changes.

**Mid-session working-tree reset**: partway through this feature, all of my edits to tracked files (everything except the brand-new `lib/realtime/subscribe-when-authenticated.ts`, which was untracked) were silently wiped back to `HEAD` — `git diff --stat` showed zero changes for files I had just edited and verified moments earlier, while `git log` still showed the same HEAD (`bfccd23`). This repo is shared by many concurrently-running mission workers (confirmed via `git status` showing other workers' in-flight edits to `components/board/`, `components/portal/approval-actions.tsx`, and `lib/actions/portal-approval.ts` throughout this session, consistent with F012's handoff notes about the same phenomenon). I re-applied every edit from scratch, re-ran the full mutation-verification pass a second time, and committed immediately once tests were green to minimize the window for it to happen again. Future workers touching files that another concurrent worker might also be mid-edit on should consider committing (or at least `git add`-ing) incrementally rather than batching all edits before a single final verification pass.
