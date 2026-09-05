# Handoff: F004 — M1 wiring regression tests

## Status
COMPLETE

## Assertions covered
AS-007: PASS — new test "AS-007: acquires exactly two distinct topics, and each topic's channel object receives exactly ONE postgres_changes binding" in `tests/unit/f004-my-tasks-realtime-topology.test.ts` asserts `channelObjectsByTopic.size === 2` and, per channel object, `obj.on` was called exactly once (plus a total-binding-count guard of 2). This is stricter than topic-string comparison alone: it dedupes channel objects by topic (mirroring real `@supabase/realtime-js` behaviour) so a mutant that reuses one channel object for both tables — even under two different topic strings by accident — is caught by the per-object `.on()` call count, not just by string inequality.
AS-010: PASS — new test "AS-010: the single returned unsubscribe releases BOTH channel objects, and nothing is left subscribed" asserts every channel object acquired by the one `subscribeToMyTasksRealtime` call appears in `removedChannelObjects`, that exactly 2 distinct objects were released, and that no acquired object is missing from the released set. A third test asserts idempotent teardown (second `unsubscribe()` call does not throw or double-release).
AS-031: PASS — `npx tsc --noEmit` exits 0, no errors.
AS-032: PASS — `npm run lint` exits with 0 errors, 15 pre-existing warnings all in files this feature never touched.
AS-033: PASS — full My Tasks-related suite run (see Commands run) — 60/60 tests passed, all via the existing mock-Supabase-client pattern, no live connection.
AS-034: PASS — same run; no new dependency installed, no network/live Supabase calls in the new test file.

## Files changed
tests/unit/f004-my-tasks-realtime-topology.test.ts

## Commands run
`npx vitest run tests/unit/f004-my-tasks-realtime-topology.test.ts tests/unit/f008-my-tasks-realtime.test.ts tests/unit/f006-my-tasks-checkbox-optimistic.test.tsx tests/unit/my-tasks-bucket.test.ts tests/unit/reconcile-my-tasks-realtime-task.test.ts tests/integration/f231-my-tasks-scope-actions.test.ts tests/integration/f230-my-tasks-query.test.ts` (0, 60/60 passed — confirms no pre-existing My Tasks test regressed from F003)
`npx tsc --noEmit` (0)
`npm run lint` (0 errors, 15 pre-existing warnings, none in touched files)
`git add` / commit — see note below under Decisions made (file ended up committed via a concurrent worker's commit in this shared working tree; content and location are exactly as intended)

## Decisions made
- Added a NEW, independent test file (`tests/unit/f004-my-tasks-realtime-topology.test.ts`) rather than extending `tests/unit/f008-my-tasks-realtime.test.ts`, which F003 already crowded with its own AS-007/AS-010 tests. Per spec's "(or a sibling file if that one is already crowded)" instruction.
- Built a mock that keys channel objects by topic AND counts `.on()` calls per object (not just per topic string), specifically to catch the mutant class named in the spec: "a mutant that puts both bindings back on one channel must fail this test." Asserting only `topic !== topic` (as F003's own AS-007 test does) would not catch a mutant that reuses the same channel object under two different topic-string arguments if the mock naively created a new object per call; my mock dedupes by topic exactly like the real `RealtimeClient`, and asserts binding COUNT per object, satisfying the spec's explicit instruction to "assert on the count of bindings per topic, not just on the topic names."
- For AS-010, asserted both that all acquired channel objects appear in the removed set (both release paths fire) AND that no acquired object is absent from it (nothing left subscribed), plus an idempotency check on double-unsubscribe, since the spec says "assert both release paths fire, and that nothing is left subscribed."
- Did not modify `tests/unit/f008-my-tasks-realtime.test.ts` — its own AS-007/AS-010 tests (written by F003) still pass and are complementary, not redundant, with the new stricter ones.

## Out-of-scope work needed
Audit performed per spec instruction (grep for other `.channel(` call sites registering more than one `postgres_changes` binding on a single channel — the same latent failure mode F003 just fixed for My Tasks). Found three other production files with this exact pattern (two `postgres_changes` `.on()` registrations on ONE shared channel object, no split like F003's fix). NOT fixed here, per spec ("Do NOT fix any you find"):

1. `lib/tasks/subscribe-comments-realtime.ts` — `.channel(`comment_reactions:${taskId}`)` at line 197 has TWO `.on("postgres_changes", ...)` bindings registered on it (lines 198 and 208, for `comment_reactions` INSERT and DELETE respectively). A separate channel `comments:${taskId}` (line 233) has its own single binding (line 234) and is not affected.
2. `lib/chat/subscribe-messages-realtime.ts` — `.channel(topic)` at line 78 has TWO `.on("postgres_changes", ...)` bindings on it (lines 79 and 93).
3. `lib/chat/subscribe-message-reactions-realtime.ts` — `.channel(topic)` at line 56 has TWO `.on("postgres_changes", ...)` bindings on it (lines 57 and 67).

If any one binding on these shared channels silently stops delivering (the exact failure mode described in F003's spec — e.g. a table drops out of the Realtime publication, or an RLS policy change breaks one table's visibility while the channel still reports SUBSCRIBED), the OTHER binding on the same channel is also at risk of going undetected/untested as independently failable, since these three files' own test suites (if any) likely encode the same single-channel assumption the My Tasks test file had before F003. Recommend a follow-up feature per file (or one feature covering all three) to: (a) verify with a regression test whether each pair of bindings actually needs channel-splitting (i.e. whether one binding dying independently is a real, non-theoretical risk for that specific pair of event types/tables), and (b) apply the same `acquireSharedTopicChannel`-per-topic split F003 used for My Tasks if warranted. This is new work, not a defect in this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Interpreted "Files: components/my-tasks/*.test.ts(x)" in the spec loosely enough to include `tests/unit/f004-my-tasks-realtime-topology.test.ts` (the repo's established convention, followed by every other My Tasks realtime test including F003's own, is to place these tests under `tests/unit/`, not colocated under `components/my-tasks/`) rather than literally under `components/my-tasks/`. This matches the actual location of every sibling test file this feature is meant to regression-guard (`tests/unit/f008-my-tasks-realtime.test.ts` etc.) and the spec's own worked example filename (`tests/unit/f008-my-tasks-realtime.test.ts`).

## Notes for the next worker
- This is a heavily shared, concurrently-modified working tree (multiple missions/workers active simultaneously). My newly-created test file ended up swept into a concurrent worker's commit (`258e9b9`, "test(F010): add discriminating coverage for board optimistic-move / realtime-echo guard") alongside its own unrelated file, because `git add` was run by that other worker's process while my file was staged in the same shared index between my `git add` and their `git commit`. I verified via `git show 258e9b9 --stat` that `tests/unit/f004-my-tasks-realtime-topology.test.ts` is present in that commit with the exact content I wrote (158 lines added, matches). The working tree is clean and the file is correctly committed to `main` — just not under an F004-specific commit message. No further action needed unless the orchestrator wants a cosmetic history fix (not recommended — rewriting shared history in a concurrently-active repo is riskier than leaving it).
- All five Definition-of-Done items are satisfied: (1) every named assertion has a test that fails if the behaviour is removed, (2) `tsc --noEmit` exits 0, (3) `lint` introduces no new errors, (4) the suite passes with no live Supabase connection, (5) no new dependency was installed.
- No production code was touched, per this feature's TEST-ONLY constraint.
