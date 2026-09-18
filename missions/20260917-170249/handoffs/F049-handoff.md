# Handoff: F049 — FU9 icon token assertion

## Status
COMPLETE

## Assertions covered
AS-127: PASS — added a new test ("active route: the icon carries the permitted text-muted-foreground token, not text-tertiary-foreground") that mutation-verified RED when the icon's class was swapped to `text-tertiary-foreground`, then PASS after restoring `text-muted-foreground`. Full test file run: 28/28 passing (includes pre-existing AS-127 icon-presence tests plus F048's concurrently-added nested-subpath tests).

## Files changed
tests/unit/app-sidebar-webflow-nav.test.tsx
components/nav/app-sidebar.tsx

## Commands run
`npx vitest run tests/unit/app-sidebar-webflow-nav.test.tsx` (0) — 28 passed
`npx vitest run tests/unit/app-sidebar-webflow-nav.test.tsx` after mutating icon class to `text-tertiary-foreground` (1) — 1 failed (the new AS-127 token test), confirming it is genuinely falsifiable
`npx vitest run tests/unit/app-sidebar-webflow-nav.test.tsx` after restoring the class (0) — 28 passed

## Decisions made
- Scoped the new assertion to the icon's `classList` specifically (`icon.classList.contains(...)`), not the link's, since the link element already has its own separate text-muted-foreground/font-medium assertions in the AS-006 block — this keeps the new test independently failable per the assignment.
- Added a one-line comment directly above the `<Icon>` element in app-sidebar.tsx recording the deliberate design decision (icon stays lower-contrast text-muted-foreground even when active, vs. the active label's text-foreground) and explicitly naming why text-tertiary-foreground is not an option here (CLAUDE.md: that token is decorative-only, and this icon is operative navigation content the user reads to operate the app).
- Tested only the active-route case (icon still renders `text-muted-foreground` unconditionally per the JSX, regardless of active/inactive) since the existing suite already separately covers the inactive-route icon-presence case; the new test's value is specifically ruling out the tertiary-token swap that slipped through M1 scrutiny-2.

## Out-of-scope work needed
None identified for this narrow assertion-hardening feature.

## Blockers
None.

## Autonomous decisions
None — spec was unambiguous (concrete mutation to guard against, concrete comment to add).

## Notes for the next worker
While working, another concurrent worker (F048, "nested sub-route active highlighting") was editing the same test file and `components/nav/app-sidebar.tsx` in parallel and briefly clobbered my in-progress edits (a stale read momentarily showed the Webflow `href` hardcoded to `/w/acme` and the icon reverted to `text-tertiary-foreground` from my own mutation-verification step, mixed together). I re-read the files fresh, restored my exact intended diff (verified via `git diff` immediately before commit — the final diff for both files contained only my AS-127 comment + icon-class-preservation and F048's already-committed nested-subpath tests, nothing else), reran the full test file (28/28 green), and committed immediately. No corruption made it into the commit. If a future run sees flaky/mismatched file state again, always re-read + re-diff right before `git add`/commit rather than trusting an earlier Read.
