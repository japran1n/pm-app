# Handoff: F087 — color contrast status labels

## Status
COMPLETE

## Assertions covered
AS-153: PASS — audited every place status/priority is rendered (board columns, TaskCard, task list table, list status select dropdown, dashboard pie/bar charts). In every case the colored dot/border/slice renders alongside the corresponding text label from STATUS_LABELS/PRIORITY_LABELS (or the Recharts legend/tooltip), never color-only. The overdue indicator (task-card.tsx, F040/AS-064) already pairs red text with a TriangleAlert icon plus an sr-only "Overdue:" prefix for screen readers — no change needed.
AS-154: PASS — measured the actual WCAG contrast ratio of every STATUS_COLORS/PRIORITY_COLORS hex value against a white card background (the app's default light theme). These colors are used only as non-text UI components (status dots, badge borders) — never as text color — so the applicable AA threshold is 3:1 (SC 1.4.11), not 4.5:1. 6 of 10 values measured below 3:1 on white; all 6 were swapped for a darker shade in the same Tailwind hue family until they cleared 3:1 (see Decisions below). New automated test tests/unit/task-colors-contrast.test.ts asserts every value in both maps clears 3:1 against white.

## Files changed
lib/task-colors.ts
tests/unit/task-colors-contrast.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0 errors; 1 pre-existing unrelated warning in lib/queries/search.ts)
`npm test` (0 failures in unit suite; 1 pre-existing, unrelated integration test failure — tests/integration/remove-member.test.ts AS-016 fails with "JWT issued at future", a Supabase clock-skew issue unrelated to this feature, present before this change)
`npm run build` (0)

## Decisions made
- Treated STATUS_COLORS/PRIORITY_COLORS as non-text UI components (dots/badge borders), so used the WCAG AA 3:1 "graphical object" threshold (SC 1.4.11) rather than the 4.5:1 text threshold — text itself always uses the theme's default foreground color via the *_LABELS strings, never these hex values.
- Measured contrast with the standard WCAG relative-luminance formula against white (#ffffff), the app's card/background color in the default light theme.
- Fixed 6 non-compliant values by moving to a darker shade in the *same* Tailwind hue family (kept the palette-family instruction from the task): 
  - STATUS_COLORS.in_review: amber-500 `#f59e0b` (2.15:1) → amber-600 `#d97706` (3.19:1)
  - STATUS_COLORS.done: green-500 `#22c55e` (2.28:1) → green-600 `#16a34a` (3.30:1)
  - PRIORITY_COLORS.high: orange-500 `#f97316` (2.80:1) → orange-600 `#ea580c` (3.56:1)
  - PRIORITY_COLORS.medium: yellow-500 `#eab308` (1.92:1) → yellow-700 `#a16207` (4.92:1) — yellow-600 `#ca8a04` was tried first and still measured 2.94:1, just under 3:1, so went one shade further to yellow-700
  - PRIORITY_COLORS.backlog: slate-400 `#94a3b8` (2.56:1) → slate-600 `#475569` (7.58:1)
  - PRIORITY_COLORS.none: slate-300 `#cbd5e1` (1.48:1) → slate-500 `#64748b` (4.76:1) — no collision with STATUS_COLORS.todo (also slate-500) since they're separate maps/domains
- Left already-compliant values untouched: STATUS_COLORS.todo (slate-500, 4.76:1), STATUS_COLORS.in_progress / PRIORITY_COLORS.low (blue-500, 3.68:1), PRIORITY_COLORS.urgent (red-500, 3.76:1).
- Did not touch component markup (task-card.tsx, board-column.tsx, task-list-table.tsx, list-status-select.tsx, dashboard charts) — AS-153 was already satisfied everywhere; only lib/task-colors.ts's hex values needed changing for AS-154.

## Out-of-scope work needed
None identified specific to this feature.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Applied the 3:1 non-text/UI-component WCAG AA threshold (rather than 4.5:1) to these colors since they render only as decorative dots/borders alongside a required text label, never as text color themselves. This is the correct SC per WCAG 2.1 1.4.11 for "graphical objects required to identify... a state" and is stricter than treating them as purely decorative (which would need no ratio at all), so it's the conservative/safe reading of AS-154 for this component type.

## Notes for the next worker
- lib/task-colors.ts is the single source of truth for both status and priority colors (F073/F106); any new consumer should import STATUS_COLORS/PRIORITY_COLORS + the paired *_LABELS from there rather than inventing new colors, to keep AS-153/AS-154 compliance centralized.
- tests/unit/task-colors-contrast.test.ts will fail if a future edit reintroduces a sub-3:1 color into either map — run it before adjusting task-colors.ts.
- The one failing integration test (tests/integration/remove-member.test.ts, AS-016, "JWT issued at future") is a pre-existing Supabase test-environment clock-skew issue, unrelated to F087; did not attempt to fix it since it's out of this feature's scope.
