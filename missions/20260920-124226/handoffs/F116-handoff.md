# Handoff: F116 — Fix AS-069 render-level guard (final)

## Status
COMPLETE

## Assertions covered
AS-069: PASS — new render-level test `test_AS_069_no_bare_hour_figure_rendered_in_stacked_row` in tests/unit/f036-stacked-scroll-colour.test.tsx catches bare digit-hour tokens (e.g. "8h", "16h") with no requirement for a neighbouring context word; verified via mutation (reintroducing `{blocks.length * 8}h` made it fail, removing it made it pass).

## Files changed
tests/unit/f036-stacked-scroll-colour.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx eslint . --max-warnings=0` (0)
`npx vitest run tests/unit/f036-stacked-scroll-colour.test.tsx` (0) — 11 passed

## Decisions made
- Read `components/calendar/stacked-person-row.tsx` in full before editing. The live bare-hours capacity span scrutiny pass 9 quoted (`<span>{blocks.length * 8}h</span>` at ~line 140) is NOT present in the current source — the person-label div only renders `{userLabel}` (line 140: `<div className="mb-1 text-sm font-medium">{userLabel}</div>`). No component code change was needed or made; `git diff` on the component file is empty.
- Added a new render-level test rather than trusting the existing source-text regex sweep (`test_AS_069_no_capacity_figure_in_any_planner_file`), per the spec's instruction that source-text regexes miss runtime-interpolated bare hour figures.
- First regex attempt (`/\b\d+\s*h\b/i`) failed to catch the mutation during verification: jsdom's `container.textContent` concatenates sibling block-level elements with no whitespace, so "16h" immediately followed by the next div's "Mon" text became "16hMon" in the flattened text, and the trailing `\b` after `h` did not match (h followed directly by a word character 'M' is not a boundary). Fixed by dropping the trailing boundary: `/\b\d+\s*h/i`, which correctly matches "16h" regardless of what immediately follows. Confirmed via explicit mutation cycle: (1) added the bare-hours span, (2) test failed, (3) removed it, (4) test passed — full mutation-testing sign-off performed before commit.
- No legitimate rendered text in this component contains a bare "<digits>h" substring (hour markers are DOM attributes `data-hour`, not text; day labels are 3-letter abbreviations; dates are `YYYY-MM-DD`; block titles are arbitrary but the test fixture uses "Test block"), so the loosened regex carries no realistic false-positive risk for this component.

## Out-of-scope work needed
None identified. This is the final attempt on AS-069 per the assigned scope; the underlying bug scrutiny described was not present in the source at the time of this pass, so only the test hardening was needed.

## Blockers
None.

## Autonomous decisions
AUTONOMOUS_DECISION: Did not modify `components/calendar/stacked-person-row.tsx` because the specific line/bug scrutiny quoted did not exist in the current source (the person-label div renders only `{userLabel}`, no capacity span). Verified this via direct `Read` of the full file before making any change, and confirmed via `git diff --stat` that the component file has zero net changes. Proceeded with only the test hardening step (step 3-4 of the spec), since step 2 ("remove the capacity figure") had nothing to remove.

## Notes for the next worker
The earlier scrutiny-pass description of the bug may have referenced a transient/reverted state of the file, or a different branch/commit. If AS-069 fails again in a future scrutiny pass, re-check `components/calendar/stacked-person-row.tsx` fresh from `git log -p -- components/calendar/stacked-person-row.tsx` to see if the capacity span was reintroduced and then reverted between scrutiny runs, or if scrutiny is looking at a stale checkout.
