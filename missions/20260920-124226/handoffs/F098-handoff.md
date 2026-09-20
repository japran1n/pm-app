# Handoff: F098 — Fix AS-002 — add 24-hour week grid coverage

## Status
COMPLETE

## Assertions covered
AS-002: PASS — added `tests/unit/f098-week-grid-24h.test.tsx`, which renders the real `WeekTimeGrid` component and asserts exactly 24 unique "HH:00" hour-axis labels (00:00 through 23:00) are present. Verified by hand-mutating `HOURS = Array.from({ length: 24 }, ...)` to `{ length: 9 }` in `components/calendar/week-time-grid.tsx` — the test fails as required (then reverted the mutation).

## Files changed
tests/unit/f098-week-grid-24h.test.tsx

## Commands run
`npx vitest run tests/unit/f098-week-grid-24h.test.tsx` (0)
`npx vitest run tests/unit/f098-week-grid-24h.test.tsx` after mutating length:24 -> length:9 (1, expected failure, confirms falsifiability, then reverted file)
`npx eslint tests/unit/f098-week-grid-24h.test.tsx --max-warnings=0` (0)
`npx tsc --noEmit` (1 — pre-existing, unrelated failure in `tests/integration/calendar-blocks-crud.test.ts:397` calling a 3-arg overload where 4 are now expected; this file/function was not touched by F098 and the error exists on the pre-F098 tree as well, see Decisions made)

## Decisions made
- Rendered the component directly with real props (`days`, `blocksByDate`, `workspaceSlug`, `workspaceId`, `currentUserId`) rather than the source-regex approach sketched as "Step 1" in the spec, per the spec's own "Better approach" guidance — a render-and-count test is the one that actually breaks when `length: 24` is mutated to any other number, whereas a regex on `/length\s*:\s*\d+/` would still find "24" as a false hour-count in unrelated code and is fragile to formatting changes.
- Asserted on the rendered "HH:00" text content (unique per hour, 24 total) rather than a `role="rowheader"` query, since the actual DOM has plain `<div>` labels with no ARIA row semantics — matches the component's real markup instead of an assumed one.
- Did not touch `lib/queries/calendar-blocks.ts` or `tests/integration/calendar-blocks-crud.test.ts`, which were already modified/broken on the working tree before I started (pre-existing `tsc` failure, unrelated to AS-002/F098's assigned scope of `week-time-grid.tsx`'s hour axis). Left them untouched per spec's file-scope boundary (only week-time-grid.tsx + a new test file).

## Out-of-scope work needed
The pre-existing `tsc --noEmit` failure at `tests/integration/calendar-blocks-crud.test.ts:397` (call expects 4 arguments, only 3 given) is unrelated to F098's scope and was present on the tree before this feature started (uncommitted local changes to `lib/queries/calendar-blocks.ts`). A future feature/worker should investigate and fix that signature mismatch — it is not part of AS-002 and touching it here would exceed F098's file scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used the "render and count real DOM output" approach from the spec's own "Better approach" suggestion rather than the source-regex Step 2 example, since only the render-based test is guaranteed to fail on the `length: 24` -> `length: 9` mutation the spec requires.

## Notes for the next worker
The hour axis lives in the left gutter column of `WeekTimeGrid` (`components/calendar/week-time-grid.tsx` lines ~459-469), a separate `.map` from the per-day-column hour gridlines (lines ~504-510, which render unlabeled border divs, not text) — the new test targets the gutter's labeled hours specifically via `getAllByText(/^\d{2}:00$/)`, which only matches the gutter (the per-column gridlines have no text content), so the 24 count is unambiguous and not inflated by the per-day repeated gridlines.
