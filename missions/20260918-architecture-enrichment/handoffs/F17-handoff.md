# Handoff: F17 — `<EstimateChip>` na kartici sekcije

## Status
COMPLETE

## Assertions covered
No assertion IDs are assigned to F17 in validation-contract.md; this feature is scoped by its Definition of Done checklist instead.

## Files changed
components/architecture/estimate-chip.tsx
components/architecture/section-card.tsx

## Commands run
`npx tsc --noEmit` (0)

## Decisions made
- Placed the chip below the title area (`<div className="mt-1">...</div>`) rather than inside the top-right absolute-positioned action row, since the spec text offered that as an explicit alternative ("ili u zasebnom redu") and it avoids crowding the existing Link/Create/Unlink/visibility/delete button cluster.
- Chip is `h-5` fixed height per spec so it never affects the card's layout when shown, and renders nothing at all when `showDetails` is false/undefined, so collapsed cards are byte-identical to before this change.
- Followed the codebase's existing `Popover`/`PopoverTrigger render={<Button .../>}` pattern already used elsewhere in `section-card.tsx` for consistency.

## Out-of-scope work needed
None identified. `showDetails` and `estimates` are optional props not yet wired up by any caller — the caller that threads `showDetails`/`estimates` into `<SectionCard>` (presumably from F15's toggle state and F16-era queries) is out of scope for F17 per the spec, which only covers the chip + card prop plumbing.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chip placement chosen as "below title, own row" per the spec's explicit alternative wording, rather than inside the absolute top-right hover action row, to avoid visual crowding with existing icon buttons.

## Notes for the next worker
`estimate-chip.tsx` and the new `SectionCard` props (`showDetails`, `estimates`) are ready to use but unwired — whichever feature owns passing `showDetails`/`estimates` down from the board/page level (likely reading F15's toggle state and F06/F16's estimate data) needs to pass them into `<SectionCard>` for the chip to actually appear at runtime.
