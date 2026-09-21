# Handoff: F025 — Generate Document tooltip opens on hover

## Status
COMPLETE

## Assertions covered
BR-024: PASS — disabled Generate button is aria-disabled (no native disabled), tooltip opens on real hover, click does not call generateBriefDocument, accessible name includes reason.

## Files changed
components/brief/generate-document-button.tsx
tests/unit/brief-actions-header.test.tsx
missions/20260921-brief-redesign/handoffs/F025-handoff.md

## Commands run
`npx vitest run tests/unit/brief-actions-header.test.tsx` (0, 15 passed)
`npx vitest run tests/unit/f073-edit-document.test.ts` (0)
`npx tsc --noEmit` (only baseline LayoutProps error)
`npx eslint <changed files>` (0)

## Decisions made
- The tooltip trigger is now the Button itself (rendered via TooltipTrigger render), replacing the span wrapper; aria-disabled="true", opacity-50, cursor-not-allowed, hover:bg-primary; no pointer-events-none.
- handleClick also guards on disabled/isPending. Real `disabled` kept only for isPending.
- Existing BR-024 tests updated (span -> button, aria-disabled instead of disabled).

## Out-of-scope work needed
None.

## Blockers
None.

## Autonomous decisions
None.

## Notes for the next worker
jsdom user-event hover works against base-ui tooltip with delay=0 provider.
