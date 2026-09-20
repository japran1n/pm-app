// Workspace-wide calendar -- Week is the ONLY view (month view was
// removed by product decision; there is no more Month/Week toggle).
// Freeform Planner blocks and time-off entries for the visible 7-day
// window are positioned on a real time-grid, navigable to
// previous/next/today week, computed in the caller's own timezone.
//
// Server Component, data-fetching only (clarified "server-fetched ...
// passed down as typed props" pattern), exactly like the My Tasks
// page (app/(workspace)/w/[workspaceSlug]/my-tasks/page.tsx) this page
// mirrors the structure of.
//
// State: the visible week lives in the URL ("?week=YYYY-MM-DD"), per the
// clarified "URL search params for anything shareable" answer -- so the
// calendar is linkable/shareable and server-rendered, no client state at
// all for this feature's own scope.
//
// F017 (AS-035): the status/priority/assignee/project filter bar
// (`<CalendarFilters>`) and its URL-param resolver (resolveCalendarFilters,
// lib/calendar/resolve-filters.ts) were deleted along with the rest of the
// task surface -- the Planner no longer has tasks to narrow, so
// `weekHrefFor` below only ever carries the week itself through
// navigation links.

import { Suspense } from "react";

import { getCurrentUser, getRequestClient } from "@/lib/auth/current-user";
import { getCurrentUserTimezone } from "@/lib/queries/profile";
import { type CalendarTask } from "@/lib/queries/calendar";
import { getCalendarBlocks } from "@/lib/queries/calendar-blocks";
import { getTimeOffEntries } from "@/lib/queries/time-off";
import { getWorkspaceMembers } from "@/lib/queries/members";
import {
  buildCalendarWeek,
  currentWeekKey,
  nextWeekKey,
  parseWeekKey,
  previousWeekKey,
  weekDateRange,
} from "@/lib/calendar/week-grid";
import { WeekView } from "@/components/calendar/week-view";

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{
    week?: string;
  }>;
}) {
  const { workspaceSlug } = await params;
  const { week: weekParam } = await searchParams;

  const supabase = await getRequestClient();

  // Perf (W9): auth, the workspace-by-slug lookup, and the caller's
  // timezone are independent of each other once `supabase` exists.
  const [
    { user },
    { data: workspace },
    timezone,
  ] = await Promise.all([
    getCurrentUser(),
    // RLS-scoped lookup (workspaces_select_active_members) -- same
    // "reaching this route already means the caller is an active member"
    // fallback pattern the My Tasks page uses one level up.
    supabase.from("workspaces").select("id").eq("slug", workspaceSlug).maybeSingle(),
    // F124/AS-450: the viewer's timezone -- both which week opens by
    // default AND which day column is "today" depend on it, same
    // "resolve once, thread down" convention the My Tasks page follows.
    getCurrentUserTimezone(supabase),
  ]);

  if (!workspace || !user) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Unable to load the calendar.
      </p>
    );
  }

  const workspaceMembers = await getWorkspaceMembers(workspace.id);

  // Week is the ONLY view -- the "?week=" param resolves to that week, or
  // "today"'s own week if absent/invalid.
  const weekKey = parseWeekKey(weekParam) ?? currentWeekKey(timezone);
  const week = buildCalendarWeek(weekKey, timezone);
  const weekRange = weekDateRange(weekKey);
  const weekHrefFor = (key: string) => `/w/${workspaceSlug}/calendar?week=${key}`;

  return (
    <div className="flex flex-col gap-3 p-6 pt-4 lg:p-8 lg:pt-8">
      <Suspense fallback={<div className="animate-pulse h-32 rounded-lg bg-muted" />}>
        <WeekGridSection
          workspaceId={workspace.id}
          workspaceSlug={workspaceSlug}
          start={weekRange.start}
          end={weekRange.end}
          week={week}
          weekKey={weekKey}
          weekHrefFor={weekHrefFor}
          // F012: getCalendarBlocks now takes an explicit userIds
          // restriction. The real "?people=" selection lands in F013 --
          // until then, every active member preserves today's
          // whole-workspace behaviour.
          blockUserIds={workspaceMembers.active.map((m) => m.userId)}
        />
      </Suspense>
    </div>
  );
}

// Streams behind the grid's own Suspense boundary -- reuses the SAME
// getCalendarBlocks/getTimeOffEntries queries, bounded to the 7-day week
// window.
async function WeekGridSection({
  workspaceId,
  workspaceSlug,
  start,
  end,
  week,
  weekKey,
  weekHrefFor,
  blockUserIds,
}: {
  workspaceId: string;
  workspaceSlug: string;
  start: string;
  end: string;
  week: ReturnType<typeof buildCalendarWeek>;
  weekKey: string;
  weekHrefFor: (key: string) => string;
  blockUserIds: string[];
}) {
  const rangeEndExclusive = new Date(`${end}T00:00:00.000Z`);
  rangeEndExclusive.setUTCDate(rangeEndExclusive.getUTCDate() + 1);

  const rangeEndExclusiveDateOnly = rangeEndExclusive.toISOString().slice(0, 10);

  // F016 (AS-034): the Planner no longer fetches tasks at all -- the
  // week grid renders blocks/time-off only. `tasksByDate` stays an empty
  // Map (not removed as a WeekView prop yet -- that's F015's job) so the
  // grid keeps rendering while the UI removal lands separately.
  const [blocks, timeOffEntries] = await Promise.all([
    getCalendarBlocks(
      workspaceId,
      `${start}T00:00:00.000Z`,
      rangeEndExclusive.toISOString(),
      blockUserIds,
    ),
    getTimeOffEntries(workspaceId, start, rangeEndExclusiveDateOnly),
  ]);

  const tasksByDate = new Map<string, CalendarTask[]>();

  return (
    <WeekView
      week={week}
      tasksByDate={tasksByDate}
      blocks={blocks}
      timeOffEntries={timeOffEntries}
      workspaceSlug={workspaceSlug}
      workspaceId={workspaceId}
      prevHref={weekHrefFor(previousWeekKey(weekKey))}
      nextHref={weekHrefFor(nextWeekKey(weekKey))}
      todayHref={`/w/${workspaceSlug}/calendar`}
    />
  );
}
