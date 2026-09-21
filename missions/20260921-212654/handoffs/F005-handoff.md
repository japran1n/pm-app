# Handoff: F005 — Collapsible Tools

## Status
COMPLETE

## Assertions covered
SB-020: PASS — Tools heading is a button with aria-expanded/aria-controls; click hides/shows the 3 links
SB-021: PASS — state persisted under `sidebar:tools-open`; throwing localStorage renders expanded with no console errors
SB-022: PASS — Code2, FileCode2, Network (three distinct lucide icons)

## Files changed
components/nav/app-sidebar.tsx
tests/unit/f005-sidebar-tools-collapsible.test.tsx
tests/unit/th-sidebar-tools-guest.test.tsx

## Commands run
`npx vitest run tests/unit/f005-sidebar-tools-collapsible.test.tsx tests/unit/th-sidebar-tools-guest.test.tsx tests/unit/app-sidebar-webflow-nav.test.tsx` (0 for repo files; only stale copies under .claude/worktrees fail)
`npx tsc --noEmit` (0 errors in touched files)
`npx eslint components/nav/app-sidebar.tsx tests/unit/f005-sidebar-tools-collapsible.test.tsx` (0)
`npm test` equivalent full tests/unit compared with baseline: no new failing repo test files after fix

## Decisions made
- Heading stays a `<p>` wrapping the `<button>` and links stay direct children of the group wrapper, so existing TH/AS-005 tests (heading via `p`, shared parent) keep passing. Links get `hidden` when collapsed; aria-controls lists all link ids (useId-based, unique across desktop and mobile renders).
- One-line eslint-disable for react-hooks/set-state-in-effect on the post-mount localStorage read (spec mandates useEffect read).
- th-sidebar-tools-guest.test.tsx: heading lookup now accepts the button inside the P.

## Out-of-scope work needed
None. Stale copies under .claude/worktrees/agent-*/tests fail against nothing of ours; ignore.

## Blockers
None.

## Autonomous decisions
AUTONOMOUS_DECISION: aria-controls uses a space-separated id list (valid IDREFS) since there is no single panel wrapper.

## Notes for the next worker
jsdom here has no usable window.localStorage; tests install a stub via Object.defineProperty.
