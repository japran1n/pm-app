# Handoff: F014 — Portal approval actions double-click guard tests (fix-up)

## Status
COMPLETE

## Assertions covered
AS-015: PASS — `test_AS_015_second_synchronous_approve_click_issues_no_second_call` now dispatches both clicks via raw `.click()` inside a single `act()` call, mutation-verified against the `inFlightRef` guard.
AS-016: PASS — `test_AS_016_second_synchronous_send_click_issues_no_second_call` given the same treatment for the request-changes send path, mutation-verified.

## Files changed
components/portal/approval-actions.test.tsx

## Commands run
`npx vitest run components/portal/approval-actions.test.tsx` (0, 7 passed)
`npx tsc --noEmit` (0)
`npm run lint` (0, 15 pre-existing warnings unrelated to this file, 0 errors)

Mutation verification (not committed, restored before final run):
`sed -i '' 's/if (inFlightRef.current) return;//' components/portal/approval-actions.tsx` then `npx vitest run components/portal/approval-actions.test.tsx` → both AS-015 and AS-016 double-click tests FAILED (`approveMock`/`requestChangesMock` called 2 times instead of 1). File restored from backup, re-ran tests → 7/7 pass again.

## Decisions made
- Root cause of the vacuous test (per scrutiny finding): `fireEvent.click(button)` calls `act()` and flushes a render internally on each call. The first click synchronously sets `optimisticApproved`/`optimisticSent` to `true` (before the transition even starts), which unmounts the Approve/Send button and mounts the "Approved."/"Sent" div. By the time the second `fireEvent.click(button)` runs, `button` is a detached DOM node with no React event listener reachable from it, so the second click never reaches `handleApprove`/`handleRequestChanges` at all — the assertion `toHaveBeenCalledTimes(1)` passes whether or not the `inFlightRef` guard exists.
- Fix: dispatch both clicks with the raw DOM `.click()` method wrapped in a single explicit `act(() => { button.click(); button.click(); })`. Both event dispatches and their synchronous handler bodies (`if (inFlightRef.current) return; inFlightRef.current = true; setOptimisticApproved(true); startTransition(...)`) run back-to-back before React commits any re-render (React 18 automatic batching batches state updates scheduled inside the same `act` callback), so the button is still mounted for the second click and the guard is the only thing standing between one call and two.
- Did not change production code in `approval-actions.tsx` — the ref guard implementation was already correct; only the test was vacuous. No real production gap found.
- Did not touch `lib/actions/portal-approval.ts` signatures, per instructions.

## Out-of-scope work needed
None identified within F014's remit. Other in-flight worker changes (`components/board/board.tsx`, `lib/actions/portal-approval.ts`, `lib/queries/portal.ts`, `tests/e2e/portal-approve.spec.ts`, `tests/unit/portal-overview-live.test.tsx`, `next-env.d.ts`) were present as uncommitted local modifications from other concurrent workers before I started; I left them untouched and did not stage or commit them.

## Blockers
None.

## Autonomous decisions
AUTONOMOUS_DECISION: Chose the "single `act()` wrapping two raw `.click()` calls" approach over the "hold the mocked action unresolved on a deferred promise and click again while pending" alternative suggested in the task brief, because the deferred-promise approach doesn't actually help here — the button already detaches synchronously (before any promise settles) due to the optimistic state flip happening before `await`, so the deferred promise doesn't keep the button mounted. The `act()`-batching approach directly addresses the real cause (RTL/act flushing a render between separate `fireEvent` calls) and is the one that mutation-testing confirmed fails when the guard is removed.

## Notes for the next worker
- The scrutiny finding in `missions/20260902-212300/milestones/scrutiny-1.md` was correct: two sequential `fireEvent.click` calls are not a valid way to test synchronous double-click guards in this component, because the optimistic UI branch unmounts the button before the second `fireEvent` call runs. Any other component in this codebase with the same "optimistic branch swaps out the triggering button" pattern (search for `inFlightRef` usage) should use the same `act(() => { el.click(); el.click(); })` pattern rather than two `fireEvent.click` calls if it needs a genuine same-tick double-click test.
- No MCP tools used — this is a pure component/unit-test fix with no external service or live-state touchpoint.
