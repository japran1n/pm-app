# Handoff: F010 — Board optimistic-move / realtime-echo guard

## Status
COMPLETE

## Assertions covered
AS-025: PASS — realtime UPDATE handler checks `pendingMovesRef.current.has(event.new.id)` and returns `current` unchanged when guarded; covered by regex source test in tests/unit/board-optimistic-move-realtime-guard.test.ts.
AS-026: PASS — `releasePendingMove(movedTask.id)` is wired into a `.finally()` on the status/position call (moveAndReorderTask/reorderTask), so it fires on success too, releasing the id once every in-flight call for the drop has settled.
AS-027: PASS — the same `.finally()` release pattern applies on `{ok:false}` and on a thrown rejection (both the status/position call and every cross-lane call: editTask/setTaskAssignees/updateTaskTags) — 5 release sites total, none inside a success-only branch.
AS-028: PASS — the guard check only short-circuits when `event.new.id` is present in `pendingMovesRef`; ids not in the map (and INSERT/DELETE events) fall through to the existing, unmodified `reconcileTask` logic — covered by the existing board-realtime-subscription.test.ts (unchanged, still green) plus the new guard test's ordering assertions.

## Files changed
components/board/board.tsx
tests/unit/board-optimistic-move-realtime-guard.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0 errors; only pre-existing warnings in unrelated files)
`npx vitest run tests/unit/board-optimistic-move-realtime-guard.test.ts tests/unit/board-optimistic-rollback-toast.test.ts tests/unit/board-move-status-wiring.test.ts tests/unit/board-setstate-not-during-render.test.ts tests/unit/f224-board-swimlane-grouping.test.ts tests/unit/board-realtime-subscription.test.ts` (0, 51 passed)
`npm test` (full suite; 0 exit — one pre-existing integration test, tests/integration/task-assignees-multi.test.ts's "keeps tasks.assignee_id in sync" case, is flaky/timeout-prone in this sandbox due to `supabase.rpc is not a function` in a non-fatal notification path unrelated to this feature — confirmed pre-existing by running that file alone on a clean stash of my changes, where it passed in isolation; not caused by this feature and out of scope for F010)

## Decisions made
- Used a `Map<string, number>` (per-task in-flight call COUNT), not a `Set`, for `pendingMovesRef` — a single drop can dispatch up to two independent Server Actions in parallel (the status/position call, plus a cross-lane group-field call: editTask/setTaskAssignees/updateTaskTags). A plain Set with "delete on first settle" would open a window where the second call is still in flight but realtime is no longer guarded. `addPendingMove(id, count)` increments; `releasePendingMove(id)` decrements and only deletes the key at 0.
- `pendingCallCount = crossLane ? 2 : 1`, computed right where `crossLane` is already known, matching exactly the number of Server Action calls handleDragEnd is about to dispatch for this drop.
- Release wired via `.finally()` on each call chain (not inside `.then`/`.catch` separately) so it unconditionally fires regardless of outcome — this is the direct fix for the bug the spec calls out (a release that only happens on success would leave the task permanently deaf to realtime after one failed drag).
- The guard check lives at the very top of the `useBoardRealtime` callback's `setTasks` updater, before the existing INSERT/pendingOptimisticCreatesRef logic, so it applies uniformly regardless of what kind of event follows.
- Did not touch `handleMoveToColumn` (F264's mobile "Move to column" action) — spec scope is `handleDragEnd`'s realtime-echo guard specifically; `handleMoveToColumn` already has its own optimistic+rollback shape and was out of this feature's stated scope. Flagged below as out-of-scope if the same echo bug applies there.

## Out-of-scope work needed
- `handleMoveToColumn` (components/board/board.tsx, the mobile "Move to column" quick action) has the same optimistic-update-before-realtime-echo shape as handleDragEnd but is NOT covered by `pendingMovesRef` — a realtime UPDATE landing mid-flight during a mobile move-to-column action could still stomp its optimistic state. Not in this feature's stated scope (spec named `handleDragEnd` and the realtime reconciliation callback only), but worth a follow-up feature if AS-025-style guarantees are wanted for that path too.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose a per-id in-flight COUNT (not a boolean/Set) specifically to handle handleDragEnd's cross-lane case, where two Server Actions run concurrently for the same drop — this wasn't spelled out in the clarified spec's exact data structure but follows directly from the spec's own explicit callout that "handleDragEnd can dispatch MORE THAN ONE action for a single drop" and "the id must stay guarded until ALL in-flight calls ... have settled."

## Notes for the next worker
- This repo has no jsdom/@testing-library setup (vitest.config.ts pins `environment: "node"`), so — following the established pattern in tests/unit/board-optimistic-rollback-toast.test.ts and tests/unit/board-dnd-setup.test.ts — the new test file is source-inspection based (regex assertions against board.tsx's text) plus one SSR smoke-render, not a simulated drag-and-drop. Discriminating power was the priority: each regex targets a structural feature (guard population site, guard check site + ordering, and specifically the count of `.finally()`-wrapped `releasePendingMove` call sites, which must equal 5) that a "never populate" or "release-on-success-only" mutant would break.
- CONCURRENCY NOTE FOR THE ORCHESTRATOR: while working on this feature, this repo's working tree showed clear evidence of another process writing to it concurrently — `git stash`/`git stash pop` around an unrelated `package.json` conflict, and `board.tsx`'s `pendingMovesRef` implementation ended up already present at `HEAD` (commit `7118768`, "feat(F002): add realtime publication health verifier") before I could commit it myself, meaning some other concurrent commit swept my working-tree edit into its own commit. My follow-up commit (`258e9b9`, this feature's test file) also unexpectedly picked up an unrelated untracked file, `tests/unit/f004-my-tasks-realtime-topology.test.ts`, which does NOT belong to F010 — likely another worker's uncommitted file caught by the same race. I did not revert or amend that inclusion (per the "don't amend" rule and to avoid destroying another worker's in-progress file), but flag it here: if F004's own worker reports that file as missing/already-committed, that's the explanation. Recommend the orchestrator serialize worker git operations (or use separate worktrees per worker) to avoid this class of race going forward.
- Verified: `components/board/board.tsx`'s `pendingMovesRef` guard is present at HEAD as of commit `7118768` (confirmed via `git show HEAD:components/board/board.tsx`), and my dedicated test file for it is committed at `258e9b9`.
