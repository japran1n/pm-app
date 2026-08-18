# Handoff: F101 — position bound fix

## Status
COMPLETE

## Assertions covered
AS-072: PASS — new regression test matrix asserts `prev <= result <= next` for normal midpoint, precision-collapse repro (prev=1000/next=1001, repeated reinsertion), small/large-magnitude gaps, negative numbers, and zero-straddling gaps. All pass.
AS-082: PASS — same test matrix covers the "rapid repeated drags don't corrupt position" contract; existing AS-082 tests (finiteness/no-dup) still pass, and the new bound test on prev=1000/next=1001 repeated reinsertion (the scrutiny report's exact repro) directly disproves the prior overshoot bug.

## Files changed
lib/board/position.ts
tests/unit/position.test.ts

## Commands run
`npx vitest run tests/unit/position.test.ts` (0)
`npx tsc --noEmit` (0)
`npx eslint lib/board/position.ts tests/unit/position.test.ts` (0)
`npm test` (0 — one unrelated pre-existing failure: tests/integration/edit-task.test.ts fails with "JWT issued at future", a Supabase test-env clock-skew issue unrelated to position.ts; not touched by this feature)
`npm run build` (0)

## Decisions made
- Rewrote the fallback nudge to scale off the actual remaining gap (`next - prev`) rather than off `prev`'s absolute magnitude, per the spec's primary suggested fix. This alone fixes the traced overshoot (prev=1000, next=1001 case).
- Kept a secondary fallback (the old prev-magnitude-scaled step) as a second attempt when the gap-scaled nudge itself doesn't land strictly between prev/next (can happen when the gap is already at the smallest representable float64 step) — but validated against bounds before accepting it.
- Added a documented last-resort branch: when prev and next are float64-adjacent (no representable value strictly between them), return `prev` itself, matching the spec's explicit allowance that true insertion is impossible without rebalancing (out of scope for v1).
- Added `Math.min(Math.max(nudged, prev), next)` as an unconditional final clamp, per the spec's explicit instruction, so the [prev, next] bound is guaranteed structurally regardless of which computation path produced the value — not just by careful arithmetic in each branch.
- Did not touch the empty-column/top-of-column/bottom-of-column branches — Finding 1 only implicated the between-two-cards fallback path, and AS-073/AS-074 were already passing per the scrutiny report.

## Out-of-scope work needed
- Finding 2 (M5-scrutiny.md): optimistic rollback leaves inconsistent server state on cross-column partial failure (AS-077) — separate bug, separate file(s) (lib/actions/tasks.ts), not part of this feature's scope.
- Finding 3: Realtime event-ordering caveat (AS-076) — no defense against out-of-order delivery. Separate concern, not touched here.
- Periodic rebalance pass for fractional-index gap exhaustion remains explicitly out of scope for v1 per tech-decisions.md; this fix only guarantees boundedness, not restoration of healthy spacing after many collapses.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: When the gap-scaled nudge doesn't land strictly inside (prev, next), I return `prev` exactly rather than attempting a bit-level `nextafter`-style search for the adjacent float64 value greater than `prev`. The spec explicitly permits returning prev (or a value equal to a neighbor) in the documented float64-adjacent case, and the final clamp guarantees correctness either way; a full nextafter implementation was judged unnecessary complexity for a case the spec already says is "extremely rare" and acceptable to degrade on.

## Notes for the next worker
- The fix is purely arithmetic — no new dependencies, no schema/API changes.
- The new test file section is titled "calculatePosition — result is always within [prev, next] bound (AS-072, AS-082, regression for Finding 1)" in tests/unit/position.test.ts — search there for the full matrix if you need to extend it.
- If a future rebalance feature ships, this fallback path becomes largely moot for the "many repeated inserts" case, but the bound-safety clamp should stay regardless as defense in depth.
