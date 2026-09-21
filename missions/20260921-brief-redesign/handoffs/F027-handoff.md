# Handoff: F027 — portal submit hang, retry tests, review shared rule

## Status
COMPLETE

## Assertions covered
BR-042: PASS — thrown saveBriefAnswer shows "Couldn't save"; Retry re-sends failed text ("Acme") and status clears
BR-044: PASS — whitespace-only required answer highlighted in PortalBriefReview
BR-047: PASS — rejected submitBrief shows error, button re-enabled, second click succeeds; Submit blocked while a save failed, enabled after Retry

## Files changed
components/brief/portal-questionnaire.tsx
tests/unit/f027-portal-submit-retry.test.tsx

## Commands run
`npx vitest run` portal tests (f055-f061, f009, f013, f020, f023, portal-brief-review, f027) (glob also matched unrelated architecture-board/estimate tests, 14 pre-existing failures there; all portal tests pass)
`npx tsc --noEmit` (only baseline LayoutProps error)
`npx eslint` changed files (0)

## Decisions made
- handleSubmit wraps flushAll+submitBrief in try/catch/finally; finally clears submitting; catch shows "Couldn't submit this brief. Please try again."
- portal-brief-review.tsx already used isBriefAnswerAnswered (from F012), so no code change was needed; added the whitespace-only test.
- use-autosave.ts untouched.

## Out-of-scope work needed
- Pre-existing unrelated failures: f009-board-layout, f013-create-section, f020-reorder-sections, f023-keyboard-dnd, f027-instance-display, f060-discipline-estimate-schema.

## Blockers

## Autonomous decisions

## Notes for the next worker
Pressing Next flushes and retries failed answers, so Retry test clicks the section-level Retry button before Next.
