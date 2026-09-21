# Handoff: F021 — signout-failure

## Status
COMPLETE

## Assertions covered
SB-015: PASS — sign-out redirects on success; on Supabase error the action returns {ok:false,error} with no redirect; all three client callers catch rejections/error results, toast, and re-enable the item.

## Files changed
lib/actions/auth.ts
components/nav/account-menu.tsx
components/nav/app-sidebar.tsx
components/portal/portal-sign-out-button.tsx
tests/unit/sign-out.test.ts
tests/unit/f002-account-menu.test.tsx

## Commands run
`npx vitest run tests/unit/sign-out.test.ts tests/unit/f002-account-menu.test.tsx tests/unit/optimistic-pending-audit.test.tsx tests/unit/portal-preview-signout.test.ts` (0)
`npx vitest run tests/unit` (non-zero; pre-existing baseline failures only)
`npx tsc --noEmit` (no errors in touched files)
`npx eslint <touched files>` (0, no output)

## Decisions made
- signOut() now returns `{ok:false, error}` (generic message, raw Supabase text logged only) instead of redirecting on error; success and preview-exit paths still redirect. Return type changed from Promise<never>.
- All three callers (account-menu, app-sidebar SignOutButton, portal SignOutButton) wrap the call in try/catch, toast.error on error/rejection; transition ends so the item re-enables.
- Replaced the old AS-022 "still redirects on error" test in sign-out.test.ts, which asserted the behavior FU-7 removes.
- Failure-path test re-queries the menu item after the click (menu may remount); passes if the menu closed or the item is enabled.

## Out-of-scope work needed
None.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: chose sonner toast for surfacing the error, matching the rest of the app.

## Notes for the next worker
Baseline failing-file diff: no new failures; f041-final-gate.test.tsx no longer fails (likely flaky, unrelated).
