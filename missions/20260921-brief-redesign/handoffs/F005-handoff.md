# Handoff: F005 — Actions in header + Generate disabled/tooltip

## Status
COMPLETE

## Assertions covered
BR-023: PASS — actions render in BriefHeader `actions` slot; floating div removed
BR-024: PASS — GenerateDocumentButton disabled + Tooltip (span trigger) when requiredMissingCount > 0
BR-025: PASS — NotificationRecipientsPointer passed via BriefHeader `meta` slot, in meta line
BR-026: PASS — approval conditions/logic unchanged, only moved

## Files changed
components/brief/brief-header.tsx
components/brief/generate-document-button.tsx
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/brief/page.tsx
tests/unit/brief-actions-header.test.tsx

## Commands run
`npx vitest run` brief/f054-f078 tests + new tests (0)
`npx eslint components/brief page.tsx tests` (0)
`npx tsc --noEmit` (only baseline LayoutProps error)

## Decisions made
- BriefHeader stays a Server Component; new optional `meta` and `actions` ReactNode slots.
- Tooltip trigger is a focusable span (base-ui `render` prop) since disabled buttons swallow pointer events; eslint-disable for tabindex.
- Default disabledReason "Answer all required questions first".

## Out-of-scope work needed
None. Unrelated baseline failures exist in the full suite (e.g. f002-account-menu, cookies() outside request scope).

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: Actions row sits inside header with pt-1 spacing; header mb-6 unchanged.

## Notes for the next worker
Generate button wrapper changed from items-end to items-start alignment since actions are now left-aligned.
