# Handoff: F028 — team name sans, page contrast

## Status
COMPLETE

## Assertions covered
BR-017: PASS — person name sans, relative time font-mono
BR-006: PASS — notice lists Generate Document, Request Approval, Approve, Withdraw approval
BR-007: PASS — notice body uses text-muted-foreground
BR-026: PASS — role="alert" retained

## Files changed
components/brief/team-answers-view.tsx
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/brief/page.tsx
tests/unit/f003-missing-state-answered-by.test.tsx
tests/unit/f028-lookup-failure-notice.test.ts

## Commands run
`npx vitest run` (brief tests, 0)
`npx tsc --noEmit` (only baseline LayoutProps error)
`npx eslint <changed files>` (0)

## Decisions made
- Notice body uses text-muted-foreground (AA on surface); no icon added.
- New source-based test file for the page notice since brief-actions-header.test.tsx has others' uncommitted edits.

## Out-of-scope work needed
- "Not answered" (required) in team-answers-view.tsx still uses text-warning at 13px; same AA concern.

## Blockers

## Autonomous decisions

## Notes for the next worker
None.
