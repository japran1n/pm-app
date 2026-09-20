// F031: minimal placeholder for the stacked (2+ people) Planner layout.
// Rendered when `resolvePlannerLayout` returns "stacked" -- i.e. 2 or more
// people are selected via `?people=`. F032 flesh this out into the real
// stacked time-grid view (per-person columns, clipped to the Mon-Fri
// 08:00-16:00 window via lib/calendar/stacked-window.ts).

import type { CalendarBlock } from "@/lib/queries/calendar-blocks";

export function StackedPlanner({
  selectedUserIds,
  blocksByUser,
  weekKey,
}: {
  selectedUserIds: string[];
  blocksByUser: Map<string, CalendarBlock[]>;
  weekKey: string;
}) {
  return (
    <div
      data-testid="stacked-planner"
      className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
    >
      Stacked planner for {selectedUserIds.length} people ({weekKey}) --
      coming soon.
      {/* blocksByUser threaded through for F032; not yet rendered */}
      <span className="sr-only">{blocksByUser.size} people with blocks</span>
    </div>
  );
}
