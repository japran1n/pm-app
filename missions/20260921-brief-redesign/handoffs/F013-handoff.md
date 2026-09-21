# Handoff: F013 — Portal Next non-blocking, Submit gate, autosave flush

## Status
COMPLETE

## Assertions covered
BR-041: PASS — Next advances with a non-blocking warning when a required question is empty
BR-042: PASS — pending debounced save flushed on section change and unmount (fake timers)
BR-044: PASS — review highlights missing required (summary + per-question); Submit disabled until all answered
BR-047: PASS — server actions unchanged; Submit awaits in-flight/flushed saves before submitBrief

## Files changed
components/brief/portal-questionnaire.tsx
components/brief/portal-brief-review.tsx
lib/hooks/use-autosave.ts
tests/unit/f013-portal-gate-autosave.test.tsx (new)
tests/unit/f060-required-validation.test.tsx
tests/unit/f009-portal-wizard-sections.test.tsx
tests/unit/portal-brief-review.test.tsx

## Commands run
`npx vitest run` portal/brief files incl. f013, f009, f055, f057, f060-required, portal-brief-review (0 for these; f060-discipline-estimate-schema fails at baseline, unrelated)
`npx tsc --noEmit` (only baseline LayoutProps and another worker's f014 TOC test error)
`npx eslint` changed files (0)

## Decisions made
- Warning is shown on the step following Next (state skippedRequired), since Next always advances; cleared on Previous/Edit.
- useAutosave now returns flush and flushes on unmount; errors on unmount flush are swallowed. Section change unmounts QuestionFields, so that path is covered by unmount flush.
- Parent tracks in-flight save promises; handleSubmit awaits them before submitBrief.
- PortalBriefReview gained optional missingCount prop for a consolidated summary.

## Out-of-scope work needed
- tests/unit/f060-discipline-estimate-schema.test.tsx fails at baseline (ArchitectureActionsProvider missing).
- Another f013*-named test (AS-029 add-section control) fails; not from this work.
- questionnaire-progress.tsx not changed (no need).

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: warning wording and placement (above step content) chosen by me.

## Notes for the next worker
Tests that leave edits pending and unmount now trigger a real saveBriefAnswer unless mocked; mock it in new portal tests.
