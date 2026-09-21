# Handoff: F012 — shared isBriefAnswerAnswered

## Status
COMPLETE

## Assertions covered
BR-015: PASS — whitespace-only text unanswered (lib/brief/is-answered.test.ts)
BR-016: PASS — single needs exactly 1, multi >=1
BR-021: PASS — brief page counters/missing count use the shared rule
BR-044: PASS — portal isAnswered delegates; agreement test

## Files changed
lib/brief/is-answered.ts
lib/brief/is-answered.test.ts
components/brief/team-answers-view.tsx
components/brief/brief-sectioned-view.tsx
components/brief/portal-questionnaire.tsx
components/brief/portal-brief-review.tsx
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/brief/page.tsx

## Commands run
`npx tsc --noEmit` (2; only baseline app/layout.tsx LayoutProps)
`npx eslint lib/brief components/brief brief/page.tsx` (0)
`npx vitest run` on brief/portal files (brief-related all pass; 10 failures only in unrelated f003-*-visibility-toggle and f009-board-layout, architecture)

## Decisions made
- Rule accepts {answerText, answerOptions}; portal isAnswered maps draft {text, options} onto it, signature unchanged.
- Also applied to portal-brief-review (missing flag) and AnswerValue in team view for consistency.
- brief-header receives answeredCount from page.tsx, so it is covered via the page counter.

## Out-of-scope work needed
Pre-existing failing tests: tests/unit/f003-page-client-visibility-toggle, f003-section-client-visibility-toggle, f009-board-layout (architecture area).

## Blockers

## Autonomous decisions

## Notes for the next worker
Use isBriefAnswerAnswered from lib/brief/is-answered for any new answered/missing logic.
