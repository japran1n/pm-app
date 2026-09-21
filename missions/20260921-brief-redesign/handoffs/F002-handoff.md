# Handoff: F002 — Remove type badges + choice chips sentence case

## Status
COMPLETE

## Assertions covered
BR-013: PASS — no Short/Long text or Single/Multi choice labels render for any answer type
BR-014: PASS — choice chips render stored text with no `uppercase` class (normal-case override) and rounded-md

## Files changed
components/brief/team-answers-view.tsx
tests/unit/f002-remove-type-badges-chip-case.test.tsx

## Commands run
`npx tsc --noEmit` (0, no errors excluding LayoutProps)
`npx vitest run tests/unit/f054-team-answers-view.test.tsx tests/unit/f002-remove-type-badges-chip-case.test.tsx` (0)
`npx vitest run tests/unit/f050... f066... f070...` (0)
`npx vitest run tests/unit` (1) — 141 failures pre-existing/unrelated (baseline without my change also fails ~144)

## Decisions made
- Spec claimed Badge outline variant has no uppercase; it does not: the base cva string in components/ui/badge.tsx includes `uppercase` for all variants. Added `className="rounded-md normal-case"` on the choice chips in team-answers-view.tsx instead of editing the shared Badge.
- Right-side header container is only rendered when the Edited badge applies.

## Out-of-scope work needed
- Other consumers of Badge that display user-authored text would also be uppercased; not touched.
- Pre-existing failing unit tests (e.g. f002-account-menu, E251 errors) unrelated to this feature.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: used normal-case override at call site rather than modifying shared Badge, to keep scope to one file.

## Notes for the next worker
Badge base class always applies uppercase; any chip showing user text needs `normal-case`.
