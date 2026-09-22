# Handoff: F048 — inbox-first-in-primary-nav

## Status
COMPLETE

## Assertions covered
SB-053: PASS — verified via `tests/unit/f048-sb053-inbox-nav-order.test.tsx`, which mounts `AppSidebar` (JSDOM + Testing Library `render`) for owner, member and guest role combinations and asserts the *first* rendered nav link (by accessible name, i.e. `link.textContent`) inside the unlabeled primary group (`[data-tour="sidebar-nav"]`'s first group) is "Inbox". Also added a regression-guard test asserting the first five primary items are not the old order (`Dashboard, My Tasks, Projects, Chat, Inbox`). Confirmed non-vacuous: temporarily reverted the `work` array to the pre-fix order in place (removed Inbox from the front, re-added it at the end, matching the exact order the scrutiny report described), re-ran the test file — all 4 tests failed as expected — then restored the fix and re-ran to confirm all 4 pass again.

## Files changed
components/nav/app-sidebar.tsx
tests/unit/f048-sb053-inbox-nav-order.test.tsx

## Commands run
`npx vitest run tests/unit/f048-sb053-inbox-nav-order.test.tsx` (0, 4/4 passed, post-fix)
`npx vitest run tests/unit/f048-sb053-inbox-nav-order.test.tsx` (1, 0/4 passed — run against temporarily-reverted order, confirms non-vacuous)
`npx tsc --noEmit -p .` (0, clean)
`npx eslint components/nav/app-sidebar.tsx tests/unit/f048-sb053-inbox-nav-order.test.tsx` (0, clean)
`npx vitest run tests/unit` (nonzero overall — 46 failed / 539 passed / 1 skipped test files, matches baseline count; see diff below)

## Decisions made
- Reordered only the `work` array's item order in `components/nav/app-sidebar.tsx` (moved the existing `Inbox` `NavItem` literal to be first, ahead of Dashboard/My Tasks/Projects/Chat). No other array (`tools`, `plan`, `team`, other groups) touched, no new props/gating added — this is a pure ordering fix per the FU-M4-1 spec, which scoped the change to reordering only.
- Test targets the first group's rendered links directly under `[data-tour="sidebar-nav"]` rather than filtering by group label, since the primary group's `label` is `null` (unlabeled) and is always rendered first in `groups.map(...)` — this matches the assertion text "first item of the primary nav group" precisely without needing to add a `data-testid` to the group itself (out of scope; no test elsewhere depends on such an id).
- Did not touch the existing hard-coded-old-order concern from FU-M4-1 ("update any existing test that hard-codes the old ordering") — grepped `tests/unit/*.test.tsx` for `["Dashboard", "My Tasks", ...]`-style ordering assertions and found none; `f018-sidebar-mobile-sheet.test.tsx` only asserts presence of "Dashboard"/"My Tasks" individually (via a `for...of` loop, order-independent), so nothing needed updating.
- Verified the fix is non-vacuous by editing the array in place to the old order, rerunning the new test file (all 4 failed), then reverting to the fixed order — did not use `git stash` per the rule against it; used plain `Edit` calls both ways.

## Out-of-scope work needed
The M4 scrutiny report (`missions/20260921-212654/milestones/M4-scrutiny.md`) lists five other follow-ups (FU-M4-2 through FU-M4-6) covering SB-051/SB-052 guest-parity, SB-054 badge gating + reconcileFailed, swallowed fetch errors, nav active-state / stale dashboard link, and source-text-test replacement + bell dead-code removal. None of those are in scope for F048 (assigned only SB-053) and none were touched here.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used the sidebar's `[data-tour="sidebar-nav"]` container plus `within(...).getAllByRole("link")` to identify "the first link in the unlabeled primary group" rather than adding a new test-only DOM hook, since the primary group's `<div>` wrapper already has no distinguishing attribute of its own (grouped only by array position) and is unconditionally rendered first among all groups for every role tested — confirmed by reading the render loop at `components/nav/app-sidebar.tsx` around `groups.map((group, groupIndex) => ...)`.

## Notes for the next worker
- The full `npx vitest run tests/unit` run reproduces the same 46 pre-existing failing test files as `baseline-failing-files.txt` (47 lines including a trailing/blank entry) — confirmed via `comm -23 <(current) <(baseline)` returning empty. All failures are unrelated (F037 `th-extraction`, F060 `th-preview-pane`, etc.), consistent with the scrutiny report's own gate-status section.
- No MCP tools used — this is a pure client-component reordering fix with no external service or schema involvement.
