# F009: coming-up-card.tsx

**Milestone:** M2  **Time:** 20 min  **Depends on:** F001

## Assertions
AS-060, AS-061

## Clarified implementation
Create `components/dashboard/coming-up-card.tsx` (Server Component).

```tsx
type ComingUpCardProps = {
  blocks: CalendarBlock[];   // from lib/queries/calendar-blocks.ts, next ≤3
  workspaceSlug: string;
};
```

Rendering:
- Card header "Coming up" + link "Planner →"
- Each block row: time label (mono, e.g. "Today 14:00" or "Wed 23") | title | type subtitle (e.g. "Call · 30 min" if duration present)
- Format: if block is today → "Today HH:mm"; if this week → "EEE d" (Mon/Tue etc); else "d MMM"
- Empty state: "Nothing scheduled this week"

CalendarBlock type from `lib/queries/calendar-blocks.ts:23` — check fields (likely start_time, end_time, title, type).

## Definition of done
- Renders 3 blocks
- Renders empty state
- tsc clean
