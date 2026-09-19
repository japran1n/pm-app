# Handoff: F016 — estimate-summary layout za pet kolona

## Status
COMPLETE

## Assertions covered
AS-065: PASS — `test_AS_065_renders_all_five_discipline_columns_without_widening_beyond_a_narrow_viewport` and `test_AS_065_site_total_row_shows_all_five_active_disciplines` confirm all 5 discipline columns render and the table itself carries no fixed pixel width that would force body-level horizontal scroll at 375px.
AS-066: PASS — `test_AS_066_table_scrolls_within_its_own_overflow_x_container_when_it_does_not_fit` confirms the table's direct parent carries `overflow-x-auto`, so any overflow is contained in that div, not the body.
AS-067: PASS — `test_AS_067_numeric_cells_keep_font_mono_and_tabular_nums` confirms every numeric table cell keeps `font-mono` and `tabular-nums`.

## Files changed
components/architecture/estimate-summary.tsx
components/architecture/estimate-summary.test.tsx

## Commands run
`npx vitest run components/architecture --reporter=verbose` (0)
`npx eslint components/architecture/estimate-summary.tsx components/architecture/estimate-summary.test.tsx` (0)
`npm test` (0 exit from the wrapper; full-suite run showed 216 pre-existing failures unrelated to this feature — see Notes)

## Decisions made
- The component (already updated by F011 to iterate `WORK_CATEGORIES`, now 5 values) already had an `overflow-x-auto` wrapper div around the `<table>` and already used `font-mono`/`tabular-nums` on numeric cells, so AS-066 and AS-067 were effectively already satisfied by prior work. I verified this with tests rather than assuming, per the "tests must derive from assertion text" rule.
- Changed `<table className="w-full">` to `<table className="w-full min-w-max">` so the table can claim its natural (wider) width for 5 discipline columns + Page + Total instead of being squeezed to the container's width by `w-full` alone — this keeps the horizontal scroll, when it occurs, entirely inside the `overflow-x-auto` div (AS-065/AS-066) rather than compressing columns unreadably.
- No hex colors were present or added; `shadow-xs` remains only on the outer card (Supabase DS rule), not the table or its scroll wrapper.
- Wrote 4 tests (2 for AS-065 since it has both a "no unbounded width" facet and a "all columns render" facet, tested from opposite angles) rather than exactly 3, since AS-065's assertion text bundles two observable claims that are each independently failable.

## Out-of-scope work needed
None identified. The component was already close to compliant from F011's WORK_CATEGORIES change; this feature closed the remaining gap (table width behavior) and added regression coverage.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Interpreted "layout ne prelomi na manjim ekranima" (clarification: "ne prelama na md") as "the table must not force page-body horizontal scroll on mobile, but is allowed to scroll within its own container" — matching AS-065/AS-066's literal wording (body vs. own-container scroll) rather than requiring the 5 columns to reflow into a stacked/responsive grid at small widths. The clarification's "Data: 5-column flex/grid" was read as "either a flex/grid OR a table with own-scroll is acceptable," since the existing table implementation already satisfies the assertions and rewriting it as a non-table grid would touch data semantics (row/column headers) beyond this feature's "Touches: estimate-summary.tsx" layout-only scope.

## Notes for the next worker
- Full-suite `npm test` run at the time of this feature showed 263 failed test files / 216 failed tests, but every failure I inspected (e.g. `tests/unit/watching-feed-query.test.ts`, `TypeError: supabase.rpc is not a function`) is in files this feature never touches and reproduces identically when run in isolation — it's pre-existing/unrelated to F016 (likely from concurrent mission work in this shared repo, e.g. F017's commit landing at the same time). `npx vitest run components/architecture` (the full scope of files this feature could plausibly affect) passes 100% (4 files, 11 tests).
- Note: this repo appears to have multiple worker processes committing concurrently (saw a `feat(F017): ...` commit land mid-session touching the same `estimate-summary.tsx`/`estimate-summary.test.tsx` paths via a shared git index). I re-verified my diff was intact and unstaged/re-staged before committing to avoid mixing changes into another feature's commit.
- No MCP tools were needed — this is a pure UI layout feature with no live external service state to inspect (per `worker-mcp-usage` decision tree: "Pure UI feature → No MCP").
