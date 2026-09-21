# Handoff: F007 — my-work-card.tsx

## Status
COMPLETE

## Assertions covered
AS-030: PASS — overdue rows render under a red "Overdue" group header (test_AS_030_overdue_tasks_render_under_a_red_overdue_group_header)
AS-031: PASS — today rows render under a "Today" group header (test_AS_031_tasks_due_today_render_under_a_today_group_header)
AS-032: PASS — this-week rows render under a "This week" group header (test_AS_032_tasks_due_this_week_render_under_a_this_week_group_header)
AS-033: PASS — combined rows capped at 8 with a "Show N more → My Tasks" link (test_AS_033_combined_rows_are_capped_at_8_with_a_link_to_my_tasks_for_the_remainder)
AS-034: PASS — status renders as a read-only StatusBadge pill, no combobox/select present (test_AS_034_each_row_shows_status_as_a_read_only_badge_not_a_dropdown)
AS-035: PASS — checkbox optimistically flips before `moveTaskStatus` resolves and reverts on failure (test_AS_035_checking_the_checkbox_optimistically_marks_the_task_done_via_movetaskstatus, test_AS_035_a_failed_status_mutation_reverts_the_optimistic_checkbox)
AS-036: PASS — empty state text "You're all clear — nothing due soon." renders when all three buckets are empty (test_AS_036_when_all_three_buckets_are_empty_the_card_shows_the_empty_state)

## Files changed
components/dashboard/my-work-card.tsx
tests/unit/my-work-card.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npx vitest run tests/unit/my-work-card.test.tsx` (0) — 8/8 passed
`npx vitest run tests/unit` (0, per background run) — 92 pre-existing failing test files / 294 pre-existing failing tests, none touching `my-work-card`, `dashboard-kpi`, or `my-projects-progress`; all failures are in unrelated files (many under `.claude/worktrees/agent-a4d181b015eaa43cf/...`, a stale parallel worktree, plus locale-string mismatches in preview-pane tests) and pre-date this change — confirmed via `grep -n "my-work-card"` against the full run log, zero matches

## Decisions made
- Status is rendered with the existing generic `<StatusBadge>` (components/ui/status-badge.tsx) — the same read-only colour+label pill `task-card.tsx`'s priority chip already uses — rather than `<ListStatusSelect>`/`<MyTaskStatusCell>`, since AS-034 explicitly requires a non-editable badge, not the dropdown the My Tasks page and TaskListTable rows use.
- Status colour comes from `STATUS_COLORS` + `statusLabelFor` (lib/task-colors.ts), the file's own documented single source of truth for status/priority colour coding (F073/AS-135), so this card can never invent a colour that disagrees with the rest of the app.
- Row cap logic fills groups in order (overdue → today → thisWeek) up to 8 total, truncating whichever group crosses the boundary — matches the spec's "overdue first, then today, then this week" ordering.
- Timer button lives inline per row rather than a single global control, since a `MyTaskRow` array can span many different tasks — clicking it starts/stops `startTimer`/`stopTimer` for that specific row only.

## Out-of-scope work needed
- Wiring `<MyWorkCard>` into `app/(workspace)/w/[workspaceSlug]/page.tsx` is F012/M4's job (not this feature) — that worker will need to build the `doneStatusIdByProject` map (one project_statuses query per distinct projectId in the buckets, resolving each project's first done-category status name) and resolve `activeTimerTaskId` from `getActiveTimer`. This card is import-ready but intentionally not mounted yet, per F007's own scope in plan.md ("New component files under components/dashboard/. No page.tsx wiring yet").

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: The clarified spec's prop is named `doneStatusIdByProject: Record<string, string>`, but the only existing status-mutation action (`moveTaskStatus(taskId, newStatus)`, lib/actions/tasks/ordering.ts, F221/AS-409) takes a project's real `project_statuses.name` STRING, never a `status_id` uuid — there is no id-based variant. Kept the prop name from the spec verbatim so a future page.tsx wiring matches the spec literally, but each map value is treated as the done-category status NAME to pass straight into `moveTaskStatus`. Documented at the top of the component file.

AUTONOMOUS_DECISION: The clarified spec names `startTimeEntry`/`stopTimeEntry` as the timer actions, but the real exports (lib/actions/time-entries.ts) are `startTimer(taskId)` and `stopTimer()` (no args). Used those instead — same substitution `today-time-card.tsx` (F008, this same mission) already made and documented for the identical spec-vs-code mismatch.

## Notes for the next worker
- `MyTaskRow.status` is the raw per-project status name (not always one of the fixed `todo|in_progress|in_review|done` set — see F218-F223); `STATUS_COLORS`/`statusLabelFor` fall back to a neutral slate colour and the raw name respectively for any status outside that fixed map, so a custom project status still renders sensibly.
- No MCP tools were used for this feature — it is a pure UI component with no live external-service state to introspect (per `worker-mcp-usage`'s decision tree: "Pure UI feature → No MCP").
