# Handoff: F084 — Fix AS-054 CheckIcon coverage

## Status
COMPLETE

## Assertions covered
AS-054: PASS — added two tests in `tests/unit/people-switcher-multiselect.test.tsx` that assert the visible check indicator is present when a member is selected and absent when not, targeting the explicit `CheckIcon` F081 added inside `components/calendar/people-switcher.tsx`'s member `CommandItem`. Mutation-tested by temporarily deleting that CheckIcon from the component — the new "selected" test failed as expected, then the component was restored and the full suite passed again.

## Files changed
tests/unit/people-switcher-multiselect.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint tests/unit/people-switcher-multiselect.test.tsx --max-warnings=0` (0)
`npx eslint . --max-warnings=0` (0)
`npx vitest run tests/unit/people-switcher-multiselect.test.tsx` (0, 14 passed)
Mutation check: deleted the explicit `{isSelected ? <CheckIcon .../> : null}` block from `components/calendar/people-switcher.tsx`, re-ran `npx vitest run tests/unit/people-switcher-multiselect.test.tsx` → `test_AS_054_selected_member_renders_a_visible_check_indicator` failed as expected (1 failed / 13 passed), then restored the component from a backup and confirmed `git diff --stat components/calendar/people-switcher.tsx` was empty before re-running the full suite green.

## Decisions made
- Read `components/calendar/people-switcher.tsx` first to see what F081 actually added: each member `CommandItem` carries `data-checked={isSelected}`, `aria-selected={isSelected}`, a conditional `bg-accent` class, and — critically — an explicit `{isSelected ? <CheckIcon className="ml-auto size-4 shrink-0" /> : null}` rendered as a child after the member name.
- Discovered mid-implementation that `components/ui/command.tsx`'s base `CommandItem` primitive *always* renders its own `<CheckIcon>` (opacity-controlled via `group-data-[checked=true]/command-item:opacity-100`, driven off the same `data-checked` attribute) regardless of the people-switcher-specific conditional icon. This means every `CommandItem`, selected or not, has at least one `<svg>` in the DOM at all times — a naive "does this item contain an svg" assertion cannot distinguish selected from unselected and would pass even if F081's explicit icon were deleted (confirmed by mutation-testing the naive version first: it failed on the *unselected* case because the base primitive's icon svg is always present).
- AUTONOMOUS_DECISION: wrote a small `explicitCheckIcon` helper in the test that filters an item's `<svg>` descendants to the one whose class list does NOT contain `opacity-0` — that isolates F081's always-visible explicit icon from cmdk's own opacity-0-by-default icon, which is not observable via jsdom's non-rendered CSS (Tailwind classes aren't applied as computed styles in jsdom, so checking `opacity` directly wasn't viable; checking for absence of the `opacity-0` class was the reliable proxy). Verified this discriminates correctly via the mutation test: deleting F081's icon made the "selected" test fail while leaving the "unselected" test's assertion (still passing, still `null`) unaffected.
- Kept the two new tests in the existing `tests/unit/people-switcher-multiselect.test.tsx` file per the task instructions rather than creating a new file, since that file already owns AS-054 coverage.

## Out-of-scope work needed
None noticed beyond this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Targeted the explicit per-item `CheckIcon` (identified by absence of the `opacity-0` class) as "the" visible indicator rather than raw `data-checked` attribute or raw svg presence, because the base `CommandItem` primitive unconditionally renders its own opacity-controlled check icon for every row (selected or not), making naive svg-presence assertions non-falsifiable against deletion of F081's actual indicator. This was discovered and confirmed via an initial failing test run against the real component before settling on the final assertion.

## Notes for the next worker
- `components/ui/command.tsx` CommandItem's own built-in CheckIcon (`ml-auto opacity-0 group-has-data-[slot=command-shortcut]/command-item:hidden group-data-[checked=true]/command-item:opacity-100`) is a second, separate `<svg>` present on every item at all times — any future test asserting on "an svg exists inside this CommandItem" will be non-falsifiable for F081's actual selection indicator. Assert on the class-based discriminator (no `opacity-0`) as done here, or on `data-checked`/`aria-selected` attributes directly if indicator styling changes again.
- No MCP tools were used — this is a pure unit-test / UI-component fix with no external service touched.
