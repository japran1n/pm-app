# Handoff: F009 — Portal wizard by section + autosave indicator

## Status
COMPLETE

## Assertions covered
BR-040: PASS — one section per step, "Step N of M" (f055, f056 tests)
BR-041: PASS — Back/Next; Next blocked only by unanswered required in section (f055, f009, f060)
BR-042: PASS — per-question autosave (800ms debounce), aggregated Saving…/Saved (f009 test)
BR-045: PASS — helpText rendered per question (f009 test)
BR-046: PASS — option labels have normal-case; no uppercase (f009 test)
BR-047: PASS — saveBriefAnswer/submitBrief and server actions unchanged; same call args

## Files changed
components/brief/portal-questionnaire.tsx
components/brief/questionnaire-progress.tsx
components/brief/answer-input.tsx
tests/unit/f009-portal-wizard-sections.test.tsx
tests/unit/f055-portal-questionnaire.test.tsx
tests/unit/f056-questionnaire-progress.test.tsx
tests/unit/f060-required-validation.test.tsx

## Commands run
`npx vitest run` on f055-f061, f066, f076-answers, f063, f009 test files (0 for all portal/brief files; unrelated pre-existing f009-board-layout fails, matched by glob)
`npx tsc --noEmit` (only baseline LayoutProps errors)
`npx eslint` on changed files (0)

## Decisions made
- Drafts live in the parent (Record by question id) so required checks and submit see all answers; a QuestionField child per question runs useAutosave and reports saving/saved up to the parent, which aggregates for the section.
- Resume: first section with an unanswered question, else last section.
- Next stays disabled on the last section (submit flow unchanged); F010 can add review step at index === sections.length.
- Kept useAutosave default 800ms delay (<=1s).
- Added normal-case to option Labels in AnswerInput (no uppercase existed there, defensive).
- Existing tests: questions given distinct categories so they map to separate sections; assertion refs kept.

## Out-of-scope work needed
F010: review step and Edit links per section.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: Required badge still uses uppercase Badge (not a choice option; BR-046 concerns choice answers).

## Notes for the next worker
State: currentSectionIndex in PortalQuestionnaire; sections from groupBySection.
