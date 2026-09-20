// F088: the shared Planner header -- the week label, the URL-bound people
// switcher, the "add time off" affordance, and the prev/today/next week-nav
// controls. Previously this markup lived INSIDE WeekView, so it vanished
// whenever `resolvePlannerLayout` picked "stacked" (StackedPlanner has no
// header of its own) -- once a caller selected 2+ people, there was no way
// back to fewer without hand-editing the URL. Lifting it into page.tsx,
// rendered once ABOVE the layout branch, keeps it present for both
// "week-grid" and "stacked" alike.

import Link from "next/link";

import {
  PeopleSwitcherUrlBound,
  type PeopleSwitcherMember,
} from "@/components/calendar/people-switcher";
import { AddTimeOffDialog } from "@/components/calendar/add-time-off-dialog";
import { Button } from "@/components/ui/button";

export function PlannerHeader({
  rangeLabel,
  workspaceSlug,
  workspaceId,
  prevHref,
  nextHref,
  todayHref,
  peopleSwitcher,
}: {
  rangeLabel: string;
  workspaceSlug: string;
  workspaceId?: string;
  prevHref: string;
  nextHref: string;
  todayHref: string;
  /** F029 (AS-011, AS-012, AS-013, AS-059): props for the URL-bound people
   * switcher, threaded down from the page's own `?people=`/`?week=`
   * resolution -- same shape WeekView used to accept, unchanged. Optional/
   * omitted renders no switcher at all. */
  peopleSwitcher?: {
    members: PeopleSwitcherMember[];
    selectedUserIds: string[];
    selfId: string;
    weekParam?: string;
  };
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h1 className="font-mono text-2xl font-semibold" data-testid="calendar-week-label">
        {rangeLabel}
      </h1>
      <div className="flex items-center gap-1">
        {peopleSwitcher ? (
          <PeopleSwitcherUrlBound
            members={peopleSwitcher.members}
            selectedUserIds={peopleSwitcher.selectedUserIds}
            selfId={peopleSwitcher.selfId}
            workspaceSlug={workspaceSlug}
            weekParam={peopleSwitcher.weekParam}
          />
        ) : null}
        {workspaceId ? <AddTimeOffDialog workspaceId={workspaceId} /> : null}
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={
            <Link href={prevHref} aria-label="Previous week">
              &larr;
            </Link>
          }
        />
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href={todayHref}>Today</Link>}
        />
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={
            <Link href={nextHref} aria-label="Next week">
              &rarr;
            </Link>
          }
        />
      </div>
    </div>
  );
}
