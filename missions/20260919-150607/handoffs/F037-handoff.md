# Handoff: F037 — check-value-ui-guard

## Status
COMPLETE

## Assertions covered
AS-126: PASS — tasks_page_kind_check DB values match pageKindEnum exactly
AS-127: PASS — pageKindEnum has no extra values beyond the DB CHECK constraint
AS-128: PASS — tasks_section_kind_check DB values match sectionKindEnum exactly
AS-129: PASS — sectionKindEnum has no extra values beyond the DB CHECK constraint

## Files changed
tests/unit/m6-check-value-guard.test.ts

## Commands run
`npx vitest run tests/unit/m6-check-value-guard.test.ts` (0) — 4 passed

## Decisions made
- Parsed migration files by filename lexical sort (timestamp-prefixed) to determine chronological order, then scanned for the LAST occurrence of `add constraint <name> check (...)` per constraint. This is more robust than just reading the single known-latest file, since it will correctly track any future migration that redefines these constraints.
- Anchored the regex to `add\s+constraint\s+<name>\b...\bin\s*\(...\)` rather than a bare `<name>\b...\bin\s*\(...\)`. The bare version incorrectly wandered past the `comment on constraint tasks_page_kind_check on public.tasks is ...` line (which also mentions the constraint name) into the *next* constraint's `in (...)` list, producing wrong values. Verified this failure mode with a debug script before fixing.
- Compare enum vs DB values as Sets (order-independent) via two directions (`toEqual` on Sets for exact match, plus a superset check per assertion) so AS-126/AS-128 cover exact equality and AS-127/AS-129 explicitly cover "no extra values in Zod not present in DB" per the spec's four assertion IDs.

## Out-of-scope work needed
None identified within F037's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Split the single "set equality" check into two assertions each (exact match test + explicit "no extra values" subset test) for both page_kind and section_kind, to map cleanly onto the four assigned assertion IDs (AS-126..AS-129) since the spec only described one conceptual check but assigned four IDs.

## Notes for the next worker
- The SQL parser lives entirely in the test file (`findLastCheckConstraintValues`, `extractStringLiterals`). If a future migration reformats these CHECK constraints (e.g. using a different clause order), re-verify the regex anchor `add\s+constraint\s+<name>\b[\s\S]*?\bin\s*\(...\)` still finds the correct list — a debug script pattern is included in this handoff's history (see commit for regex).
- Confirmed via `grep -rl` that only two migrations ever reference `tasks_page_kind_check` / `tasks_section_kind_check`: the original `20261121010000_f002_page_components.sql` and the superseding `20261124010000_architecture_cms_template_and_section_kind.sql`. The test picks the latter automatically since it sorts lexically.
