# Handoff: F049 — fix toUtcMs ±HH:MM offset regex

## Status
COMPLETE

## Assertions covered
AS-022: PASS — `clipBlockToStackedWindow` now correctly clips PostgREST-format blocks with colon-delimited offsets (`+00:00`, `+02:00`, `-05:00`), lowercase `z`/`t`, and microsecond precision. Verified via new tests in `tests/unit/planner-stacked-window.test.ts` (all passing) plus the pre-existing AS-022 boundary-clipping tests.

## Files changed
lib/calendar/stacked-window.ts
tests/unit/planner-stacked-window.test.ts

## Commands run
`npx vitest run tests/unit/planner-stacked-window.test.ts` (0, 22 passed)
`npx tsc --noEmit` (0)
`npx eslint lib/calendar/stacked-window.ts tests/unit/planner-stacked-window.test.ts --max-warnings=0` (0)
`git commit` (0)

## Decisions made
- Deviated from the literal try-parse snippet given in the clarification file (`new Date(withT).getTime()`, only appending `Z` on `NaN`). Empirically verified (Node, both system TZ and `TZ=America/Los_Angeles`) that this snippet parses offset-less strings like `"2026-09-21T09:00:00"` successfully as **local time**, not UTC, so it is non-NaN and the `Z` fallback never triggers. That silently breaks the two pre-existing "offset-less/space-separated treated as UTC" tests and the TZ-invariance suite under `America/Los_Angeles` — reproduced this failure with the literal snippet before replacing it (3 test failures).
- Implemented instead: normalise separator, then only skip appending `Z` when the string already ends with an explicit UTC/offset marker, matched by `/(?:Z|[+-]\d{2}:?\d{2})$/i` (covers `Z`, `z`, `+00:00`, `+02:00`, `-05:00`, `+0000`, with or without preceding microseconds). This achieves the same goal as the clarification (parse all PostgREST offset forms correctly) while keeping the offset-less/space-separated-as-UTC contract that the existing 17 tests and the TZ-invariance suite require. Confirmed all 22 tests (17 existing + 5 new) plus tsc/eslint pass.
- This is a substantive but narrow deviation from the clarified code — not from the clarified *intent* (fix the offset regex bug) or from the required test fixtures, which are used verbatim from the spec.

## Out-of-scope work needed
None identified within this feature's boundary.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used a corrected explicit-offset regex instead of the clarification's literal try-parse-then-fallback-to-Z snippet, because the literal snippet demonstrably breaks the "offset-less/space-separated string treated as UTC" tests (verified locally: `new Date("2026-09-21T09:00:00").getTime()` is non-NaN and TZ-dependent in Node). The chosen implementation satisfies the same underlying requirement (all `Z`, lowercase `z`/`t`, and `±HH:MM`/`±HHMM` offset forms parse correctly, including with microseconds) without regressing the pre-existing UTC-default behaviour for offset-less/space-separated timestamps, which is required by "keep all existing 17 tests passing."

## Notes for the next worker
- Reproduction of the literal-snippet failure: run `TZ=America/Los_Angeles node -e 'console.log(new Date("2026-09-21T09:00:00").toISOString())'` — returns `2026-09-21T16:00:00.000Z`, not `2026-09-21T09:00:00.000Z`, confirming local-time parsing rather than UTC.
- Mutation-check note requested by clarification: if `clipBlockToStackedWindow` were stubbed to always return `[]`, every new AS-022 offset test (`toEqual` with a non-empty array, plus the `result.length` / indexed assertions in the microsecond test) would fail — see comment block above the new `describe("toUtcMs offset handling...")` suite.
- No MCP tools used (pure unit-level bug fix, no external service state involved).
