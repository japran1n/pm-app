# Handoff: F017 — BR-026 behavioural tests

## Status
COMPLETE

## Assertions covered
BR-026: PASS — approve/request/withdraw buttons rendered in jsdom, clicked, mocked actions asserted (args, refresh, error UI, disabled state); minimal structural page check retained.

## Files changed
tests/unit/brief-actions-header.test.tsx
missions/20260921-brief-redesign/handoffs/F017-handoff.md

## Commands run
`npx vitest run tests/unit/brief-actions-header.test.tsx` (0) — 12 passed
`npx tsc --noEmit` (no errors in this file)
`npx eslint tests/unit/brief-actions-header.test.tsx` (0)

## Decisions made
- Added `// @vitest-environment jsdom` file-wide; existing renderToStaticMarkup tests still pass under jsdom.
- Page-level brief.state conditional is a server component; kept only a two-line source check for it.
- Mocked next/navigation useRouter with a shared refresh spy; mocked approveBrief/requestBriefApproval/withdrawBriefApproval.

## Out-of-scope work needed
None.

## Blockers

## Autonomous decisions

## Notes for the next worker
The BR-023/BR-025 tests still use readFileSync on page.tsx; not in scope.
