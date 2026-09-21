# Discovery — Round 2 (self-answered)

_2026-09-21_

15 follow-up questions derived from round-1 gaps.

1. How many items max in "Needs you"? ★ Cap at 10; most recent first; "X more in inbox →" link
2. Timer stop from dashboard — full page revalidation or optimistic? ★ Optimistic timer display; revalidation on stop/start to refresh "today" total
3. "Coming up" — show calendar blocks only or task due dates too? ★ Calendar blocks only (cleaner source, tasks are in My work already)
4. My projects — which projects? ★ Active projects where current user is a project member (getProjectsForMember)
5. Projects progress metric — done/total by what? ★ Tasks in done-category statuses / total tasks (excluding deleted)
6. Workload bar — show all workspace members or only active? ★ Active members only (same filter as elsewhere)
7. "Unassigned" in KPIs — which tasks? ★ Incomplete tasks with no assignee in any active project in workspace
8. KPI tiles clickable — where do they link? ★ Each links to a filtered My Tasks or All tasks URL with matching filter
9. QA-return detection — which activity type? ★ Look for task_activity rows where new_value contains a status that is NOT in "done"/"approved" categories, after being in a QA-family status — use status category transitions from project_statuses
10. Personal to-dos — same component, just repositioned? ★ Yes, PersonalTodoList as-is, no changes to that component
11. Greeting — user's display name source? ★ Supabase auth user metadata (already fetched for layout)
12. Greeting sentence — how to count? ★ attention_count (needs you items) + today task count + overdue count
13. Skeleton loading state? ★ Per-card skeleton matching card height; overall page skeleton for SSR
14. Should "needs you" show QA-return for tasks where I am the assignee only? ★ Yes — only tasks assigned to me that came back from QA
15. Milestone for removing old components? ★ Last milestone (M5) after all new content is verified GREEN
