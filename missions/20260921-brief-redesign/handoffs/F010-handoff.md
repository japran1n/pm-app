# Handoff: F010 — Portal final review + edit links

## Status
COMPLETE

## Assertions covered
BR-043: PASS — Next on last section opens review with all answers, per-section Edit button, progress shows "Review" (portal-brief-review tests)
BR-044: PASS — required-unanswered flagged with "Not answered"; Submit disabled and only on review; clearing a required answer via Edit blocks reaching review

## Files changed
components/brief/portal-brief-review.tsx
components/brief/portal-questionnaire.tsx
components/brief/questionnaire-progress.tsx
tests/unit/portal-brief-review.test.tsx
tests/unit/f061-submit.test.tsx
tests/unit/f055-portal-questionnaire.test.tsx

## Commands run
`npx vitest run` on f055-f061, f076, f009-portal, portal-brief-review (only unrelated f060-discipline-estimate-schema fails, pre-existing glob match)
`npx tsc --noEmit` (only baseline LayoutProps errors)
`npx eslint` on changed files (0)

## Decisions made
- Review step is currentSectionIndex === sections.length; Next stays on last section and goes to review; review has no Next.
- Review receives live drafts (Map of answerText/answerOptions), so unsaved values show. Prop type ReviewAnswer is a structural subset of BriefAnswer.
- Submit (incl. submitted message) rendered only on review; button disabled when !briefId, submitting, or required unanswered; handleSubmit guard kept.
- QuestionnaireProgress got optional isReview prop: text "Review", bar full.
- Because Next is blocked by unanswered required and resume lands on the first unanswered section, review with a missing required is UI-unreachable; highlighting is tested at component level, blocking at integration level.
- f061 tests: submit now reached via Next; the "blocked" test now asserts the review/submit is unreachable; editability test uses the Edit button.

## Out-of-scope work needed
None.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: Prettier reformatted portal-questionnaire.tsx, so its diff is larger than the logical change.

## Notes for the next worker
Test ids: portal-brief-review, review-section, review-edit-button, review-question, review-not-answered.
