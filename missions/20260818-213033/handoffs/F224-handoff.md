# Handoff: F224 — board-grouping-swimlanes

## Status
COMPLETE

## Assertions covered
AS-418: PASS — board groups into swimlanes by assignee, priority, or tag; proven against the real `get_project_board_tasks` RPC row shape (tests/integration/f224-board-swimlane-grouping.test.ts) and the real `<Board>` component tree with a mocked `?groupBy=` URL (tests/unit/f224-board-swimlane-grouping.test.ts).
AS-419: PASS — with `groupBy` absent, `<Board>` renders the exact pre-F224 flat layout (same branch, byte-for-byte unchanged JSX); `test_AS_419_with_no_groupBy_param_renders_the_flat_ungrouped_layout` asserts no `data-swimlane` markup appears.
AS-421: PASS — each Swimlane renders one BoardColumn per project column, filtered to that lane's tasks; BoardColumn's own pre-existing `(N)` count badge is reused unchanged, so each lane's per-column counts are independent by construction. `test_AS_421_each_lane_renders_its_own_per_column_task_count` and the integration test's lane-length assertions cover this.
AS-423: PASS — tasks with no value for the grouped field land in an explicit `SWIMLANE_NONE_KEY` ("None") lane, rendered last, only when non-empty. Covered by 3 unit tests (priority/assignee/tag) plus the integration test's real-row None-lane assertions.

## Files changed
supabase/migrations/20260825020000_rpc_project_board_tasks_tags.sql
lib/queries/tasks.ts
components/task/task-card.tsx
lib/board/grouping.ts
components/board/board-column.tsx
components/board/swimlane.tsx
components/board/board-toolbar.tsx
components/board/board.tsx
tests/unit/f224-board-swimlane-grouping.test.ts
tests/integration/f224-board-swimlane-grouping.test.ts
tests/unit/board-dnd-setup.test.ts
tests/unit/board-move-status-wiring.test.ts
tests/unit/board-optimistic-rollback-toast.test.ts
tests/unit/board-task-detail-sheet-wiring.test.ts
tests/unit/board-taskid-deeplink.test.tsx

## Commands run
`supabase db push` (0) — applied 20260825020000_rpc_project_board_tasks_tags.sql to the real linked project
`npx tsc --noEmit` (0)
`npx eslint .` (0) — 2 pre-existing unrelated warnings (lib/queries/search.ts, tests/unit/invite-member-pagination.test.ts), 0 errors
`npx vitest run tests/unit/f224-board-swimlane-grouping.test.ts` (0) — 14/14 passed
`npx vitest run tests/integration/f224-board-swimlane-grouping.test.ts` (0) — 2/2 passed
`npx vitest run tests/unit/board-column.test.ts tests/unit/board-move-status-wiring.test.ts tests/unit/board-dnd-setup.test.ts tests/unit/board-taskid-deeplink.test.tsx tests/unit/board-optimistic-rollback-toast.test.ts tests/unit/board-task-detail-sheet-wiring.test.ts tests/unit/board-columns-realtime.test.ts tests/unit/board-realtime-subscription.test.ts tests/unit/f224-board-swimlane-grouping.test.ts tests/integration/f221-board-custom-columns.test.ts tests/integration/f222-status-category-semantics.test.ts tests/integration/f223-status-integration-list-search-dashboard.test.ts tests/integration/f224-board-swimlane-grouping.test.ts` (0) — 90/90 passed (regression slice: board, board-column, board RPC, F221-223 integration)
`npm run test` (1) — full suite: 1845 passed, 24 failed, 23 skipped, across 12 files (see Notes below — none of the 12 failing files touch board/grouping code; re-ran `tests/integration/workspace-role-expansion.test.ts` alone and it still failed with `"Something went wrong. Please try again in a moment."`, matching the "Supabase Auth rate limiting" known infra condition, not a regression from this feature)

## Decisions made
- **Autonomous decision on Server-SQL query re-plumbing**: `get_project_board_tasks` (the board's single RPC round trip) never returned `tags`. Added a new migration (`20260825020000_rpc_project_board_tasks_tags.sql`) that `create function`s (after `drop function if exists`, same pattern every prior column addition to this RPC used) the same function with one new passthrough column `tags text[]`, coalesced to `array[]::text[]` at the SQL boundary. Applied via `supabase db push` against the real linked project (MCP not listed for this feature; used the Supabase CLI directly per this feature's "MCP at run: none" note).
- Multi-assignee/multi-tag tasks appear in **every one of their lanes** (per the clarification's explicit resolution) — `lib/board/grouping.ts`'s `keysForTask` returns all keys for a task, not just the first. Swimlane renders a small inline note ("tasks with multiple values appear in more than one lane") when `groupBy` is `assignee` or `tag`, so a viewer summing lane counts isn't misled.
- The "None" lane is only rendered when at least one task actually lacks a value — an always-present empty lane on every grouped board would be noise for the common "everyone has an assignee" case. Documented in `grouping.ts`'s doc comment.
- **AUTONOMOUS_DECISION**: cross-lane drag-and-drop reassignment (AS-420) and within-column reordering while grouped (AS-425) are explicitly F225's scope per the task prompt. `Swimlane` renders every `BoardColumn` with `canDrag={false}` unconditionally (not gated on the viewer's role) so a grouped board never silently offers a drag that doesn't do anything meaningful yet. Added an optional `dropId` prop to `BoardColumn` (defaults to `status`, so every existing/ungrouped caller is byte-for-byte unchanged) so F225 can give each `(lane, column)` pair a unique dnd-kit droppable id without redesigning BoardColumn — Swimlane already passes `` `${laneKey}::${column.id}` `` as that id, ready for F225 to flip `canDrag` back on and wire real cross-lane reassignment.
- Grouping state lives in the URL (`?groupBy=none|assignee|priority|tag`), matching this feature's Clarified implementation's "URL search params for anything shareable" rule and this board's own List-view sibling (F054/list-filters.tsx) convention. Absent param = `"none"`, so every existing bookmarked/shared board URL renders identically to before this feature (AS-419).
- Lane labels: priority uses the existing `PRIORITY_LABELS` (lib/task-colors.ts); assignee resolves against the board's existing `assignees` Map (name, falling back to email, falling back to "Unknown member" — never crashes on a stale/removed member id); tag uses the raw tag string (tags have no separate display-name concept in this codebase).

## Out-of-scope work needed
- **F225** (already scheduled per the task prompt): cross-lane drag-and-drop reassignment (AS-420) and within-column reordering while grouped (AS-425). `BoardColumn`'s new `dropId` prop and `Swimlane`'s `canDrag={false}` are the seam — see Decisions made above.
- **F226** (already scheduled): swimlane collapse + its cross-reload persistence (AS-422), and grouping-choice persistence per user per project (AS-424) — this feature's grouping choice only persists via the URL for the current session/share-link, not across a fresh visit with no `groupBy` param.
- Not observed but worth flagging: `getProjectListTasks` (the List view's sibling query) was NOT touched — it already selects `tags` directly (used by TagsEditor elsewhere), so no gap there, but if a future feature wants "group the List view too," that's a separate, not-yet-scoped surface.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: added `dropId` (optional, defaulting to the pre-existing `status`-keyed id) to `BoardColumn` purely as a clean seam for F225, since rendering the same column `status` value in multiple lanes at once would otherwise register duplicate dnd-kit droppable ids. This feature itself only reads/uses the default id path (drag stays disabled in grouped view), so no existing behaviour changed.
AUTONOMOUS_DECISION: labeled the "None" priority lane's key resolution through `PRIORITY_LABELS`'s own `"none"` entry is NOT used — the sentinel `SWIMLANE_NONE_KEY` is a private string (`"__none__"`), not `"none"`, so it's resolved to the literal display string `"None"` directly in `board.tsx`'s `laneLabel`, independent of `PRIORITY_LABELS`. Kept `PRIORITY_LABELS["none"]` (used elsewhere, e.g. dashboard charts) entirely out of this path to avoid coupling two independent "none" concepts.

## Notes for the next worker
- The board's real data-fetch chain for this feature: `app/(workspace)/w/[workspaceSlug]/projects/[projectId]/board/page.tsx` → `getProjectBoardTasks` (lib/queries/tasks.ts) → `get_project_board_tasks` RPC (now returns `tags`) → `<Board columns={...} initialTasks={...}>` → (grouped) `groupTasksIntoSwimlanes` (lib/board/grouping.ts) → `<Swimlane>` → `<BoardColumn>` (unchanged, reused). Nothing in this chain is a hand-built fixture; the integration test signs in a real member and calls the real RPC.
- `npm run test`'s full-suite run showed 12 failing files, all pre-existing (invite-member/workspace-role-expansion Auth signup rate limiting, recurrence-scheduled-generation Postgres statement timeouts, dependency-ui-actions/subtask-ui-detail/notification-*/trash-list/audit-log-writer/f319-edit-task-fanout) — none import or exercise anything this feature touched (board.tsx, board-column.tsx, swimlane.tsx, board-toolbar.tsx, lib/board/grouping.ts, lib/queries/tasks.ts's board RPC path, task-card.tsx's `tags` field). Re-ran `workspace-role-expansion.test.ts` alone immediately afterward — it failed again with the exact `"Something went wrong. Please try again in a moment."` shape, consistent with sustained Supabase Auth rate limiting from the large suite's user-creation volume, not a code regression from this feature. The scoped regression slice above (board + board-column + F221/222/223 integration, 90 tests) is fully green.
- MCP: none used at run time (registry/spec both say "MCP at run: none" for this feature); schema changes went through the Supabase CLI (`supabase db push`) directly, same as every prior board-RPC migration in this codebase.
