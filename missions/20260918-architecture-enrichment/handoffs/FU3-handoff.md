# Handoff: FU-3 — Fix architecture-view-toggle lifecycle bugs (C-6, C-7, C-8)

## Status
COMPLETE

## Assertions covered
This is a scrutiny-followup fix task (FU-3), not tied to new AS-NNN assertion IDs in the validation contract. It addresses three bugs (C-6, C-7, C-8) raised by the scrutiny validator against `components/architecture/architecture-view-toggle.tsx`:
C-7: PASS — server action failure on `{ ok: false }` now surfaces via `toast.error(...)` and reverts the toggle instead of silently showing nothing.
C-8: PASS — rapid toggle-off before fetch resolves now always clears `detailsLoading` immediately (via the early-return branch when `showDetails` is false) and a `fetchIdRef` guard prevents a stale in-flight response from re-enabling/mutating state after the fact.
C-6: PARTIAL/documented — stale data after writes (estimate saved, meta saved) is NOT fully fixed. See "Out-of-scope work needed" below; this was explicitly allowed as the minimum-acceptable scope for this fix.

## Files changed
components/architecture/architecture-view-toggle.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx vitest run components/architecture/architecture-view-toggle.test.tsx` (0, 1/1 passed)
`npx vitest run` (0 process exit; 253 test files / 180 tests failed, all pre-existing integration tests requiring a live Supabase/network connection unavailable in this sandbox — `TypeError: fetch failed` in `tests/integration/*`. None reference `architecture-view-toggle`. 501 files / 3745 tests passed.)

## Decisions made
- Moved the `localStorage` read for `showDetails` out of the `useState` initializer into a `useEffect` that runs once on mount (and when `storageKey`/`projectId` changes), initializing state to `false` on both server and first client render to eliminate the SSR hydration mismatch.
- Added a `fetchIdRef` (monotonically incrementing) to `architecture-view-toggle.tsx` so that: (a) turning the toggle off always increments the id and immediately clears `detailsLoading`, releasing the button even if a fetch is in flight; (b) a response from a superseded fetch (any id mismatch) is ignored entirely — it cannot re-enable the button, set stale data, or double-flip the toggle.
- On `{ ok: false }` or a thrown error from `getNodeDetailsForToggle`, call `toast.error(...)` (using `sonner`, already a project dependency used elsewhere) and revert `showDetails` to `false` so the toggle never looks "on" with no data and no feedback.
- Did not implement full C-6 fix (prop-threading `onWriteSuccess`/`refreshDetails` through `ArchitectureBoard`/`CanvasBoard` → `estimate-chip.tsx`'s `DisciplineEstimatePopover` and `node-meta-dialog.tsx`) — the task spec explicitly listed "implement C-7 and C-8; document C-6 as known limitation if prop-threading is too complex" as the minimum acceptable outcome, and the threading touches several files outside the stated scope (`Touches` for FU-3 is `architecture-view-toggle.tsx` only).

## Out-of-scope work needed
C-6 (stale data after writes) needs a follow-up feature: thread an `onWriteSuccess: () => void` callback from `ArchitectureViewToggle` down through `ArchitectureBoard` and `CanvasBoard` (both already receive `detailsData`/`showDetails` as props, so the wiring pattern exists) to:
- `components/architecture/estimate-chip.tsx` → `DisciplineEstimatePopover` (components/architecture/discipline-estimate-popover.tsx) — call the callback after `setDisciplineEstimate`/`clearDisciplineEstimate`/`setDisciplineEstimatesBulk` succeed.
- `components/architecture/node-meta-dialog.tsx` — call the callback after `setNodeMeta`/`setNodeMetaClientVisibility` succeed.
The callback, when invoked in `ArchitectureViewToggle`, should call `setDetailsData(null)`, which the existing fetch effect already treats as "not loaded" and will re-fetch the next time `showDetails` is true (no further wiring needed inside `architecture-view-toggle.tsx` beyond re-adding a small `refreshDetails` function, which was written and then removed from this fix once it was clear it had no caller yet — trivial to re-add).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used `sonner`'s `toast.error` for the C-7 error surface (task description offered "toast or inline error"; `sonner` is already a project dependency and used elsewhere in the app for action feedback, so it matches existing conventions and needs no new UI/inline error-state markup).
AUTONOMOUS_DECISION: Treated C-6 as documented-limitation per the task's explicit "Minimum acceptable for this fix" clause, since full prop-threading spans 3 additional files not listed in this task's file scope.

## Notes for the next worker
- The fetch-lifecycle effect in `architecture-view-toggle.tsx` already early-returns and resets `detailsLoading` whenever `showDetails` is false, and increments `fetchIdRef` on every showDetails transition — any future change to this effect should preserve that invariant (loading must never remain true once `showDetails` is false).
- The removed `refreshDetails()` helper (that sets `setDetailsData(null)`) is trivial to re-add when doing the C-6 follow-up; it was pulled out only because nothing called it yet and an unused function would trip lint.
- `npx vitest run` full-suite failures are pre-existing and environmental (no network access to Supabase in this sandbox) — unrelated to this change; verified none touch `architecture-view-toggle`.
