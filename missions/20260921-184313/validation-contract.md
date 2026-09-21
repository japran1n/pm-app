# Validation Contract — Home Dashboard Redesign

_Mission: 20260921-184313_ _Written: 2026-09-21_ _Status: APPROVED_

All assertions are falsifiable. Assertions are immutable once APPROVED exists. New requirements get new IDs; existing assertions are never edited or deleted.

---

## AS-001 — Baseline tsc passes
`npx tsc --noEmit` exits 0 on HEAD before any mission change.

## AS-002 — Baseline eslint passes
`npx eslint . --max-warnings=0` exits 0 on HEAD before any mission change.

## AS-003 — Baseline vitest passes
`npx vitest run tests/unit` exits 0 (or the same known count as recorded in run-log) before any mission change.

## AS-004 — Baseline migrations:check passes
`npm run migrations:check` exits 0 before any mission change.

## AS-005 — No new database migrations
`missions/20260921-184313/run-log.md` shows migration count equal before and after mission.

## AS-010 — Greeting renders user display name
The workspace home page renders the authenticated user's display name in the greeting heading.

## AS-011 — Greeting shows today's date in user timezone
The greeting section includes today's date formatted for the user's timezone (from getCurrentUserTimezone).

## AS-012 — Greeting shows attention count
The greeting subtitle includes a count of items in "Needs you" and a count of tasks due today.

## AS-020 — Needs you: approvals appear
Open workspace approvals pending the current user appear in the Needs you card.

## AS-021 — Needs you: client requests appear
Open client requests appear in the Needs you card for owner/admin roles.

## AS-022 — Needs you: mentions appear
Unread mention notifications (kind = "mention" | "comment_reply") appear in the Needs you card.

## AS-023 — Needs you: QA returns appear
Tasks assigned to the current user that transitioned from a QA-category status back to a non-done, non-QA status within the last 7 days appear in the Needs you card.

## AS-024 — Needs you: empty state renders
When there are no items in Needs you, the card shows "You're all caught up ✓" and does not error.

## AS-025 — Needs you: capped at 10 items
The Needs you card shows at most 10 items; excess is indicated by a link "X more in inbox →".

## AS-026 — Needs you: client requests hidden from member role
A workspace member (not owner/admin) does not see client requests in the Needs you card.

## AS-030 — My work: overdue group renders
Tasks in the overdue bucket appear under a red "Overdue" group header.

## AS-031 — My work: today group renders
Tasks due today appear under a "Today" group header.

## AS-032 — My work: this week group renders
Tasks due this week (not today) appear under a "This week" group header.

## AS-033 — My work: max 8 rows above fold
My work shows at most 8 task rows by default with a "Show more" or link to My Tasks.

## AS-034 — My work: status shown as badge
Each task row shows its status as a read-only badge (not an editable dropdown).

## AS-035 — My work: checkbox marks task complete
Clicking the checkbox on a task row toggles the task to a done-category status using the existing status mutation.

## AS-036 — My work: empty state renders
When the user has no tasks in overdue/today/this week, My work shows an appropriate empty state.

## AS-040 — Today time card: today total renders
The today time card shows the total minutes logged today by the current user, formatted as Xh Ym.

## AS-041 — Today time card: running timer renders
If the user has an active timer, the card shows the task title and a live elapsed time counter.

## AS-042 — Today time card: Stop/Resume works
Clicking Stop or Resume calls the existing stopTimeEntry / startTimeEntry actions and updates the timer state.

## AS-043 — Today time card: empty when no entries
When no time entries exist today, the card shows 0h 0m and no timer row.

## AS-050 — My projects: progress bar renders
Each project card shows a filled progress bar representing done tasks / total tasks.

## AS-051 — My projects: overdue count renders
Each project card shows the count of overdue tasks in that project (red when > 0).

## AS-052 — My projects: only member projects shown
Only projects where the current user is a member are shown.

## AS-053 — My projects: empty state renders
When the user is not a member of any active project, an appropriate empty state is shown.

## AS-060 — Coming up: calendar blocks render
The coming up card shows the next ≤3 calendar blocks for the current user, with time and title.

## AS-061 — Coming up: empty state renders
When there are no upcoming calendar blocks, an appropriate empty state is shown.

## AS-070 — Team health: hidden from member role
A user with workspace role "member" does not see the Team health section.

## AS-071 — Team health: visible to owner
A user with workspace role "owner" sees the Team health section.

## AS-072 — Team health: visible to admin
A user with workspace role "admin" sees the Team health section.

## AS-073 — KPI: overdue count with delta
The overdue KPI tile shows the current overdue count and the change vs. 7 days ago.

## AS-074 — KPI: unassigned count renders
The unassigned KPI tile shows the count of incomplete, unassigned tasks across active projects.

## AS-075 — KPI: completed this week renders
The completed KPI tile shows tasks completed in the last 7 days with delta vs. prior 7 days.

## AS-076 — KPI tiles are links
Each KPI tile is a focusable link that navigates to a filtered task view.

## AS-080 — Workload card renders
The workload card shows each active workspace member with a bar representing hours logged this week vs. 40h target.

## AS-081 — Workload: over-capacity highlighted
Members who have logged > 40h this week have their bar rendered in red.

## AS-090 — Old charts removed
`components/dashboard/priority-bar-chart.tsx` and `components/dashboard/status-pie-chart.tsx` do not exist in the final state.

## AS-091 — Old task table removed
`components/dashboard/dashboard-task-table.tsx` does not exist in the final state.

## AS-092 — Old dashboard-content removed
`components/dashboard/dashboard-content.tsx` does not exist in the final state. A new replacement component exists.

## AS-093 — No orphan imports
`npx tsc --noEmit` exits 0 after removals, confirming no code references deleted files.

## AS-094 — No orphan test files
Tests that referenced deleted components are also removed or updated.

## AS-100 — Responsive: single column ≤1100px
Below 1100px viewport width the page renders in a single column (right column stacks below left).

## AS-101 — Responsive: phone layout ≤560px
At 375px width the page is usable: text is readable, no horizontal overflow.

## AS-110 — Promise.allSettled isolation
If one dashboard data fetch throws, the remaining cards still render (demonstrated by unit test or code review).

## AS-111 — tsc passes after mission
`npx tsc --noEmit` exits 0 at mission end.

## AS-112 — eslint passes after mission
`npx eslint . --max-warnings=0` exits 0 at mission end.

## AS-113 — vitest passes after mission
`npx vitest run tests/unit` exits with the same pass/fail count as baseline.
