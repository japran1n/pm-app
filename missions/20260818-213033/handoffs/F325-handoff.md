# Handoff: F325 — M16 scrutiny blockers, part 1: custom-status and board defects

## Status
COMPLETE

## Assertions covered
AS-404: PASS — renaming each of the four default seeded columns now succeeds through the real `updateColumn` action; verified by `test_AS_404_each_default_seeded_column_can_be_renamed_through_the_real_action` in `tests/integration/f325-status-rename-sync.test.ts`.
AS-411: PASS — renaming a column holding several tasks no longer strands them; `tasks.status`/`status_id` stay consistent with the new name and both the board's and the list filter's read shapes still return every task. Verified by `test_AS_411_renaming_a_column_with_several_tasks_keeps_every_task_visible_in_it_afterwards`.
AS-419: PASS — "No grouping" can be reselected; `BoardToolbar` now writes an explicit `groupBy=none` instead of deleting the param. Verified by `test_AS_419_selecting_No_grouping_writes_an_explicit_groupBy_none_param_not_an_absent_one` in `tests/unit/f325-board-toolbar-groupby-none.test.tsx`.

## Files changed
supabase/migrations/20260828030000_status_rename_sync_and_seed_colors.sql (new)
components/board/board-toolbar.tsx
tests/integration/f325-status-rename-sync.test.ts (new)
tests/unit/f325-board-toolbar-groupby-none.test.tsx (new)
tests/integration/f223-status-integration-list-search-dashboard.test.ts (updated one stale-behavior assertion, see Decisions)

## Commands run
`supabase db push` (0) — applied 20260828030000_status_rename_sync_and_seed_colors.sql to the linked project qcipqonnqajmazdbysow
`npx tsc --noEmit` (0) — clean, no output
`npx eslint .` (0) — 0 errors, 2 pre-existing warnings (`lib/queries/search.ts:280`, `tests/unit/invite-member-pagination.test.ts:186` — both pre-existing, not touched by this feature)
`npx vitest run tests/integration/f325-status-rename-sync.test.ts` (0) — 3/3 passed
`npx vitest run tests/unit/f325-board-toolbar-groupby-none.test.tsx` (0) — 1/1 passed
`npx vitest run tests/integration/f223-status-integration-list-search-dashboard.test.ts` (0) — 7/7 passed (updated for the fix, see Decisions)
`npx vitest run tests/integration/f219-status-management.test.ts tests/integration/f220-status-delete-reassign.test.ts tests/integration/f221-board-custom-columns.test.ts tests/integration/f222-status-category-semantics.test.ts` (0) — 4 files, 35 tests passed
`npx vitest run tests/integration/f224-board-swimlane-grouping.test.ts tests/integration/f225-swimlane-drag-reassign.test.ts tests/integration/f226-swimlane-collapse-persist.test.ts tests/unit/f224-board-swimlane-grouping.test.ts tests/unit/f225-swimlane-drag-reassign.test.ts tests/unit/f226-swimlane-collapse-persist.test.ts` (0) — 6 files, 47 tests passed
`npx vitest run --dir tests/unit` (0) — 127 files (126 passed, 1 known pre-existing failure `tests/unit/trash-list.test.tsx`), 991 tests (989 passed, 2 known pre-existing failures)

## Decisions made
- **Blocker A (AS-411) fix — DB trigger, not a status_id-only board refactor.** Added `project_statuses_sync_task_status_on_rename`, an `AFTER UPDATE OF name ON project_statuses` trigger (`sync_tasks_status_on_column_rename`) that propagates a column rename onto every task's `tasks.status` text (matched primarily by `status_id`, with a text-match fallback for any pre-backfill row). This is a single atomic DB-level fix that automatically covers ANY future rename path (the Server Action, the `reassign_and_delete_project_status` RPC's own writes, test fixtures, a future admin tool) without every caller needing to remember to propagate the rename — matching the spec's requirement that the fix hold for "ANY rename path." It reuses the existing `tasks_sync_status_and_status_id` trigger's own re-entry to keep `status_id` pinned to the same row at its new name; no separate `status_id` write is needed. I did not move the board's/list's grouping key onto `status_id` because that would touch `get_project_board_tasks`, `TaskCardTask`, the list query, and every filter surface across several other in-flight/future features — well outside this feature's `updateColumn`/board/list scope — for no additional correctness over the trigger.
- **Blocker B (AS-404) fix — align seed colours to `COLUMN_COLOR_PALETTE`, not widen the palette.** `COLUMN_COLOR_PALETTE` is the one place both the picker UI and the Zod/DB-side validation read the approved-colour set from, and F219's own migration comment says it deliberately reuses F087's contrast-vetted colours. Widening it to also include the old, never-vetted seed hexes would create a second, larger "approved" set with weaker guarantees. Instead: `seed_default_project_statuses` (CREATE OR REPLACE) now seeds `#64748b`/`#3b82f6`/`#d97706`/`#16a34a` (nearest palette colour to each original hue) for every NEW project, and a one-time UPDATE re-colours EXISTING rows only where a column's name AND colour still exactly match the original seed pair (i.e. never recoloured by a user) — preserving deliberate customisation while fixing the common case.
- **Blocker C (AS-419) fix — one-line, as the scrutiny report predicted.** `board-toolbar.tsx`'s `handleChange` now calls `params.set("groupBy", value)` unconditionally instead of branching on `value === "none"` to delete the param. Verified `components/board/board.tsx`'s resolution logic (lines ~669-675) was ALREADY correct (absent param → persisted preference; explicit `"none"` → none) before touching anything — the bug was entirely in the toolbar never producing the explicit param, confirming the report's read.
- Updated one assertion in the existing `tests/integration/f223-status-integration-list-search-dashboard.test.ts` (`test_AS_417_search_results_show_the_tasks_current_column_name_even_when_status_text_is_stale`) that hard-coded the OLD buggy behaviour (`expect(hit?.status).toBe("Backlog")` — the stale, pre-rename name) as expected. That exact "stale status text after rename" state is the bug this feature fixes; the task's raw `status` now correctly reads the renamed column's current name too. Left the test's AS-417 intent (statusName/statusColor resolve via the real join, not hand-built props) untouched — only updated the one now-incorrect expectation and added a comment explaining why.
- Did not touch `components/calendar/*`, any `project_statuses`/`saved_views` RLS policy, or role-based write authorization (B4/B5) — explicitly out of scope per the assignment (handled by a separate worker / follow-up features).

## Out-of-scope work needed
- **B4 (AS-414):** `project_statuses` INSERT/UPDATE/DELETE RLS policies gate on visibility only, not role — any active workspace member (including `viewer`) can mutate board columns directly via the browser client, bypassing `canManageColumns`. Needs a role-aware RLS predicate or routing all writes through a `SECURITY DEFINER` RPC, plus a negative test that attempts the mutation as a signed-in `viewer` through the direct RLS path (not the Server Action). Assigned to the sibling RLS-blockers worker per this feature's own scope note.
- **B5 (AS-434), calendar blockers B1 (AS-442/443/448):** explicitly excluded from this feature's scope; being handled separately.
- **M14** (`createTask`/`duplicateTask`/`restoreTask` still hard-code the original four statuses) is gated behind B3 for default columns (now fixed here) but remains reachable today for user-ADDED columns — a new task created via `createTask` in a project with only custom column names still writes `status='todo'`, which now (thanks to this feature's trigger having nothing to propagate, since no rename occurred) simply fails to match any real column and yields `status_id = NULL` via the existing `sync_task_status_and_status_id` trigger's lookup miss. This is a pre-existing gap this feature's trigger does not close (it only fires on `project_statuses` rename, not on task creation) — worth a dedicated follow-up feature that makes `createTask`/`duplicateTask`/`restoreTask` look up a real default column (`category='not_started'`, lowest position) instead of a hard-coded literal.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose a DB trigger over a two-statement Server Action or a status_id-based board/list refactor for blocker A, as detailed in "Decisions made" above — the spec explicitly forbade the two-statement approach and offered the trigger as an accepted option.
AUTONOMOUS_DECISION: Chose to align seed colours to the existing palette rather than widen the palette, to keep exactly one source of truth for approved colours, as detailed above.
AUTONOMOUS_DECISION: Updated one now-incorrect assertion in `f223-status-integration-list-search-dashboard.test.ts` that encoded the pre-fix buggy behaviour as expected, rather than leaving a regression-test failure in place — this is required maintenance of an existing test whose premise the fix changes, not new scope.

## Notes for the next worker
- No Supabase MCP tool calls were made (registry marks Supabase MCP "Optional"; the CLI's `supabase db push` confirmed the migration applied cleanly with a clean `NOTICE`-only output — the NOTICE was just "trigger ... does not exist, skipping" from the `drop trigger if exists` guard on first apply, expected and harmless).
- The new migration is `supabase/migrations/20260828030000_status_rename_sync_and_seed_colors.sql`, applied to the linked project `qcipqonnqajmazdbysow`.
- Verified the rename-sync trigger only fires on `UPDATE OF name` on `project_statuses` — never on row deletion or on the `projects → project_statuses` `ON DELETE CASCADE` path — so project hard-delete still works; covered by `test_project_hard_delete_still_works_after_seeding_default_columns` in the new integration test file.
- Did not regenerate `lib/supabase/database.types.ts` — this migration adds no new table/column/RPC signature, only a trigger function and a `CREATE OR REPLACE` of an existing `void`-returning function plus data UPDATEs, none of which change any generated type shape.
