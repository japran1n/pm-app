# Handoff: F018 — minors

## Status
COMPLETE

## Assertions covered
BR-014: PASS — choice chips text-sm, normal-case, rounded-md, no 9px/uppercase (f054 test)
BR-024: PASS — disabled trigger has aria-disabled and aria-label with reason (brief-actions-header test)
BR-006: PASS — docs lookup error shows notice instead of Generate Document (source-structure test)
BR-017: PASS — profile lookup failure in getBriefWithRevisions is non-fatal, names null (new mocked test)

## Files changed
components/brief/team-answers-view.tsx
components/brief/generate-document-button.tsx
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/brief/page.tsx
lib/queries/brief.ts
tests/unit/f054-team-answers-view.test.tsx
tests/unit/brief-actions-header.test.tsx
tests/unit/brief-profile-lookup-nonfatal.test.ts
missions/20260921-brief-redesign/handoffs/F018-handoff.md

## Commands run
`npx vitest run` brief-*, f054, f048, f066, f067, f070, f088, portal-brief-review (only f048-component-panel-dnd fails: 4 tests, ArchitectureActions context, unrelated/pre-existing)
`npx tsc --noEmit` (baseline LayoutProps error only)
`npx eslint` on changed files (0)

## Decisions made
- getBriefWithRevisions now reuses loadProfileNames (already non-fatal, logs and returns empty map), removing the duplicated inline query.
- Page shows a muted "Couldn't check for an existing brief document. Reload to try again." notice when the docs lookup errors.
- Disabled span given role="group", aria-disabled, aria-label including the reason.
- Dead code (e): grep found no unused exports/imports in the touched brief files; nothing removed.

## Out-of-scope work needed
tests/unit/f048-component-panel-dnd.test.tsx fails (missing ArchitectureActionsProvider); unrelated to brief.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: page test is a source-structure check because the server page needs a request context.

## Notes for the next worker
None.
