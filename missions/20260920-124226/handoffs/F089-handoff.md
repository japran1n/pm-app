# Handoff: F089 — M6 UX follow-up: fix duplicate tick mark in PeopleSwitcher

## Status
COMPLETE

## Assertions covered
AS-054: PASS — several members can be selected at once (toggling never clears the rest); each selected row now shows exactly one visible check indicator instead of two.

## Files changed
components/calendar/people-switcher.tsx
tests/unit/people-switcher-multiselect.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint . --max-warnings=0` (0)
`npx vitest run tests/unit/people-switcher-multiselect.test.tsx` (0, 14 passed)

## Decisions made
- Chose Option A (preferred in spec): removed the explicit `<CheckIcon className="ml-auto size-4 shrink-0" />` from `people-switcher.tsx`, kept `data-checked={isSelected ? "true" : undefined}`-equivalent (`data-checked={isSelected}`, which React serializes to `data-checked="true"`/`"false"`) on `CommandItem`. `command.tsx`'s `CommandItem` already renders its own `<CheckIcon>` whose visibility is controlled purely by CSS via the `group-data-[checked=true]/command-item:opacity-100` Tailwind variant, so removing the duplicate leaves exactly one check glyph, correctly shown/hidden per selection state.
- Removed the now-unused `CheckIcon` import from `people-switcher.tsx` (only `UsersIcon` remains).
- Rewrote the two F084 tests in the "PeopleSwitcher check indicator coverage (AS-054)" describe block. They previously distinguished the explicit vs. built-in icon by checking for an "opacity-0" class string, which no longer applies since only the built-in icon (which always has a static `opacity-0` class combined with a CSS variant, not toggled at the class-list level) remains. jsdom does not evaluate CSS, so opacity-based visibility can't be asserted directly in this test environment. Rewrote both tests to assert on `data-checked` (the real source of truth driving the CSS variant) and on exactly one `<svg>` being mounted in the row (proving no duplicate icon exists), which still fails if the duplicate-icon bug regresses (two svgs would appear) and still passes/fails meaningfully on selection state via `data-checked`.

## Out-of-scope work needed
None identified beyond this fix.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Selected Option A over Option B per the spec's explicit "preferred" marking; verified command.tsx's built-in check is visually adequate (uses the same CheckIcon glyph, standard accent-foreground color inherited from the row's selected background) so no additional styling change to command.tsx was needed.

## Notes for the next worker
No MCP usage — this is a pure client-side React/Tailwind fix with no external service touched. If a future worker touches `command.tsx`'s `CommandItem` check-icon styling, note that visibility there is entirely CSS-variant driven (`group-data-[checked=true]/command-item:opacity-100`) and won't show up as a class-list difference in jsdom-based tests — assert on `data-checked` instead of icon presence/absence when testing selection state in that primitive.
