# Handoff: F023 — quiet-e251

## Status
COMPLETE

## Assertions covered
SB-004: PASS — full `npx vitest run tests/unit` failing-file set is a subset of baseline (46 vs 47; f041-final-gate.test.tsx no longer fails, no new failures). E251 occurrences in the full run: 0.

## Files changed
tests/unit/app-sidebar-archive-nav.test.tsx
tests/unit/app-sidebar-settings-nav.test.tsx
tests/unit/app-sidebar-trash-nav.test.tsx
tests/unit/f002-account-menu.test.tsx
tests/unit/f003-dissolve-other-group.test.tsx
tests/unit/f004-preview-as-client-account-menu.test.tsx

## Commands run
`npx vitest run tests/unit` (1, same pre-existing baseline failures; diff vs baseline: only f041-final-gate.test.tsx removed, nothing added)
`npx eslint <6 touched files>` (0)
`npx tsc --noEmit` (0 errors in touched files)

## Decisions made
- Stubbed NotificationBell via vi.mock in the 6 AppSidebar test files that emitted E251 (found by running every AppSidebar test file and counting E251); no production props changed.
- Left the other sidebar files alone since they emitted no E251 (they already mock the bell or the action).

## Out-of-scope work needed
None.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: chose per-file vi.mock over a global setup mock because notification-bell-panel tests need the real component.

## Notes for the next worker
E251 came from NotificationBell calling getNotificationPreferences (server action -> cookies()) in a mount effect when currentUserId is passed.
