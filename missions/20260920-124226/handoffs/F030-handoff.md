# Handoff: F030 — switcher placement a11y

## Status
BLOCKED

## Assertions covered
AS-051: UNTESTED — Cannot verify header placement; the people switcher component does not exist in the codebase yet.
AS-060: UNTESTED — Cannot verify keyboard operability; there is no switcher to open, search, or toggle.
AS-061: UNTESTED — Cannot verify mobile reachability; there is no switcher rendered anywhere.

## Files changed
(none)

## Commands run
`grep -rl "PeopleSwitcher\|people-switcher\|peopleSwitcher" components lib app` (0 matches)
`find . -iname "*people-switcher*"` (no file found)
`grep -n "people\|switcher\|Switcher" components/calendar/week-view.tsx` (no matches)
`ls missions/20260920-124226/handoffs/` — confirmed no F026, F027, F028, or F029 handoff files exist

## Decisions made
- Investigated before writing any code to confirm this is a real blocker rather than an ambiguity to resolve with a default: `components/calendar/people-switcher.tsx` (the file this feature's spec says it "touches") does not exist, `week-view.tsx` has zero references to a people switcher, and none of F026 (switcher shell), F027 (multiselect), F028 (shortcuts), or F029 (url wiring) have handoff files — meaning none of those dependency features were ever implemented, despite F055's handoff (a later, unrelated feature) referencing `lib/queries/members.ts`/`getWorkspaceMembers` as already existing.
- Did not attempt to build the switcher component myself: F026/F027/F028/F029 each carry their own assertion IDs (AS-052, AS-053, AS-011, AS-012, AS-013, AS-059) that are not assigned to F030. Implementing them here would be out-of-scope silent expansion and would risk conflicting with whatever worker eventually picks up those features.

## Out-of-scope work needed
The entire people switcher stack is missing and needs to be built before F030 can be attempted:
- F026 (people switcher shell): combobox listing active workspace members with avatar/name, narrows on typing (cmdk primitive, no new package).
- F027 (switcher multiselect): multi-select toggle behavior.
- F028 (switcher shortcuts): keyboard shortcuts for the switcher.
- F029 (switcher url wiring): `?people=` query param wiring, preserving `?week=`, no localStorage/sessionStorage writes, fallback to signed-in member when nobody is selected.

## Blockers
BLOCKER: F030's direct dependency, F029 (switcher url wiring), was never implemented — and neither were F026, F027, or F028 that F029 itself depends on. `components/calendar/people-switcher.tsx` does not exist anywhere in the repo, and `week-view.tsx` has no reference to a people switcher. There is no header row control, no keyboard-operable combobox, and nothing to test at mobile width for AS-051/AS-060/AS-061.
TRIED: Searched the full repo (components, lib, app) for any switcher-related file or reference under alternate names (PeopleSwitcher, people-switcher, peopleSwitcher, attendee, member-filter); checked `missions/20260920-124226/handoffs/` for F026-F029 handoffs (none exist); read `week-view.tsx` directly for any partial integration (none found).
NEEDED: The orchestrator should run F026, F027, F028, and F029 (in that dependency order) to completion first. Once `components/calendar/people-switcher.tsx` exists and is wired into `week-view.tsx` with URL state, F030 can be re-run to add header placement and mobile/keyboard a11y polish on top of the real component.
SUGGESTED FOLLOWUP: Re-queue F026-people-switcher-shell, F027-switcher-multiselect, F028-switcher-shortcuts, and F029-switcher-url-wiring for execution in that order (F030 already exists and depends on F029, so no new feature file is needed — just ensure the missing dependency chain runs before F030 is retried). Each of those specs already has clarified content and file paths; no new clarification round is required.

## Autonomous decisions
AUTONOMOUS_DECISION: Chose not to implement the missing F026-F029 scope myself and instead report BLOCKED, per CLAUDE.md rule 3 ("Implement only what your feature spec covers... do not silently expand the work") and the explicit "Depends on: F029" declaration in this feature's own spec header.

## Notes for the next worker
No MCP usage was needed for this investigation (pure filesystem/codebase check, no external service state). Before re-attempting F030, confirm `components/calendar/people-switcher.tsx` exists and is rendered inside the Planner header row (alongside previous/today/next-week controls per the CLAUDE.md page-header spacing rule) before writing a11y/placement tests — otherwise the AS-051/AS-060/AS-061 tests will have nothing real to exercise.
