# F007: my-work-card.tsx

**Milestone:** M2  **Time:** 35 min  **Depends on:** F001

## Assertions
AS-030, AS-031, AS-032, AS-033, AS-034, AS-035, AS-036

## Clarified implementation
Create `components/dashboard/my-work-card.tsx` — Client Component (`'use client'`).

Uses existing `MyTaskRow` type from `lib/queries/my-tasks.ts`.

```tsx
type MyWorkCardProps = {
  overdue: MyTaskRow[];
  today: MyTaskRow[];
  thisWeek: MyTaskRow[];
  workspaceSlug: string;
  doneStatusIdByProject: Record<string, string>; // projectId → first done-category statusId
};
```

Rendering:
- Three groups: Overdue (red header + count), Today, This week
- Combined total capped at 8 visible rows (overdue first, then today, then this week); remainder shown as "Show X more → My Tasks" link
- Each row: checkbox | key (mono, PROJ-123) | title + project name (muted, small) | status badge (read-only pill) | due date (mono) | ▶ start timer button
- Status badge: derive color from task's `status` field — use same color logic as task-card.tsx badge
- Checkbox: `onClick` calls existing `updateTaskStatus` server action to toggle to done status; optimistic update (flip checked state, revert on error)
- Timer play button: calls existing `startTimeEntry` action with `taskId`; on success revalidates path. Show ■ (stop) if this task has active timer (pass `activeTimerTaskId` prop or derive from parent)
- Empty state: "You're all clear — nothing due soon."

Add `activeTimerTaskId?: string` prop so the ▶ button knows which task is running.

## Definition of done
- All three groups render with data
- Empty state renders
- tsc clean
- Checkbox interaction (optimistic update) works
