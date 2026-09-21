# Discovery — Round 1 (self-answered, user authorized autonomous execution)

_2026-09-21_

All 30 answered with the recommended ★ option unless noted.

1. Who is the primary user? ★ Internal team member (designer/developer)
2. What device? ★ Desktop, min 1280px (mobile responsive bonus)
3. Is this a greenfield feature or replacing existing? ★ Replacing: workspace home page.tsx
4. Performance budget? ★ Under 1s server render; data fetched server-side via Promise.all
5. Auth model? ★ Existing workspace session (Supabase Auth, already in place)
6. Role differentiation? ★ Yes — owner/admin see Team Health; member does not
7. Real-time updates needed? ★ No — server-render with revalidation; timer is client-only interval
8. Mobile? ★ Responsive (single-column ≤1100px, phone-width ≤560px)
9. Dark mode? ★ Yes — Supabase DS tokens, both themes already wired
10. Accessibility? ★ WCAG AA minimum; semantic HTML; keyboard navigation on interactive elements
11. Internationalisation? ★ No (workspace is Swedish-market agency, dates localised via user TZ)
12. Testing approach? ★ Unit tests for query helpers and pure logic; integration skipped (existing pattern)
13. Error handling? ★ Per-card graceful degradation via Promise.allSettled; no full-page error
14. Empty states? ★ Each card has its own empty state (e.g. "Needs you: You're all caught up ✓")
15. Data freshness? ★ Server render + Next.js revalidatePath after timer stop/start mutations
16. Feature flags? ★ No feature flags; roles gate Team Health section
17. Notifications system? ★ Existing notifications table and getNotificationsForWorkspace query
18. Timer interactions? ★ Reuse existing startTimeEntry / stopTimeEntry actions and GlobalTimeTracker state
19. QA-return signal? ★ Derive from task_activity log (no new migration for v1)
20. Approvals source? ★ getOpenApprovalsForWorkspace (existing query, already on workspace)
21. Client requests source? ★ getWorkspaceClientRequests (existing query)
22. My tasks source? ★ getMyTasks (existing, returns overdue/today/thisWeek/later buckets)
23. Projects data? ★ New lightweight query over tasks joined to projects where I'm a member
24. Calendar/coming up? ★ getCalendarBlocks (existing) — next 3 blocks for current user
25. Workload (team health)? ★ getWorkspaceTimeByPersonAndDay for current week; target = 40h fixed v1
26. KPI delta? ★ Two count calls with different date ranges; no new RPC
27. Unassigned count? ★ New inline SQL in dashboard.ts query file
28. Existing components to reuse? ★ UserAvatar, Badge, Button, Card from ui/; GlobalTimeTracker hooks
29. Remove what? ★ DashboardTaskTable, PriorityBarChart, StatusPieChart, priority-bar-chart.tsx, status-pie-chart.tsx, dashboard-content.tsx (replaced), associated tests
30. New files needed? ★ ~12 new component files + 2 query additions; no new migration
