# F127 — Fix AS-169: real directory read + SQL classifier for ordering rule

_Mission: 20260919-150607_ _Milestone: M9_ _Parent: F049_

## Problem

The current AS-169 test compares two hardcoded string literals (`"20261127130000" < "20261127140000"`) — it never reads the directory and cannot fail. It passes even if an ADD COLUMN migration is dated after a DROP COLUMN.

## Fix

In `tests/unit/m9-migration-headers.test.ts` (same file as F126):

1. After F126's discovery fix, classify each mission migration's SQL as:
   - **additive**: contains `ADD COLUMN`, `CREATE TABLE`, `CREATE INDEX`, `CREATE POLICY`
   - **destructive**: contains `DROP COLUMN`, `DROP TABLE`, `DROP INDEX`, `DROP POLICY`
   - **mixed**: both present

2. Assert: `max(timestamp of additive migrations) < min(timestamp of destructive migrations)`. If no additive migrations are found, skip the ordering assertion (all three mission migrations are destructive — that's fine, no ordering violation possible).

3. Add a self-check: if both additive AND destructive migrations are found, assert `additive.length > 0 && destructive.length > 0` — so the test fails loudly rather than passing vacuously on an empty set.

4. Verify by mutation test comment: add a test comment explaining that adding a synthetic `ADD COLUMN` migration dated after the drops must turn this red.

5. Run `npx vitest run tests/unit/m9-migration-headers.test.ts --reporter=verbose` — pass.
6. Run `npx tsc --noEmit` — exit 0.
7. Commit alongside F126 changes (same file) and note in handoff.

## Note on mission migrations

The 3 mission migrations are:
- `20261127120000_discipline_estimates_nullable_minutes.sql` (ALTER TABLE — additive/nullable change)
- `20261127130000_drop_page_components_description.sql` (DROP COLUMN — destructive)
- `20261127140000_drop_node_meta_client_visible.sql` (DROP COLUMN — destructive)

So max(additive) = 120000, min(destructive) = 130000 → 120000 < 130000 ✓

Write handoff to `missions/20260919-150607/handoffs/F127-handoff.md`.
