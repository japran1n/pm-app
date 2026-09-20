# Handoff: F032 — stacked shell

## Status
COMPLETE

## Assertions covered
AS-024: PASS — test "renders a labelled row for every selected person, including one with no blocks" + explicit mutation-guard test both confirm a person with no blocks still gets a row.
AS-062: PASS — test confirms each row's DOM contains the member's visible name (falls back to email, then id, if name is missing).
AS-063: PASS — test confirms rows render in `selectedUserIds` order using a non-alphabetical fixture (Zoe, Alice, Mo), not sorted.

## Files changed
components/calendar/stacked-planner.tsx
components/calendar/stacked-person-row.tsx
app/(workspace)/w/[workspaceSlug]/calendar/page.tsx
tests/unit/f032-stacked-shell.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint components/calendar/stacked-planner.tsx components/calendar/stacked-person-row.tsx tests/unit/f032-stacked-shell.test.tsx "app/(workspace)/w/[workspaceSlug]/calendar/page.tsx" --max-warnings=0` (0)
`npx vitest run tests/unit/f032-stacked-shell.test.tsx` (0, 3 passed)
`npx vitest run tests/unit` (41 files failed / 133 tests failed pre-existing, unrelated — see Notes)

## Decisions made
- `StackedPlanner` takes a new `members: SwitcherMember[]` prop; `page.tsx` passes the already-computed `switcherMembers` from `buildSwitcherMembers` (F087) — reusing the SAME list the people switcher uses, so row labels and the switcher can never desync.
- Row label falls back `name ?? email ?? userId` so a row is never left unlabelled even with an incomplete member record — not specified explicitly in the clarified spec, applied as the safest default (see Autonomous decisions).
- Row order is driven directly by `selectedUserIds.map(...)` with zero sorting — the only way to satisfy AS-063 unambiguously.
- Missing blocksByUser entries default to `[]` via `blocksByUser.get(userId) ?? []`, which is what makes AS-024 hold: a person with zero blocks still renders.

## Out-of-scope work needed
None — F033 (time-grid body) and F034 (time-off strip) were implemented concurrently by other workers in this same run and landed on top of this shell (see Notes below); no gaps left for a future feature in this immediate area.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used `name ?? email ?? userId` as the row label fallback chain since the clarified spec only specifies the happy path ("visible name label"); this keeps every row labelled even for an edge-case incomplete member record, without introducing a new "Unknown" placeholder string not requested by the spec.

## Notes for the next worker
- This feature ran concurrently with F033 (Mon-Fri 08:00-16:00 grid body, AS-018..AS-022) and F034 (time-off strip, AS-066) workers, who both edited the same two files (`stacked-planner.tsx`, `stacked-person-row.tsx`) after I created them. Their commits (`94c70aa5` F033, `e7f2dab5` F034) already contain my shell's row-order/label/empty-row logic plus their own additions (the grid body and time-off strip), so `git log` for those two files shows F033/F034 as the owning commits even though the row-order/label/empty-row behaviour this feature is responsible for is preserved and tested by `tests/unit/f032-stacked-shell.test.tsx`, added in this feature's own commit.
- `StackedPersonRow`'s final prop shape ended up as `{ userId, userLabel, blocks, weekKey }` (a plain string label, not a `member` object) — decided by convergence with the F033 worker's concurrent edits; it still satisfies the "visible name label" clarified answer (option B: a `<div>` with a visible name, not a `<section aria-label>`).
- The full `tests/unit` run has 41 pre-existing failing files unrelated to this feature (e.g. a different mission's `f032-visual-distinction.test.tsx` / `f033-hover-highlighting.test.tsx` / `f034-component-panel.test.tsx` files with colliding F-numbers from a different feature area, plus `list-due-date-cell-optimistic.test.tsx`) — none touch calendar/stacked code; verified by grepping the failing test names for "stacked"/"calendar" and finding none.
- No MCP usage — this is a pure UI/presentational feature with no live external service state to inspect.
