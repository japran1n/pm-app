# Handoff: F020 — autosave error surfacing, serialized writes, explicit flush

## Status
COMPLETE

## Assertions covered
BR-042: PASS — failed ({success:false} / rejected) save shows "Couldn't save" not "Saved"; flush issues one write; writes serialized
BR-047: PASS — Submit disabled + warning while any answer failed to save; saveBriefAnswer unchanged

## Files changed
lib/hooks/use-autosave.ts
components/brief/portal-questionnaire.tsx
tests/unit/f020-autosave-error-serialize.test.tsx

## Commands run
`npx vitest run` portal/autosave files (f020, f055, f057-f061, f009-portal, f013-portal, portal-brief-review, f076, f066, f043, f063) (0 for all relevant; 5 unrelated architecture-board tests fail: f009-board-layout, f013-create-section, f020-reorder-sections, pre-existing)
`npx tsc --noEmit` (only baseline LayoutProps error)
`npx eslint` changed files (0)

## Decisions made
- useAutosave now returns { saving, lastSaved, error, flush }; runSave never rejects (resolves boolean); writes chained via a promise queue; flush clears the debounce timer and awaits the queue.
- A failed value is kept pending so a later flush retries it.
- Portal tracks failedIds (also for fields that failed after unmounting) via a wrapper around saveBriefAnswer; flushAll is called on Next/Back/review-edit and before Submit.

## Out-of-scope work needed
- If a save fails and the section unmounts, returning to that section does not auto-retry (the remounted hook treats the draft as already-saved), so Submit stays blocked until the user edits that answer again. A follow-up could persist failed drafts in the portal and retry on Submit.
- 5 unrelated architecture tests fail on baseline.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: Submit is disabled (not just warned) while any answer is in a failed state.

## Notes for the next worker
Resume-logic block in portal-questionnaire.tsx was not touched (F023).
