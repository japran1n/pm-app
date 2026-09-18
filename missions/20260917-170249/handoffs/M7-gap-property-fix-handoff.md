# Handoff: M7-gap-property-fix — grid-row-gap/grid-column-gap Webflow paste crash fix

## Status
COMPLETE

## Assertions covered
No assertion IDs were assigned to this task (it is a targeted bugfix, not a
new feature spec with a validation-contract assignment). The pre-existing
AS-058 and AS-069 tests in `longhand.test.ts` that cover the `gap`/`grid-gap`
shorthand were updated to assert the corrected output and re-verified:
AS-058: PASS — `gap`/`grid-gap` now expand to `grid-row-gap` + `grid-column-gap`
AS-069: PASS — dispatch/vocabulary tests updated and passing

## Files changed
lib/webflow-converter/longhand.ts
lib/webflow-converter/longhand.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0)
`npx vitest run lib/webflow-converter/` (0, 417 passed / 10 files)

## Decisions made
- Renamed the `gap`/`grid-gap` shorthand expansion output keys from
  `row-gap`/`column-gap` to `grid-row-gap`/`grid-column-gap`, since Webflow's
  clipboard style engine (`buildStyleBlock`) only has a style-type entry for
  the pre-standardization Grid property names, not the modern CSS3 longhands.
  Emitting `row-gap`/`column-gap` verbatim crashed the Designer on paste with
  "Invalid style type: undefined at buildStyleBlock" — the same failure mode
  already fixed for `grid-template-columns/rows/areas` and
  `text-decoration-line/-color/-thickness/-style`.
- Added explicit `case 'row-gap':` and `case 'column-gap':` switch arms in
  `expandDeclaration` so that CSS source that already uses the modern
  longhand property names directly (not via the `gap` shorthand) is also
  renamed to `grid-row-gap`/`grid-column-gap` before reaching `styleLess`.
  Previously these fell through to the `default` branch's pass-through path
  (since `row-gap`/`column-gap` are not shorthands per
  `css-shorthand-properties` and not in `PASS_THROUGH`), so they were emitted
  verbatim under the unsupported modern name.
- Updated the two existing test assertions (`AS-058` describe block and the
  `AS-069` dispatch/grid-gap tests) that hardcoded the old `row-gap`/
  `column-gap` decl keys, since they now assert implementation behaviour
  that changed intentionally. No new assertion IDs exist for this fix per
  the task description, so no new `test_AS_NNN_*` names were introduced —
  only the two pre-existing describe blocks were corrected in place.
- Did not touch `EXTRA_SHORTHANDS`, `PASS_THROUGH`, or
  `UNSUPPORTED_GRID_LONGHANDS` — out of scope per the task's explicit list of
  "already done" items (grid-template-*, text-decoration-*).

## Out-of-scope work needed
The task asked me to check for "any other CSS properties currently reaching
`styleLess` that Webflow might not support." I did a targeted review of
`PASS_THROUGH` and the `default` branch fallthrough in `expandDeclaration`
but did not do an exhaustive audit against Webflow's full style vocabulary
(no MCP tool or public API for that exists in this mission's registry — the
task gave a known-issues list and I fixed exactly what was named). Properties
like `aspect-ratio`, `mix-blend-mode`, `object-fit`, `backdrop-filter`, etc.
currently fall through to the generic "pass unknown longhand verbatim"
branch and were not verified against Webflow's actual clipboard vocabulary.
If a future crash report names a specific property, a follow-up feature
should add it to `PASS_THROUGH` (if supported) or `UNSUPPORTED_GRID_LONGHANDS`-
style explicit drop (if not), following the same pattern used here and for
the prior grid-template/text-decoration fixes.

## Blockers
(none — status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Also added explicit `row-gap`/`column-gap` longhand
handling (not just the `gap`/`grid-gap` shorthand expansion), since CSS
authored directly with `row-gap: 10px` (no shorthand) would otherwise still
reach `styleLess` under the unsupported modern name and crash the paste,
which is the same failure class the task described. This was a natural
extension of "row-gap → rename to grid-row-gap in styleLess" from the task
description, read literally as covering both the shorthand-expansion output
and any direct longhand usage.

## Notes for the next worker
- The crash signature "Invalid style type: undefined at buildStyleBlock" has
  now been fixed for three property families: `grid-template-columns/rows/
  areas`, `text-decoration-line/-color/-thickness/-style`, and `gap`/
  `row-gap`/`column-gap`. All three are documented inline in
  `lib/webflow-converter/longhand.ts` near their respective `case` blocks —
  read those comments before touching `expandDeclaration` again.
- No MCP tools were used for this fix — it is pure application logic with no
  external service dependency (per `worker-mcp-usage` skill decision tree:
  "Pure UI feature / logic → No MCP unless spec requires live CMS/data
  fetch").
- Full test suite (`npx vitest run lib/webflow-converter/`) is 417 tests
  across 10 files, all passing after this change.
