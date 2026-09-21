# Handoff: F023 — single answered rule everywhere, retry failed autosave

## Status
COMPLETE

## Assertions covered
BR-015: PASS — whitespace-only text unanswered in portal resume and team view
BR-016: PASS — multi-option single_choice answered in both
BR-044: PASS — a team row never renders chips and "Not answered" together
BR-042: PASS — failed save retried via Retry / flush without re-typing

## Files changed
components/brief/portal-questionnaire.tsx
components/brief/team-answers-view.tsx
tests/unit/f023-single-answered-rule.test.tsx

## Commands run
`npx vitest run` brief-*, f054-f061, f009, f013, f020, f022, f023, portal* (only pre-existing architecture-board and f060-discipline failures; 11 tests)
`npx tsc --noEmit` (only baseline LayoutProps error)
`npx eslint` changed files (0)

## Decisions made
- Portal resume now calls isBriefAnswerAnswered; team AnswerValue drops its inline options/text check (only rendered for answers the shared rule accepted).
- Retry lives in the portal, not the hook: flushAll re-sends any still-failed answer from the latest drafts (draftsRef) when its field's own flush did not already retry it. Covers unmounted/remounted fields. Retry buttons in the section status area and next to the review-step warning.
- lib/hooks/use-autosave.ts not changed.
- Remaining hand-rolled checks: portal-brief-review.tsx and lib/brief/document.ts only format display values (not answered rules), left alone.

## Out-of-scope work needed
- portal-brief-review.tsx / lib/brief/document.ts display formatters check options-first then text; they could share the helper if desired.
- Pre-existing failures: f009-board-layout, f022-reorder-columns, f023-keyboard-dnd, f013-create-section, f020-reorder-sections, f060-discipline-estimate-schema.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: Implemented retry in portal-questionnaire rather than use-autosave, since the remounted hook cannot know a prior draft failed.

## Notes for the next worker
Test file f023-single-answered-rule.test.tsx covers divergence and the leave/return/Retry flow.
