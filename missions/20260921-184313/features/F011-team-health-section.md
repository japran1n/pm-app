# F011: team-health-section.tsx + workload-card.tsx

**Milestone:** M3  **Time:** 40 min  **Depends on:** F002

## Assertions
AS-070, AS-071, AS-072, AS-073, AS-074, AS-075, AS-076, AS-080, AS-081

## Clarified implementation
Create two components:

### components/dashboard/team-health-section.tsx (Server Component)
```tsx
type TeamHealthSectionProps = {
  overdueCount: number;
  overdueDelta: number;       // positive = more than last week (bad)
  unassignedCount: number;
  completedCount: number;
  completedDelta: number;     // positive = more than last week (good)
  workloadData: WorkspaceTimeByPerson[];
  workspaceSlug: string;
  role: WorkspaceRole;
};
```
- If role is 'member': render nothing (return null)
- Section heading "Team health" + "Owner" pill badge
- 3 KPI tiles (use existing `KpiTile` component from `components/dashboard/kpi-tile.tsx` OR inline new version):
  - Overdue: count, delta formatted as "+4 vs last week" (red when positive), links to `/w/{slug}/my-tasks?overdue=true` (or nearest equivalent filtered URL)
  - Unassigned: count, subtitle "Assign owners →", links to tasks filtered unassigned
  - Completed: count, delta formatted "+9 vs last week" (green when positive), links to completed tasks
- KPI tile must be a focusable link (`<a>` wrapping the tile) per AS-076

### components/dashboard/workload-card.tsx (Server Component)
```tsx
type WorkloadCardProps = {
  members: Array<{
    userId: string;
    displayName: string;
    avatarUrl: string | null;
    minutesThisWeek: number;
  }>;
  targetMinutes: number; // 2400 (40h)
};
```
- Card "Workload this week" + "Time report →" link
- Each member row: avatar | name | progress bar | hours (mono)
- Bar width = minutesThisWeek / targetMinutes, capped at 100% visually
- Bar color: green (< 80%), amber (80–100%), red (> 100%) — AS-081
- "X h / 40h" formatted (mono, red when over)
- Use `UserAvatar` component from `@/components/user-avatar`

`WorkspaceTimeByPerson` is from `lib/queries/time-entries.ts:44` — check fields.

## Definition of done
- TeamHealthSection returns null for member role
- KPI tiles are `<a>` elements
- Workload bars show correct color thresholds
- tsc clean
