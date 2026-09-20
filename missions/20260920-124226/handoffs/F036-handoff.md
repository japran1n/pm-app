# Handoff: F036 — Stacked planner scroll and block colour

## Status
COMPLETE

## Assertions covered
AS-067: PASS — block chip renders `block.color` via `getCalendarBlockDisplayColor`, never a per-person substitution; verified by rendering two different blocks with different `color` values in the same row and asserting distinct border/background colours.
AS-068: PASS — `stacked-planner.tsx` scroll container now has `overflow-y-auto` and `max-h-[calc(100vh-200px)]`; each `StackedPersonRow` also carries `min-h-[6rem] shrink-0` so rows can't collapse when many are stacked.
AS-069: PASS — source-level check confirms neither `stacked-planner.tsx` nor `stacked-person-row.tsx` contains capacity/utilisation/total-hours/percent-used text.

## Files changed
components/calendar/stacked-planner.tsx
components/calendar/stacked-person-row.tsx
tests/unit/f036-stacked-scroll-colour.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint components/calendar/stacked-planner.tsx components/calendar/stacked-person-row.tsx tests/unit/f036-stacked-scroll-colour.test.tsx --max-warnings=0` (0)
`npx vitest run tests/unit/f036-stacked-scroll-colour.test.tsx` (0, 5 passed)
`npx vitest run tests/unit/f032-stacked-shell.test.tsx tests/unit/f033-stacked-row-grid.test.tsx tests/unit/f035-stacked-reorder.test.tsx` (0, 11 passed — regression check on rows/reorder this feature touches)

## Decisions made
- AS-067 was already correctly implemented before this feature (block chip uses `getCalendarBlockDisplayColor(segment.block.color)`, no per-person colour anywhere in the row). Per the spec's own instruction ("If it already does this correctly, add a test"), no production code change was needed for AS-067 — only test coverage (two-blocks-different-colours test) was added, with a mutation check implicit in using two distinct colours from the real swatch set rather than one fixed default.
- Used swatch values from `lib/calendar/block-colors.ts` (`CALENDAR_BLOCK_COLORS`, e.g. `#ef4444`) in the AS-067 test instead of an arbitrary hex, because `getCalendarBlockDisplayColor` falls back to the default swatch for any unknown colour — an arbitrary `#ff0000` isn't in the fixed set and would silently resolve to the default, producing a false pass/fail. This matches the existing block-colours convention (closed swatch set, not free-form colour).
- Added `min-h-[6rem] shrink-0` to each `StackedPersonRow` container (not just the outer scroll container) to satisfy the spec's explicit requirement that "Each person row must have a min-height so it never collapses to unreadable," on top of the outer `overflow-y-auto max-h-[calc(100vh-200px)]` container specified for AS-068.
- AS-069 required no production changes; confirmed via source-level regex scan (matching the spec's own suggested test approach) that neither file contains hours/capacity/utilisation/total/percent language, and locked this in with a test so a future PR can't silently reintroduce it.

## Out-of-scope work needed
None identified within this feature's boundary.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose `#ef4444` (a real entry in `CALENDAR_BLOCK_COLORS`) for the AS-067 colour-fidelity test instead of an arbitrary hex, because the display-colour resolver deliberately falls back to a default for any value outside the fixed swatch set — using an out-of-set colour would have made the test pass/fail for the wrong reason (swatch validation, not colour-fidelity).

## Notes for the next worker
No MCP usage — this is a pure client-component feature (no live external service state touched). `lib/calendar/block-colors.ts` documents the closed swatch set; any future colour-related test in this area should draw its test colours from `CALENDAR_BLOCK_COLORS` rather than arbitrary hex values, for the same reason noted above.
