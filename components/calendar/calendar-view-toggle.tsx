// Week/Planner follow-up: Month/Week toggle for the calendar page --
// plain Links that flip "?view=month|week", same URL-search-param-is-
// the-state convention month-grid.tsx's own month nav and calendar-
// filters.tsx's own Selects already use, so the toggle is itself
// shareable/bookmarkable and needs no client state.

import Link from "next/link";

import { Button } from "@/components/ui/button";

export function CalendarViewToggle({
  view,
  monthHref,
  weekHref,
}: {
  view: "month" | "week";
  monthHref: string;
  weekHref: string;
}) {
  return (
    <div
      className="inline-flex items-center gap-1 rounded-lg bg-muted p-[3px]"
      data-testid="calendar-view-toggle"
    >
      <Button
        variant={view === "month" ? "default" : "ghost"}
        size="sm"
        nativeButton={false}
        data-testid="calendar-view-toggle-month"
        render={<Link href={monthHref}>Month</Link>}
      />
      <Button
        variant={view === "week" ? "default" : "ghost"}
        size="sm"
        nativeButton={false}
        data-testid="calendar-view-toggle-week"
        render={<Link href={weekHref}>Week</Link>}
      />
    </div>
  );
}
