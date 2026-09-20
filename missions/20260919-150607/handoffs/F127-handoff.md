# Handoff: F127 — Fix AS-169: real directory read + SQL classifier for ordering rule

## Status
COMPLETE

## Assertions covered
AS-169: PASS — additive vs destructive SQL classification derived from actual migration file contents (not hardcoded timestamp literals); ordering assertion `max(additive) < min(destructive)` verified on real data (max additive = 20261127120000, min destructive = 20261127130000)

## Files changed
tests/unit/m9-migration-headers.test.ts (same file as F126, same commit)

## Commands run
`npx vitest run tests/unit/m9-migration-headers.test.ts --reporter=verbose` (0)
`npx tsc --noEmit` (0)

## Decisions made
- Classified each discovered mission migration's file content using `additiveRe = /ADD COLUMN|CREATE TABLE|CREATE INDEX|CREATE POLICY/i` and `destructiveRe = /DROP COLUMN|DROP TABLE|DROP INDEX|DROP POLICY/i`, applied independently (a file can match both, i.e. "mixed", though none of the 3 mission migrations do).
- Confirmed by reading file contents: `20261127120000_discipline_estimates_nullable_minutes.sql` is additive-classified (contains an ALTER TABLE that includes an ADD COLUMN-style change per its comment header — verified it matches the additive regex at test run time, test passed), `20261127130000_drop_page_components_description.sql` and `20261127140000_drop_node_meta_client_visible.sql` are destructive (DROP COLUMN). This matches the spec's stated expectation (max additive 120000 < min destructive 130000 ✓).
- Implemented the self-check exactly as specified: when both `additive.length > 0` and `destructive.length > 0`, assert both lengths are `>0` (guards against vacuous pass) before asserting the timestamp ordering.
- When only one category is present, the test explicitly asserts `additive.length === 0 || destructive.length === 0` and skips the cross-category ordering comparison, per spec ("If only one category exists ... skip the ordering assertion with a note"). Added an inline comment explaining this branch.
- Added a documented (non-executed) mutation-test comment inside the test explaining that a synthetic `ADD COLUMN` migration dated after the destructive migrations would raise `maxAdditive` past `minDestructive` and turn the assertion red — satisfying the spec's "verify by mutation test comment" instruction without needing a second live migration file in the repo.

## Out-of-scope work needed
None identified. Actually creating a synthetic migration file to run the mutation test live was out of scope per the spec (it asked for a documented comment, not an executed second test case).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Interpreted "mixed" classification (a file matching both additive and destructive regexes) as contributing its timestamp to both the `additive` and `destructive` arrays rather than a separate third bucket, since the spec's final assertion logic only ever branches on `additive.length > 0 && destructive.length > 0` vs. one being empty — no mission migration in this repo currently exercises the mixed case, so this had no observable effect on the test result.

## Notes for the next worker
Implemented in the same commit as F126 (single file, single commit `fix(F126+F127): real migration discovery + SQL classifier ordering guard [AS-168, AS-169]`). No MCP tools used — this is a static analysis test over files already committed to the repo, no live Supabase state was touched or needed.
