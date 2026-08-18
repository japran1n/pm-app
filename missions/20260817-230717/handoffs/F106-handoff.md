# Handoff: F106 — list view status priority colors

## Status
COMPLETE

## Assertions covered
AS-135: PASS — `components/task/task-list-table.tsx`'s priority Badge and `components/task/list-status-select.tsx`'s status Select now render colors from `lib/task-colors.ts`'s `PRIORITY_COLORS`/`STATUS_COLORS`, matching board columns, TaskCard badges, and dashboard charts. New test `tests/unit/list-table-status-priority-colors.test.ts` asserts every priority/status value's rendered color equals the shared constant.

## Files changed
components/task/task-list-table.tsx
components/task/list-status-select.tsx
tests/unit/list-table-status-priority-colors.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0 errors, 1 pre-existing unrelated warning in lib/queries/search.ts)
`npx vitest run` (0) — 78 test files, 412 tests passed
`npx next build` (0) — production build succeeds

## Decisions made
- Removed `task-list-table.tsx`'s locally-duplicated `PRIORITY_LABELS` map and imported `PRIORITY_COLORS`/`PRIORITY_LABELS` from `lib/task-colors.ts` instead (matches Finding 2's note about the duplicated-map drift risk on top of the missing color).
- Styled the priority Badge identically to `task-card.tsx`'s existing pattern: `variant="secondary"` plus an inline `borderColor` style and a small colored dot span, rather than inventing a new visual treatment.
- For `list-status-select.tsx`, added a colored dot (matching `board-column.tsx`'s header-dot convention) both in the `SelectTrigger`'s current-value display and in each `SelectItem`, since a shadcn `Select` (unlike `Badge`) has no border/background slot that reads naturally as "this row's status color" — a dot next to the label was the closest match to the existing dot-based status convention already used on the board.
- Replaced the local hardcoded `STATUS_OPTIONS` labels with `STATUS_LABELS` from `lib/task-colors.ts` so the option labels can't drift from the shared source either, even though only color was strictly in scope.
- Test renders both components via `renderToStaticMarkup` (same pattern as the existing `list-view-empty-state.test.ts`) and asserts the shared hex color string appears in the markup for every priority/status enum value, rather than trying to parse computed styles — consistent with how `dashboard-chart-colors.test.ts` already does string/prop-level assertions instead of a full style computation.

## Out-of-scope work needed
None beyond what's already tracked: F105 (archived-project exclusion, Finding 1) is a separate in-flight feature (unrelated file already modified in the working tree, not touched by this worker) and is not part of F106's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Also imported `STATUS_LABELS` (not just `STATUS_COLORS`) into `list-status-select.tsx`, replacing the local hardcoded option labels. The spec asked specifically for color, but leaving a second local labels map in place after removing `task-list-table.tsx`'s duplicate would have left exactly the same "second independently-duplicated map" drift risk Finding 2 called out, just relocated rather than fixed.

## Notes for the next worker
Milestone 7 (Dashboard: F071–F078, plus follow-ups F105–F106) is now fully complete from this worker's perspective — F106's fix (AS-135, Finding 2) is done, tested, and verified (tsc/eslint/vitest/build all clean). Milestone 7 is ready for a scrutiny re-check before Milestone 8 begins. Note two things the re-check should be aware of: (1) F105 (Finding 1, archived-project exclusion in `getWorkspaceListTasks`) has a feature file present with an uncommitted note about an additional parameter-tampering test but no corresponding code/test changes were found in the working tree at the time F106 was picked up — worth confirming F105 has actually landed before declaring M7 fully closed; (2) Finding 3 (AS-136 performance budget) still needs its "Deferred re-verification (M8)" note added to plan.md per the scrutiny report's recommendation — this is a plan.md documentation change, not a code feature, and wasn't in F106's scope. Milestone 8 (final security/quality/docs/polish) is the last milestone of the entire mission.
