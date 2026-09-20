# F047 clarification

## Q1: Should we also check other files beyond the four named?
A: Yes. Do a comprehensive grep for `task_id` and `taskId` across all non-node_modules files. Remove every reference to this dropped column.

## Q2: Are there any code paths we should NOT remove?
A: None. The column was dropped by product decision. There are no callers we should keep.

## Q3: What about tests that reference task_id?
A: Fix them too. `tests/integration/calendar-blocks-crud.test.ts` at line ~225 still selects task_id. Remove it from the test.

## Q4: After removing, what is the "definition of done"?
A: `grep -r "task_id\|taskId" --include="*.ts" --include="*.tsx" lib/ app/ components/ tests/` returns ZERO matches (excluding any string "task_id" that appears in migration SQL files, which are intentional history).

## ★ Default resolution
Remove all task_id/taskId references from: lib/queries/calendar-blocks.ts, lib/actions/calendar-blocks.ts, lib/validation/calendar-blocks.ts, tests/integration/calendar-blocks-crud.test.ts. Run tsc and eslint to confirm clean. Commit.
