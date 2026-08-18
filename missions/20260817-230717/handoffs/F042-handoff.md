# Handoff: F042 — board columns render

## Status
COMPLETE

## Assertions covered
AS-067: PASS — `tests/unit/board-column.test.ts::test_AS_067_renders_the_4_fixed_columns_in_the_correct_left_to_right_order` and the real page (`app/(workspace)/.../board/page.tsx`) maps `FIXED_COLUMN_ORDER = ["todo", "in_progress", "in_review", "done"]` to 4 `BoardColumn`s in that literal array order.
AS-068: PASS — `tests/integration/board-columns-render.test.ts` (`getProjectBoardTasks`, project-scoped + status-correct, cross-project isolation) and `tests/unit/board-column.test.ts::test_AS_068_a_column_only_renders_tasks_matching_its_own_status`.
AS-064 (deferred from F040/M4, closed here): PASS — `tests/unit/board-column.test.ts::test_AS_064_an_overdue_task_placed_on_a_real_board_column_renders_the_overdue_treatment` proves the overdue treatment (destructive-colored due date + `TriangleAlert`, from F040's `TaskCard`/`isOverdue`) survives being composed into a real `BoardColumn`, not just rendered in isolation.

## Files changed
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/board/page.tsx
components/board/board-column.tsx (new)
lib/queries/tasks.ts (new)
tests/unit/board-column.test.ts (new)
tests/integration/board-columns-render.test.ts (new)

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0)
`npx vitest run tests/unit/board-column.test.ts tests/integration/board-columns-render.test.ts` (0, 6/6 passed)
`npm test` (full suite: 204 passed, 5 skipped, 1 pre-existing unrelated failure — see Notes)
`npm run build` (0)

## Decisions made
- New `lib/queries/tasks.ts::getProjectBoardTasks(projectId)` uses the normal RLS-backed client (`@/lib/supabase/server`), not the admin client — unlike `getProjectById` (F030), the board has no "must work for archived projects" requirement, so there's no reason to bypass RLS here. `tasks_select_active_members` already scopes to non-deleted tasks in projects the caller's workspace membership covers; an explicit `.is("deleted_at", null)` is kept anyway per the repo's stated soft-delete convention (defense in depth, matches `getWorkspaceProjects`'s own rationale).
- Ordering: the query does `.order("position", { ascending: true })` once across all statuses, then the page buckets by status client-side (`tasks.filter(...)` per column) — simpler than 4 separate queries and still yields each column in position order since the filter preserves the source array's order.
- Whole-board empty state vs per-column empty state: composed `BoardEmptyState` (F032) at the page level only when the *entire* board has zero tasks (matches F032's own comment about how F042 should reuse it). Added a separate, much lighter inline "No tasks" message inside `BoardColumn` for the case where some columns have tasks and others don't — the spec's "no tasks" empty state is for the whole board, but a silently-blank column would still look broken, so this fills that gap without overloading `BoardEmptyState`'s heavier "create your first task" messaging into a still-nonempty board.
- `BoardColumn` is a plain Server Component (no `"use client"`) — this feature is explicitly render-only (no DnD, no click-to-open wiring), so there is no interactive part yet, consistent with the clarified spec's "thin Client Component only for the interactive part."
- Left click-to-open-detail-sheet wiring undone (spec: "nice to have if trivial, not required") — `TaskCard`'s `onClick` prop is simply left unset in `BoardColumn`. Trivial to wire once a detail-sheet feature exists; skipped now to avoid inventing behavior FN042 wasn't scoped for.

## Out-of-scope work needed
- Drag-and-drop (status change + in-column reorder, AS-069/AS-070/AS-071) is explicitly F043+, not attempted here.
- Click-to-open-detail-sheet wiring (`TaskCard`'s `onClick`) is left unwired — no detail-sheet feature/component exists yet to wire it to.
- `BoardColumn`'s per-column "No tasks" empty state is a new, minimal piece of UI not covered by any existing assertion I could find (AS-041 covers only the whole-board case) — flagging in case a later feature wants a named assertion for it, but not blocking.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Added a lightweight per-column empty state ("No tasks") for columns with zero tasks when the board as a whole is non-empty, since the spec only described the whole-board empty state (F032/BoardEmptyState) and a blank column region would otherwise look like a rendering bug rather than an intentional empty column.
AUTONOMOUS_DECISION: `getProjectBoardTasks` selects `id, title, status, priority, assignee_id, due_date, position` only (not every task column) — matches exactly what `TaskCardTask` (F040) needs, keeping the query minimal; `position` is fetched only to drive the `.order()` and isn't otherwise exposed to the component tree yet (F043+ will need it for drag state).

## Notes for the next worker
- Full suite run (`npm test`) has one pre-existing failure unrelated to this feature: `tests/integration/delete-task.test.ts` fails with `Failed to create test workspace: JWT issued at future` — a Supabase JWT clock-skew issue (likely the sandbox clock vs. the Supabase project's token `iat` validation), reproducible on a clean checkout before any F042 changes. Not caused by, and not fixed by, this feature. Confirmed via `npx vitest run` on just the two new F042 test files (6/6 pass) and via `git status --short` showing only F042's own files touched.
- `TaskCardTask["status"]` (F040) is the single source of truth for the 4 fixed status literals; `BoardColumn`'s `COLUMN_LABELS` and the page's `FIXED_COLUMN_ORDER` both key off that same type so a status value can't silently drift out of sync between the type and the rendered labels/order.
- MCP at run: none used (no live Supabase MCP tool needed — tests hit the Supabase project directly via `@supabase/supabase-js` with credentials from `.env`, per the established integration-test pattern in this repo).
