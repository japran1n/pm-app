# M7 — Dashboard: Scrutiny Report

Adversarial, read-only validation of M7 (F071–F078, AS-125–AS-136). Bias: rejection. No code was modified.

## Assertion-by-assertion results

| Assertion | Text (abridged) | Verdict | Notes |
|---|---|---|---|
| AS-125 | Bar chart of task counts by priority, scoped to workspace | PASS | `get_priority_counts` RPC (SECURITY INVOKER) + `PriorityBarChart`; covered by `tests/integration/priority-counts-rpc.test.ts` |
| AS-126 | Pie chart of task counts by status, scoped to workspace | PASS | `get_status_counts` RPC (SECURITY INVOKER) + `StatusPieChart`; covered by `tests/integration/status-counts-rpc.test.ts` |
| AS-127 | Aggregates computed via DB query, not full-list fetch | PASS | Both RPCs are set-returning SQL functions called via `.rpc()`; no client-side full-task fetch in `lib/queries/dashboard.ts` |
| AS-128 | Aggregates exclude soft-deleted tasks | PASS | Both RPCs filter `t.deleted_at is null`, test-covered |
| AS-129 | Aggregates exclude tasks from archived projects (default) | PASS (RPCs) / **FAIL (F078 table)** | RPCs filter `p.deleted_at is null` identically (archive = soft-delete convention, confirmed in `supabase/migrations/20260818004709_rls_projects.sql`). **However `getWorkspaceListTasks` (lib/queries/tasks.ts, F078) does NOT filter `projects.deleted_at is null`**, and RLS (`is_project_workspace_member`) also does not check it — see Finding 1. This is a data-consistency defect between the two halves of the same dashboard, even though AS-129's literal text is scoped to "aggregates"; flagging because F078 is part of the same dashboard mission and no other assertion covers the table's archived-project behavior. |
| AS-130 | Zero-task workspace shows empty state | PASS | `tests/integration/dashboard-empty-state.test.ts` exists and exercises this path |
| AS-131 | Overdue count (due date past, status ≠ done) | PASS | `get_overdue_count` correctly compares `due_date date < current_date` (no timezone drift — column is DATE not TIMESTAMPTZ) and excludes `status = 'done'`; NULL due_date naturally excluded. Covered by `tests/integration/overdue-count-rpc.test.ts` including a done-but-overdue negative case. |
| AS-132 | Switching workspace updates all dashboard figures | PASS | `tests/integration/dashboard-workspace-switch-refresh.test.ts` exists |
| AS-133 | Workspace A member cannot retrieve workspace B counts via parameter tampering | PASS | Dedicated adversarial test `tests/integration/dashboard-rls-cross-workspace.test.ts` seeds real non-trivial data in workspace B and asserts zero/empty results when A's member passes B's id directly to all three RPCs |
| AS-134 | Dashboard table supports same status/priority filters as list view | PASS (filters) / **gap noted** | `getWorkspaceListTasks` correctly AND-combines status/priority/assigneeId filters, reuses `<ListFilters>`/`<TaskListTable>` unmodified from F053/F054; `tests/integration/dashboard-task-table-filters.test.ts` verifies filter combinations and cross-workspace non-leakage. Same archived-project gap as AS-129 applies here (Finding 1). |
| AS-135 | Dashboard chart colors consistent with status/priority coding elsewhere (board, badges) | **FAIL** | Charts and the Board/TaskCard both correctly use the shared `lib/task-colors.ts` constants (`STATUS_COLORS`/`PRIORITY_COLORS`) — no drift there. But the List view (`components/task/task-list-table.tsx`, `components/task/list-status-select.tsx`), which is now *reused verbatim inside the dashboard itself by F078*, renders status/priority with **no color at all** (plain shadcn `Badge`/`Select`, plus a second independently-duplicated `PRIORITY_LABELS` map). A user sees a colored "Urgent" bar on the dashboard chart and an uncolored gray "Urgent" badge in the very table three inches below it on the same page. See Finding 2. |
| AS-136 | Dashboard loads within tech-decisions.md's performance budget | **INCONCLUSIVE / not actually satisfiable in M7** | `missions/20260817-230717/tech-decisions.md` contains **no performance budget of any kind** (no ms/second/latency figures anywhere in the file — verified by grep). The only feature that would define and check such a budget, F089 (`perf-budget-check`), is scheduled in **M8**, not M7. AS-136 is listed in the M7 contract range (AS-125–AS-136) and M7 is marked all-COMPLETE, but no M7 feature or test measures dashboard load time against any budget, because the budget itself doesn't exist yet. This is a real gap, not a defect in code — but the milestone should not be represented as having satisfied AS-136. Compare to the precedent set by AS-034/AS-064's explicit "Deferred re-verification" notes elsewhere in plan.md; AS-136 has no equivalent deferred-note and should get one. |

**Tally: 10 PASS, 2 FAIL (AS-135, and AS-129/AS-134's shared archived-project gap), 1 INCONCLUSIVE (AS-136).**

## Findings

### Finding 1 — SEVERITY: MEDIUM — F078's dashboard table does not exclude tasks from archived (soft-deleted) projects
- **Where:** `lib/queries/tasks.ts`, function `getWorkspaceListTasks` (used by `components/dashboard/dashboard-task-table.tsx`, F078)
- **What:** The three dashboard RPCs (`get_priority_counts`, `get_status_counts`, `get_overdue_count`) all explicitly filter `p.deleted_at is null` to exclude archived projects' tasks, per AS-129. `getWorkspaceListTasks` joins `tasks -> projects!inner(workspace_id)` and filters `.eq("projects.workspace_id", workspaceId)` and `.is("deleted_at", null)` (on `tasks.deleted_at` only) — it never checks `projects.deleted_at`. The tasks-table RLS policy `tasks_select_active_members` (supabase/migrations/20260818013805_rls_tasks.sql) also only checks `tasks.deleted_at is null` and workspace membership via `is_project_workspace_member`, which itself never checks the project's `deleted_at`. So there is no layer — app query or RLS — that excludes an archived project's tasks from the dashboard table.
- **Failure scenario:** A workspace has one active project and one archived (soft-deleted) project with 5 open tasks. The dashboard's pie/bar charts (RPC-driven) correctly show only the active project's tasks. The dashboard's task table directly below (F078) shows all 5 archived-project tasks anyway — visibly contradicting the charts on the same page, and re-surfacing tasks the user archived specifically to stop seeing.
- **Test evidence of the gap:** `tests/integration/dashboard-task-table-filters.test.ts` was read in full (both directly and via a parallel reviewer) — it seeds two active projects plus one other-workspace project, but at no point seeds or asserts against an archived project. Zero occurrences of "archiv" in that test file, in `lib/queries/tasks.ts`, in `dashboard-task-table.tsx`, or in the F078 feature spec.
- **Recommended follow-up feature (one paragraph):** Add `.is("projects.deleted_at", null)` to `getWorkspaceListTasks`'s query in `lib/queries/tasks.ts` (mirroring the RPCs' `p.deleted_at is null`), and add a test case to `tests/integration/dashboard-task-table-filters.test.ts` that seeds an archived project with an open task and asserts it's absent from `getWorkspaceListTasks`'s default results — matching the archived-project negative case already present in `priority-counts-rpc.test.ts`/`status-counts-rpc.test.ts`/`overdue-count-rpc.test.ts`.

### Finding 2 — SEVERITY: MEDIUM — Dashboard's own reused list-view table renders status/priority with no color, breaking AS-135's cross-component color consistency
- **Where:** `components/task/task-list-table.tsx` (lines ~141–148, priority `Badge`) and `components/task/list-status-select.tsx` (status `Select`), both reused unmodified inside the dashboard by `components/dashboard/dashboard-task-table.tsx` per F078's own design comment.
- **What:** `lib/task-colors.ts` defines canonical `STATUS_COLORS`/`PRIORITY_COLORS`, correctly consumed by `status-pie-chart.tsx`, `priority-bar-chart.tsx` (via `lib/queries/dashboard.ts`), `board-column.tsx`, and `task-card.tsx`. `task-list-table.tsx` never imports either constant: its priority cell is a flat `<Badge variant="secondary">` using a second, independently-duplicated `PRIORITY_LABELS` map (drift risk on top of the missing color), and its status cell is a plain, colorless shadcn `<Select>` fed by a local `STATUS_OPTIONS` array.
- **Failure scenario:** On the dashboard page itself, the priority bar chart shows "Urgent" as red (`#ef4444`); the task table immediately below it (same page, same data, F078 reusing this exact component) shows "Urgent" as a flat gray badge. AS-135 requires consistency across "board columns, priority badges" — the list/dashboard table's badges are a `priority badge` and are not consistent.
- **Test evidence of the gap:** `tests/unit/dashboard-chart-colors.test.ts` exists but only asserts chart-vs-constant consistency; it does not cover `task-list-table.tsx`, so this drift is currently untested and would not fail any existing test.
- **Recommended follow-up feature (one paragraph):** Update `components/task/task-list-table.tsx`'s priority `Badge` to apply `PRIORITY_COLORS[task.priority]` as an inline style/background (matching `task-card.tsx`'s pattern) and remove the duplicated local `PRIORITY_LABELS` in favor of importing from `lib/task-colors.ts`; update `components/task/list-status-select.tsx` to render a colored dot/indicator per `STATUS_COLORS[status]` matching `board-column.tsx`'s status treatment. Extend `tests/unit/dashboard-chart-colors.test.ts` (or add a sibling test) asserting the List/Table view's rendered priority and status colors match `lib/task-colors.ts` for every enum value, closing the coverage gap that let this drift go undetected. Since `task-list-table.tsx` is shared by F053 (project list) and F078 (dashboard table), this fix benefits both, not just the dashboard.

### Finding 3 — SEVERITY: LOW (process/traceability, not a code defect) — AS-136 has no performance budget to be validated against, and no M7 "deferred" note documents this
- **Where:** `missions/20260817-230717/tech-decisions.md` (no perf budget anywhere), `missions/20260817-230717/plan.md` line 121 (F089, the feature that would define/check it, is in M8), `missions/20260817-230717/features/F089-perf-budget-check.md`.
- **What:** AS-136 ("Dashboard data loads within the performance budget defined in tech-decisions.md") is listed in the M7 validation-contract range and M7 is marked all-COMPLETE, but the referenced budget does not exist in tech-decisions.md (grep for ms/second/latency/budget returns nothing), and the feature that would establish and check it (F089) is scheduled for M8. This mirrors the documented pattern for AS-034 and AS-064 elsewhere in plan.md ("Deferred re-verification... not a defect, a sequencing artifact"), but no equivalent note exists for AS-136.
- **Recommended follow-up (one paragraph):** Add a "Deferred re-verification (M8)" entry to plan.md for AS-136, identical in spirit to the existing AS-034/AS-064 entries, stating that AS-136 cannot be genuinely validated until F089 defines an actual performance budget in tech-decisions.md and measures the dashboard against it — and that M7 being marked COMPLETE should not be read as AS-136 being satisfied.

## Non-findings (explicitly checked, no defect)
- All three dashboard RPCs are `SECURITY INVOKER` (not DEFINER) — confirmed by direct SQL read of all three migration files, verified no later migration redefines them.
- Soft-delete/archived-project filtering (`deleted_at is null` on both `tasks` and `projects`) is byte-identical across all three RPCs.
- `get_overdue_count`'s date comparison (`due_date date < current_date`) has no timezone drift risk — `due_date` is a plain DATE column, not a TIMESTAMPTZ, so there is no time-of-day/UTC-offset component to introduce an off-by-one.
- AS-133's cross-workspace parameter-tampering protection has a dedicated, non-trivial adversarial test (`dashboard-rls-cross-workspace.test.ts`) seeding real data in the victim workspace, not just an empty-workspace check.
- `getWorkspaceListTasks` correctly scopes to the caller's own workspace via `projects!inner(workspace_id)` + `.eq(...)`, and its own cross-workspace non-leakage is test-covered (Task D in `dashboard-task-table-filters.test.ts`).
- All three RPCs `grant execute ... to authenticated, anon` — harmless today (no anon SELECT policy exists on `tasks`/`projects`, so anon calls return zero rows) but is a minor widened-attack-surface observation, not scored as a defect since it matches the codebase's existing `search_tasks` RPC pattern.

## Command output

### `npx vitest run`
```
 Test Files  76 passed (76)
      Tests  408 passed (408)
   Start at  08:28:42
   Duration  41.83s
```
All 408 tests pass, including every M7-relevant integration test enumerated above. Note: integration tests are `describe.skipIf(!haveAdminCreds)` — they ran for real (not skipped) since `.env` provides Supabase admin credentials in this environment.

### `npx eslint .`
```
/Users/sasajapranin/Desktop/pm-app/lib/queries/search.ts
  159:27  warning  '_titleMatches' is defined but never used  @typescript-eslint/no-unused-vars

✖ 1 problem (0 errors, 1 warning)
```
Zero errors. One pre-existing warning, unrelated to M7 (lib/queries/search.ts is a search feature from an earlier milestone).

### `npx tsc --noEmit`
```
(no output — clean)
```

## Recommended follow-up features for plan.md
1. **F104 dashboard-table-archived-project-exclusion** — AS-129, AS-134 — fix `getWorkspaceListTasks` to filter `projects.deleted_at is null`, per Finding 1.
2. **F105 list-view-status-priority-colors** — AS-135 — colorize `task-list-table.tsx`/`list-status-select.tsx` against `lib/task-colors.ts`, per Finding 2. Benefits both F053 (project list) and F078 (dashboard table).
3. Add an explicit "Deferred re-verification (M8)" note for AS-136 in plan.md, per Finding 3 — no new feature needed, F089 already exists in M8.
