# F008: today-time-card.tsx

**Milestone:** M2  **Time:** 30 min  **Depends on:** F001

## Assertions
AS-040, AS-041, AS-042, AS-043

## Clarified implementation
Create `components/dashboard/today-time-card.tsx` — Client Component.

```tsx
type TodayTimeCardProps = {
  todayMinutes: number;       // pre-summed from server
  targetMinutes: number;      // 480 (8h)
  activeTimer: ActiveTimer | null;  // from getActiveTimer()
};
```

Rendering:
- "Tracked today" label
- Large: "{Xh Ym} / 8h" (mono)
- Day progress bar (colored fill = today minutes / 480)
- If `activeTimer`:
  - Animated dot + task number + task title (truncated)
  - Live elapsed: `activeTimer.startedAt` → count up via setInterval 1000ms; show as mm:ss or h:mm:ss
  - Stop button: calls existing `stopTimeEntry(activeTimer.entryId)` server action → `router.refresh()`
- If no active timer:
  - Static row: "No active timer" + optional "Start a task" hint
- Empty state (todayMinutes=0, no timer): "0h 0m / 8h" — no error

ActiveTimer type from `lib/queries/time-entries.ts:302` — check actual fields (likely `id`, `taskId`, `taskTitle`, `taskNumber`, `startedAt`).

## Definition of done
- Renders with and without active timer
- Elapsed time ticks every second when timer is active
- Stop button calls action
- tsc clean
