# Handoff: F037 — Header states whose planner is shown when not the viewer's own; confirm no per-person tint

## Status
COMPLETE

## Assertions covered
AS-070: PASS — PlannerHeader now derives a subtitle from `peopleSwitcher.selectedUserIds` vs `selfId`; no subtitle when selection is only [selfId], other person's name + "'s schedule" for a single other, comma-joined names (or a "Team planner (N people)" summary beyond 3) for multiple. Verified with 4 render-based tests.
AS-071: PASS — source-text guard confirms neither `stacked-planner.tsx` nor `stacked-person-row.tsx` reference a per-person colour palette (`personPalette`/`avatarColors`/`personColors[`).

## Files changed
components/calendar/planner-header.tsx
tests/unit/f037-planner-header-subtitle.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint . --max-warnings=0` (0)
`npx vitest run tests/unit/f037-planner-header-subtitle.test.tsx` (0, 5/5 passed)

## Decisions made
- No page.tsx changes were needed: `PlannerHeader`'s existing `peopleSwitcher` prop (members, selectedUserIds, selfId) already carries everything needed to compute the subtitle, so it's derived entirely inside `PlannerHeader` itself — keeps the change minimal and scoped to the one component named in the spec.
- Subtitle text: single other person → "`Name`'s schedule" (matches the spec's own example verbatim). Multiple others (≤3) → comma-joined names; more than 3 → "Team planner (N people)" count summary, per the spec's stated options ("show all names or 'Team planner' with member count").
- `PeopleSwitcherMember` uses `userId` (not `id`) as its identity field — matched the existing type rather than introducing a new shape.
- Reused the `next/navigation` `useRouter` mock pattern from the existing `f088-planner-header-lift.test.tsx` test since `PlannerHeader` renders `PeopleSwitcherUrlBound` (which calls `useRouter()`) whenever a `peopleSwitcher` prop is passed.

## Out-of-scope work needed
None identified.

## Blockers
(none — status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose "Name's schedule" phrasing for the single-other-person case and a comma-joined-names / "Team planner (N people)" fallback for multi-person, both explicitly offered as acceptable options in the spec's "What to build" section — no clarification needed.

## Notes for the next worker
No MCP usage — this is a pure UI/component feature with no live external state. The new `data-testid="calendar-planner-subtitle"` is the hook to use if a future feature needs to assert on the subtitle in an E2E/RSC-composition test.
