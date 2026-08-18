# Handoff: F053 — list view table

## Status
COMPLETE

## Assertions covered
AS-085: PASS — `tests/integration/list-view-render.test.ts` ("returns every non-deleted task for this project with title, status, priority, assignee, due date" + isolation test) exercises `getProjectListTasks` against the real linked Supabase project; both tests pass.

## Files changed
lib/queries/tasks.ts
lib/queries/assignee-names.ts
components/task/task-list-table.tsx
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/list/page.tsx
tests/integration/list-view-render.test.ts
missions/20260817-230717/handoffs/F053-handoff.md

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0)
`npx vitest run` (0 — 288 passed / 5 skipped across 51 files; 1 file, `tests/integration/edit-task.test.ts`, failed only in the full parallel run with "JWT issued at future", a clock-skew flake unrelated to this feature — re-ran standalone immediately after and it passed 5/5 cleanly, confirming pre-existing flakiness, not a regression from this change)
`npx vitest run tests/integration/list-view-render.test.ts` (0 — 3/3 passed)
`npm run build` (0 — `next build` succeeds, `/w/[workspaceSlug]/projects/[projectId]/list` route compiles)

## Decisions made
- Added `getProjectListTasks` to `lib/queries/tasks.ts` alongside the existing `getProjectBoardTasks` rather than reusing the board query, per the task instructions ("this may want a flatter list"). Same RLS-backed, `deleted_at is null`, `project_id`-scoped shape as the board query, but ordered by `created_at` ascending instead of `position` — the board's fractional `position` has no meaning for a flat table with no board-style reordering (AS-091's due-date sort is a separate assertion/feature layered on top later, not this one's job).
- Added `resolveAssigneeNames` (`lib/queries/assignee-names.ts`) to fulfil the "assignee (name if available)" part of the task instructions. There is no `public.profiles` table in this schema (same finding `getWorkspaceMembers`, `lib/queries/members.ts`, already documented), so this resolves display names via the Auth Admin API (secret-key admin client, server-only, AS-140), batched to one call per *unique* assignee id present in the fetched task list rather than one call per row. Falls back to the user's email when `user_metadata.full_name` is absent (mirrors `getWorkspaceMembers`'s own fallback pattern), and to "Unassigned" text in the table when a task has no assignee.
- Built `TaskListTable` as a plain Server Component (no `"use client"`) since AS-085 itself needs no interactivity (filters/sort/inline-edit are AS-086..093, separate assertions not assigned to this feature) — keeps the clarified spec's "Server Component for data-fetching" and AS-155 (server-rendered primary content) satisfied without introducing an unnecessary client boundary.
- Status and priority are rendered as `Badge` + text label (via `STATUS_LABELS`/`PRIORITY_LABELS`, mirroring `BoardColumn`'s `COLUMN_LABELS` and `TaskCard`'s `PRIORITY_LABELS`) rather than color-only, keeping consistency with AS-153 even though AS-153 isn't this feature's assigned assertion.
- Empty-project state: a lightweight inline "No tasks yet in this project." message inside `TaskListTable` rather than reusing `BoardEmptyState` (which is board-specific, with a disabled "Create task" CTA tied to the board's copy) — kept minimal since no clarified-spec answer or assertion calls for a list-specific CTA.

## Out-of-scope work needed
- AS-086/087/088 (status/priority/assignee filters), AS-089 (combined AND filters), AS-090 (clear filters), AS-091 (due-date sort), AS-092 (empty-filtered-result state), AS-093 (inline status edit from the list, reflected on board without reload) are all separate assertions in the same "List / table view" block, not covered by F053's assigned AS-085. `TaskListTable` currently takes a plain `tasks` array with no filter/sort props — a future feature adding filters will need to either lift filtering into a thin Client Component wrapper or add server-side query params, and inline status edit will need a small Client Component boundary around the status cell wired to the existing `moveTaskStatus`-style Server Action used by the board.
- `resolveAssigneeNames` has the same known N-unique-assignee-Admin-API-calls-per-render limitation already documented in `getWorkspaceMembers` — acceptable at this milestone's scale; a future `public.profiles` table (trigger-populated from `auth.users`) would remove the dependency on the Admin API for this common a read, for both this and the members page.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Ordered `getProjectListTasks` by `created_at` ascending (oldest first). The clarified spec and validation contract don't specify a default list-view order (AS-091 only requires a due-date sort *option*, not a default), so I chose the most predictable/stable default available on the `tasks` table, consistent with how `getWorkspaceMembers` orders by `created_at` ascending for the same reason.
AUTONOMOUS_DECISION: Resolved assignee *names* (with email fallback) rather than shipping only `assignee_id`, since the task instructions explicitly called for "assignee (name/avatar if available)". Did not implement an avatar image — there is no avatar/photo field anywhere in this schema (auth user metadata has no avatar convention established elsewhere in the codebase), so "if available" resolved to "not available" for avatars specifically; only the name is shown.

## Notes for the next worker
- `getProjectListTasks` and `getProjectBoardTasks` both live in `lib/queries/tasks.ts` and share the exact same `TaskCardTask` shape (from `components/task/task-card.tsx`) — if a future feature needs a third differently-ordered/filtered task query for the same project, keep reusing that type rather than inventing a new one.
- The integration test (`tests/integration/list-view-render.test.ts`) closely mirrors `tests/integration/board-columns-render.test.ts`'s real-Supabase-project pattern (`loadDotEnv`, `describe.skipIf(!haveAdminCreds)`, mocking `@/lib/supabase/server`'s `createClient` to a signed-in member client). Reuse this pattern for any future list-view feature's integration tests.
- The `edit-task.test.ts` flake ("JWT issued at future") only reproduces when the full suite runs in parallel close to the system clock's reported time; it is not something this feature introduced or can fix — flagging in case it recurs for the next worker so they don't chase it as a regression.
