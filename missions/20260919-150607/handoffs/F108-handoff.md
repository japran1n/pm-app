# Handoff: F108 — Fix AS-127/129: harden CHECK constraint parser

## Status
COMPLETE

## Assertions covered
AS-127: PASS — `it('AS-127: parser throws on unknown constraint name (proves filesystem read)')` verified independently (asserts a throw, not a subset relationship implied by the Set-equality tests)
AS-128: PASS — `it('AS-128: pageKindEnum matches tasks_page_kind_check')`
AS-129: PASS — `it('AS-129: sectionKindEnum matches tasks_section_kind_check')`

## Files changed
tests/unit/m6-check-value-guard.test.ts

## Commands run
`npx vitest run tests/unit/m6-check-value-guard.test.ts --reporter=verbose` (0) — 3/3 passed:
```
 ✓ tests/unit/m6-check-value-guard.test.ts > m6 CHECK constraint vs Zod enum drift guard > AS-127: parser throws on unknown constraint name (proves filesystem read) 10ms
 ✓ tests/unit/m6-check-value-guard.test.ts > m6 CHECK constraint vs Zod enum drift guard > AS-128: pageKindEnum matches tasks_page_kind_check 8ms
 ✓ tests/unit/m6-check-value-guard.test.ts > m6 CHECK constraint vs Zod enum drift guard > AS-129: sectionKindEnum matches tasks_section_kind_check 7ms

 Test Files  1 passed (1)
      Tests  3 passed (3)
```
`npx vitest run` (full suite, 0 exit code, background) — 4513 passed / 206 failed / 1696 skipped across 856 test files. All 206 failures are in unrelated files (e.g. `tests/unit/watching-feed-query.test.ts` failing on `supabase.rpc is not a function`, a pre-existing mock-setup issue unrelated to this feature). `m6-check-value-guard.test.ts` does not appear anywhere in the failure list — confirmed via `grep -n "m6-check-value-guard" <full-run-output>` returning no matches.

## Decisions made
- Rewrote `findLastCheckConstraintValues` exactly per the spec's provided implementation: paren-balanced extraction of the CHECK expression body (anchored to `constraint <name> check (`), instead of the old lazy `[\s\S]*?` regex that could cross semicolons/statement boundaries.
- Added support for the `= any (array[...])` rendering in addition to `in (...)`, since Postgres may normalize CHECK expressions to either form.
- Track `drop constraint <name>` occurrences; if the constraint's last relevant statement across all migrations is a drop with no subsequent re-add, throw rather than silently returning a stale/prior definition.
- Deleted the two vacuous AS-127/AS-129-labeled `it()` blocks that only checked one-directional subset relationships already implied by the Set-equality assertions in the AS-126/AS-128 tests.
- Renamed the page_kind equality test to AS-128 and the section_kind equality test to AS-129, and removed the old standalone "AS-126" test (per this feature's assigned assertion IDs of AS-127, AS-128, AS-129 only — AS-126 is not in this feature's scope, so its coverage now lives inside the AS-128 test body, matching what the spec's "Assertion IDs" line explicitly lists).
- Added a new, independent AS-127 test (`findLastCheckConstraintValues('tasks_nonexistent_xyz_check')` must throw) that exercises the parser's failure path rather than duplicating the Set-equality logic.
- Added `onlyInDb` / `onlyInZod` diff arrays to failure messages on both remaining equality tests for easier debugging.
- Inspected `tests/unit/m6-action-barrel-guard.test.ts` for the described unreachable `precedingText` skip at lines ~34-37; the file's current state does not contain a matching unreachable-skip block at that location (only a `precedingText`/`type` lookback check at line 57-58, which is reachable and functioning). Per the spec's explicit instruction to not otherwise touch that file (F107's scope), left it unmodified.

## Out-of-scope work needed
- Pre-existing, unrelated test failures across 206 tests / 263 files were observed on the full suite run (e.g. `tests/unit/watching-feed-query.test.ts` — `supabase.rpc is not a function`, indicating an incomplete Supabase client mock for RPC calls). These predate this feature and are outside F108's scope; a separate feature should address the Supabase mock/test-harness gap.
- The `m6-action-barrel-guard.test.ts` "unreachable precedingText skip at line ~34-37" mentioned in this spec was not found in the file's current state — worth confirming with F107's worker/handoff whether that cleanup was already applied elsewhere, since this spec still references stale line numbers.

## Blockers
(none — status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Treated "AS-126" as out of this feature's assigned scope per the explicit "Assertion IDs: AS-127, AS-128, AS-129" line, and folded its equality check into the renamed AS-128 test body rather than keeping a separate AS-126 `it()` block, since the spec's rewrite instructions ("rename the page_kind equality test to AS-128") imply the prior AS-126-labeled block becomes AS-128, not that both should coexist.

## Notes for the next worker
- The parser now lives entirely in `tests/unit/m6-check-value-guard.test.ts` (test-only helper, not exported/shared code) — no production code was touched, consistent with this being a test-hardening fix.
- No MCP tools were needed; this feature only concerns local test/parser logic against migration files already in the repo (`supabase/migrations/`).
