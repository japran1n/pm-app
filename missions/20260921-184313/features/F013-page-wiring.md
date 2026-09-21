# F013: wire page.tsx

**Milestone:** M4  **Time:** 45 min  **Depends on:** F005, F006, F007, F008, F009, F010, F011, F012

## Assertions
All AS-010 through AS-101, AS-110

## Clarified implementation
Replace the body of `app/(workspace)/w/[workspaceSlug]/page.tsx`.

### Data fetching (Promise.allSettled)
```ts
const [
  myTasksResult,
  approvalCountResult,
  approvalsResult,
  clientRequestsResult,
  notificationsResult,
  qaReturnsResult,
  activeTimerResult,
  timeEntriesTodayResult,
  calendarBlocksResult,
  myProjectsResult,
  overdueCurResult,
  overduePrevResult,
  completedCurResult,
  completedPrevResult,
  unassignedResult,
  workloadResult,
  timezoneResult,
] = await Promise.allSettled([
  getMyTasks(workspaceId, userId, timezone),
  getOpenApprovalCountForWorkspace(workspaceId),
  getOpenApprovalsForWorkspace(workspaceId),
  getWorkspaceClientRequests(workspaceId),
  getNotificationsForWorkspace(workspaceId, { unreadOnly: true, limit: 20 }),
  getQaReturns(workspaceId, userId),
  getActiveTimer(),
  getPersonTimeEntriesInRange(userId, todayStart, todayEnd),
  getCalendarBlocks({ workspaceId, userId, from: now, limit: 3 }),
  getMyProjectsProgress(workspaceId, userId),
  getOverdueCount(workspaceId, timezone),
  getKpiDelta(workspaceId, 'overdue', 7),
  getCompletedCount(workspaceId),
  getKpiDelta(workspaceId, 'completed', 7),
  getUnassignedCount(workspaceId),
  getWorkspaceTimeByPersonAndDay(workspaceId, weekStart, weekEnd),
  getCurrentUserTimezone(),
]);
```

### Attention item assembly
Build `AttentionItem[]` from settled results: approvals, client requests (owner/admin only), mentions, QA returns. Merge, sort by date desc, cap at 10. Pass totalCount for overflow link.

### Layout
```tsx
<div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
  <div className="flex flex-col gap-6">
    {/* HomeGreeting, NeedsYouCard, MyWorkCard, MyProjectsGrid */}
  </div>
  <div className="flex flex-col gap-6">
    {/* TodayTimeCard, PersonalTodoList, ComingUpCard */}
  </div>
</div>
{/* TeamHealthSection — only for owner/admin */}
```

Role comes from `workspaceContext.role`. Pass `role` to NeedsYouCard and TeamHealthSection.

### Error isolation
Each settled result: if status === 'rejected', pass empty/fallback props to that card. Cards already handle empty state. Log errors server-side.

### Responsive
- `grid-cols-[1fr_340px]` on `lg:` (≥1024px) — single column below
- Project grid: `grid-cols-3 md:grid-cols-2 sm:grid-cols-1`
- No horizontal overflow

## Definition of done
- page.tsx compiles with tsc clean
- All new card components are mounted
- PersonalTodoList is repositioned to right column (was full-width before)
- Role gating works (TeamHealthSection returns null for member)
- Two-column layout on wide viewport, single column below lg
- tsc clean
