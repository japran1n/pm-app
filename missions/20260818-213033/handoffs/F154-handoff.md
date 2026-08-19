# Handoff: F154 — task completion percentage

## Status
COMPLETE

## Assertions covered
AS-272: PASS — unit tests in tests/unit/task-completion.test.ts (pure math), render tests in tests/unit/task-card-completion-render.test.ts (appears as real text on the card), and integration tests in tests/integration/board-tasks-completion.test.ts (real Supabase, real getProjectBoardTasks, checklist-only / children-only / mixed cases all produce the right percentage).
AS-273: PASS — `computeTaskCompletion` returns `null` (not `{percent:0}`) when `checklistTotal + childTotal === 0` (unit-tested directly, including the "0 done but something to measure" case that must NOT also return null); `<TaskCard>` renders no percentage/no `%` text at all when `task.completion` is null or undefined (render-tested); the integration test seeds a real task with zero checklist items and zero children and asserts `completion` is `null` when read back through the real board query.

## Files changed
lib/tasks/completion.ts (new)
lib/queries/tasks.ts
components/task/task-card.tsx
tests/unit/task-completion.test.ts (new)
tests/unit/task-card-completion-render.test.ts (new)
tests/integration/board-tasks-completion.test.ts (new)

## Commands run
`npx vitest run tests/unit/task-completion.test.ts tests/unit/task-card-completion-render.test.ts tests/integration/board-tasks-completion.test.ts` (0) — 3 files, 19 tests, all passed (integration test ran against the real linked Supabase project, not skipped)
`npx vitest run <28 pre-existing test files that import task-card.tsx / lib/queries/tasks.ts>` (0) — 148 tests, all passed; regression check for the two shared files this feature edits (board, list, dashboard, subtask, task-key surfaces)
`npx tsc --noEmit` (0)
`npx eslint .` (0) — 1 pre-existing warning in lib/queries/search.ts (`_titleMatches` unused), unrelated to this feature, not introduced by it

Per this mission's PROCESS RULES, the full `npm run test`/`npx playwright test` suite was intentionally NOT run here — the orchestrator runs it between features. The regression list above was selected by grepping tests/unit and tests/integration for every file that imports `task-card`, `TaskCard`, or `lib/queries/tasks` (the two files this feature edits), to directly verify no existing behaviour on those shared surfaces broke.

## Decisions made
- **Weighting (open question from the spec's Notes):** checklist items and child tasks are flat, equal units — a straight `(checklistDone + childDone) / (checklistTotal + childTotal)`, never a weighted average between the two kinds. This is the clarification's starred default ("simplest defensible rule is a flat count of both"). Recorded in `lib/tasks/completion.ts`'s doc comment and covered by an explicit unit test proving a 2-of-4 mixed measurement equals a 2-of-4 all-checklist measurement.
- **`lib/tasks/completion.ts`'s shape matches the spec's Draft scope exactly:** a pure function over `{ checklistTotal, checklistDone, childTotal, childDone }` (plain counts, not arrays) returning `TaskCompletion | null`. It does NOT itself count checklist items or children — it composes with the two existing pure counters (`countChecklistProgress` from F153, `countSubtaskProgress` from F150) rather than duplicating their logic, so there is exactly one place ("done" = status === "done") for F222's future sweep to change, per the critical context.
- **"Done" for a child task:** intentionally routed through the existing `countSubtaskProgress` (lib/tasks/subtask-progress.ts), not a new inline `status === "done"` comparison. That function already carries the F222-sweep doc comment from F150. This feature adds zero new string-comparison call sites — grep for `"done"` string comparisons against child-task status and `countSubtaskProgress` is still the only hit outside `is-overdue.ts` (a separate, already-existing convention).
- **Query extension, not a new query:** `getProjectBoardTasks` (lib/queries/tasks.ts) already ran one whole-project query for child counts (F150). I extended that same query to also select `status` (not just `parent_task_id`), and added ONE more whole-project query against `checklist_items` (joined `task_id -> tasks.project_id` since checklist_items has no project_id column of its own) — both grouped client-side into `Map<taskId, ...>` before the per-task `.map()`, so completion is still computed with a fixed, small number of queries for the whole board regardless of task count, never a per-card round trip.
- **Card only, not the list table:** AS-272's text says "displayed on the task card" specifically (not the list view). F150's own precedent (subtaskCount) was added to `TaskCardTask` and rendered by `<TaskCard>` only — `<TaskListTable>` never grew a subtask indicator even though it shares the same task type. I followed that same precedent for completion: `completion` is on `TaskCardTask` (so it's available everywhere that type flows, including the list/dashboard queries in the future without a type change) and rendered only by `<TaskCard>`. `getProjectListTasks`/`getWorkspaceListTasks` were NOT extended to fetch/compute completion — see Out-of-scope below.
- **Indicator design (AS-525):** a small fill-bar `<span>` (visual affordance) immediately followed by the literal `NN%` text, both inside one `aria-label` that also names the done/total breakdown (e.g. `"50% complete, 2 of 4"`). The percentage number is real rendered text content, not conveyed by the bar's fill width/colour alone — matches this card's existing icon+text pattern for the overdue and subtask-count indicators.
- **Rounding:** `Math.round((done/total)*100)`, tested at both rounding directions (1/3 -> 33%, 2/3 -> 67%) so a naive floor/ceil regression would be caught.

## Out-of-scope work needed
- `<TaskListTable>` (components/task/task-list-table.tsx) and the dashboard table that reuses it do not show the completion percentage. AS-272's assertion text is specifically about "the task card"; this was a deliberate scope decision (see Decisions made), not an oversight, but if a future feature/validator wants it on the list view too: `getProjectListTasks`/`getWorkspaceListTasks` (lib/queries/tasks.ts) would need the same childRows/checklistRows batched-query treatment `getProjectBoardTasks` now has (currently duplicated logic if added — worth extracting a shared `attachCompletion(tasks, projectId)` helper at that point rather than copy-pasting the three query blocks a third time), and `<TaskListTable>` would need a new column or an icon+text cell mirroring the card's indicator.
- F222 (M16, custom statuses sweep): once workspace-configured "done" statuses exist, `countSubtaskProgress` (lib/tasks/subtask-progress.ts) is the single function to update — this feature's `computeTaskCompletion` and the board query both consume its output and need no changes themselves.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Took the clarification's starred "flat count of both" weighting default for checklist items vs. child tasks, since the spec's own Notes flagged this as the one open question and the clarification file resolved it to that default for all ambiguity-resolution questions in this run.
AUTONOMOUS_DECISION: Scoped the on-card indicator to `<TaskCard>` only (not `<TaskListTable>`), reading AS-272's "displayed on the task card" literally and following F150/AS-275's subtaskCount precedent of card-only, list-excluded. Reported above as Out-of-scope work needed in case a validator disagrees.

## Notes for the next worker
- `lib/tasks/completion.ts` is intentionally tiny and dependency-free (no import of `checklist-progress.ts`/`subtask-progress.ts` inside it) — those two stay the caller's job, per the Clarified implementation's "plain typed inputs passed by the caller, no I/O inside the module" answer. Don't be tempted to fold array-counting into it; that would reintroduce a second place doing what `countChecklistProgress`/`countSubtaskProgress` already do.
- The new `checklist_items` query in `getProjectBoardTasks` uses PostgREST's `tasks!inner(project_id, deleted_at)` embedded-filter syntax (`.eq("tasks.project_id", ...)`, `.is("tasks.deleted_at", null)`) since `checklist_items` has no `project_id` of its own — this mirrors the RLS policy's own join shape (`checklist_items_select_active_members`, supabase/migrations/20260819075456_create_checklist_items.sql) rather than inventing a different scoping path.
- The integration test (tests/integration/board-tasks-completion.test.ts) actually inserts checklist items and parent/child tasks into the real linked Supabase project and reads them back through the real `getProjectBoardTasks` — it ran green in this session (not skipped), so AS-272/AS-273 are proven against real RLS-scoped data, not just the pure function in isolation.
- No MCP tools were used at runtime for this feature (tech-decisions.md/spec both say none needed) — the integration test uses the plain `@supabase/supabase-js` admin/member client pattern already established by every other integration test in this repo, not an MCP call.
