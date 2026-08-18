# Handoff: F044 — position calc util

## Status
COMPLETE

## Assertions covered
AS-071: PASS — pure fractional-index calc (float `position`), no integer re-sequencing; verified by full unit suite in tests/unit/position.test.ts
AS-072: PASS — "assigns a position strictly between its new neighbors" test asserts prev < result < next for midpoint case
AS-073: PASS — "top of column" tests assert result < current first card's position (including small-positive and negative edge values)
AS-074: PASS — "bottom of column" tests assert result > current last card's position (including negative edge value)
AS-082: PASS — "rapid repeated moves" describe block: no NaN/duplicates across distinct-card moves, stable output on repeated same-input recalculation, top/bottom moves never collide

## Files changed
lib/board/position.ts
tests/unit/position.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0)
`npx vitest run tests/unit/position.test.ts` (0, 16/16 passed)
`npm test` (0 — full suite: 220 passed, 9 skipped; 1 pre-existing unrelated failure in tests/integration/tasks-schema.test.ts due to "JWT issued at future", a Supabase test-JWT clock-skew issue in an existing integration test, not caused by or related to this feature)
`npm run build` (0)

## Decisions made
- Both-null (empty column) default: `1000`, chosen as a round, mid-range float that leaves headroom to insert both above and below via the same `BOUNDARY_GAP` without going negative for the common case.
- Boundary gap for top/bottom-of-column insert: `1000` (same magnitude as the default), so a first drag-to-top or drag-to-bottom lands a full gap away from its only neighbor, matching typical fractional-indexing gap sizing.
- Midpoint for between-two-cards case: plain `(prev + next) / 2`, per discovery/round-2.md Q6's explicit rationale ("new card gets midpoint between neighbors").
- Floating-point precision edge case (per tech-decisions.md's explicit note that a periodic rebalance is out of scope for v1): implemented a documented fallback, not a fix. If the computed midpoint is non-finite or collapses onto either neighbor (can happen after very many rapid inserts into the same shrinking gap), the function nudges off `prev` by `Number.EPSILON * max(|prev|, 1)`; if even that isn't finite/distinct, it returns `prev` itself. This guarantees the function never returns NaN/Infinity and always returns a deterministic, ordered-enough value — it does not attempt to restore even spacing, which is explicitly deferred to a future rebalance feature.
- AS-082 ("repeated rapid moves ... no duplicate or NaN") is a pure-function property test at this layer: calculatePosition is stateless and deterministic (same inputs -> same output), so the "no duplicates across cards" property is demonstrated by feeding it different neighbor pairs (as the real drag flow would, since each card's slot has distinct neighbors) and asserting the result set has no collisions, plus a stability test showing identical inputs never drift into NaN/duplication over repeated calls. Whole-app deduplication across concurrent drags (e.g. two users dragging into the same slot at once) is a persistence/DB-layer concern for whichever feature wires this util into the Server Action, not something a pure function can validate — flagged below in Out-of-scope work needed for visibility, not as an unmet assertion.

## Out-of-scope work needed
- Wiring `calculatePosition` into the actual drag-drop Server Action / dnd-kit `onDragEnd` handler (reading neighbor positions from the DB, writing the new position) is a separate feature per F044's Clarified scope ("no forward dependencies on later milestones") — not done here.
- Periodic rebalancing of `position` values to restore healthy spacing after long-running use is explicitly out of scope per tech-decisions.md; a future feature should add a maintenance pass (e.g. re-spacing all cards in a column to multiples of 1000 when the minimum gap drops below some epsilon threshold) if this becomes a real-world problem.
- Concurrent-drag collision handling (two simultaneous drags computing an overlapping position before either write lands) is a DB/RLS/Server Action concern for the wiring feature, not this pure utility.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Picked `1000` as both the empty-column default and the top/bottom boundary gap (rather than e.g. `0`) so that a freshly-created card can be dragged above or below it without immediately risking precision issues, and so all magic numbers in the file share one clearly-documented constant scheme (`DEFAULT_POSITION`, `BOUNDARY_GAP`).

## Notes for the next worker
- `calculatePosition` is pure and framework-agnostic — no Supabase/DB imports — so it can be unit-tested directly and reused both client-side (optimistic reorder during drag) and server-side (Server Action computing the value to persist), which is presumably why F043 (dnd-kit wiring) depends on this.
- The floating-point fallback path is intentionally conservative: it does not try to be clever about restoring order, it just guarantees termination without NaN/Infinity. If a later milestone adds a rebalance feature, this fallback branch becomes mostly dead code in practice (rebalancing would keep gaps healthy before the fallback ever triggers) but should stay as a safety net regardless.
- Test file simulates the "many rapid inserts into the same shrinking gap" scenario with 200 successive halvings starting from `[0, 1]` to actually exercise the floating-point-precision branch, not just assert it exists.
