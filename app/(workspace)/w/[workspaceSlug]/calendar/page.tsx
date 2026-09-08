// Workspace-wide calendar -- Week is the ONLY view (month view was
// removed by product decision; there is no more Month/Week toggle).
// Every visible task's due date and every freeform Planner block for the
// visible 7-day window is positioned on a real time-grid, navigable to
// previous/next/today week, computed in the caller's own timezone.
//
// Server Component, data-fetching only (clarified "server-fetched ...
// passed down as typed props" pattern) -- getCalendarTasks
// (lib/queries/calendar.ts) does the real query through the RLS-scoped
// session client, so private-project visibility and archived/trash
// exclusion are enforced by the query itself, exactly like the My Tasks
// page (app/(workspace)/w/[workspaceSlug]/my-tasks/page.tsx) this page
// mirrors the structure of.
//
// State: the visible week lives in the URL ("?week=YYYY-MM-DD"), per the
// clarified "URL search params for anything shareable" answer -- so the
// calendar is linkable/shareable and server-rendered, no client state at
// all for this feature's own scope.
//
// F235 (AS-448, AS-449): status/priority/assignee/project filters, ALSO
// URL-encoded ("?status=&priority=&assigneeId=&projectId="), narrowed in
// the real getCalendarTasks query (never fetched-then-filtered
// client-side -- see that function's own doc comment for the assignee/
// status filter shapes), with a stale/tampered value dropped rather than
// applied or errored (resolveCalendarFilters, lib/calendar/resolve-
// filters.ts -- the same "validate against the real known set, drop
// silently" posture the project List page's own direct-filter-param path
// uses). `weekHrefFor` below carries the CURRENT filters through every
// week navigation link, and `<CalendarFilters>`'s own Select writes never
// touch `week` -- both directions of "filters persist across
// navigation."

import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUserTimezone } from "@/lib/queries/profile";
import { getCalendarTasks, getWorkspaceStatusOptions, type CalendarTask } from "@/lib/queries/calendar";
import { getCalendarBlocks } from "@/lib/queries/calendar-blocks";
import { getTimeOffEntries } from "@/lib/queries/time-off";
import { getWorkspaceProjects } from "@/lib/queries/projects";
import { getWorkspaceMembers } from "@/lib/queries/members";
import {
  buildCalendarWeek,
  currentWeekKey,
  nextWeekKey,
  parseWeekKey,
  previousWeekKey,
  weekDateRange,
} from "@/lib/calendar/week-grid";
import { resolveCalendarFilters } from "@/lib/calendar/resolve-filters";
import { WeekView } from "@/components/calendar/week-view";
import { CalendarFilters } from "@/components/calendar/calendar-filters";

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{
    week?: string;
    status?: string;
    priority?: string;
    assigneeId?: string;
    projectId?: string;
  }>;
}) {
  const { workspaceSlug } = await params;
  const {
    week: weekParam,
    status: statusParam,
    priority: priorityParam,
    assigneeId: assigneeIdParam,
    projectId: projectIdParam,
  } = await searchParams;

  const supabase = await createClient();

  // Perf (W9): auth, the workspace-by-slug lookup, and the caller's
  // timezone are independent of each other once `supabase` exists.
  const [
    {
      data: { user },
    },
    { data: workspace },
    timezone,
  ] = await Promise.all([
    supabase.auth.getUser(),
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
      <p className="rounded-lg border border-dashed p-8 text-center text-mini text-muted-foreground">
        Unable to load the calendar.
      </p>
    );
  }

  // F235: the filter dropdowns' own real option sets -- also what a
  // stale/tampered URL value is validated against below. All three reads
  // are RLS-scoped (private projects/their columns never appear here for
  // a caller who can't see them, same visibility posture as the grid
  // query itself).
  const [statusOptions, projects, workspaceMembers] = await Promise.all([
    getWorkspaceStatusOptions(workspace.id),
    getWorkspaceProjects(workspace.id),
    getWorkspaceMembers(workspace.id),
  ]);

  const { filters } = resolveCalendarFilters(
    {
      status: statusParam,
      priority: priorityParam,
      assigneeId: assigneeIdParam,
      projectId: projectIdParam,
    },
    {
      validStatusNames: new Set(statusOptions.map((s) => s.name)),
      validProjectIds: new Set(projects.map((p) => p.id)),
    },
  );

  // F235: every filter-changing navigation link carries the CURRENT
  // filters -- changing week never resets an active filter.
  const filterQuery = new URLSearchParams();
  if (filters.status) filterQuery.set("status", filters.status);
  if (filters.priority) filterQuery.set("priority", filters.priority);
  if (filters.assigneeId) filterQuery.set("assigneeId", filters.assigneeId);
  if (filters.projectId) filterQuery.set("projectId", filters.projectId);
  const filterSuffix = filterQuery.toString() ? `&${filterQuery.toString()}` : "";

  // Week is the ONLY view -- the "?week=" param resolves to that week, or
  // "today"'s own week if absent/invalid.
  const weekKey = parseWeekKey(weekParam) ?? currentWeekKey(timezone);
  const week = buildCalendarWeek(weekKey, timezone);
  const weekRange = weekDateRange(weekKey);
  const weekHrefFor = (key: string) =>
    `/w/${workspaceSlug}/calendar?week=${key}${filterSuffix}`;

  const filtersBar = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <CalendarFilters
        statusOptions={statusOptions.map((s) => ({
          value: s.name,
          label: s.name,
          color: s.color,
        }))}
        projectOptions={projects.map((p) => ({ value: p.id, label: p.name }))}
        assigneeOptions={workspaceMembers.active.map((m) => ({
          id: m.userId,
          label: m.name ?? m.email ?? m.userId,
          avatarUrl: m.avatarUrl,
        }))}
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      {filtersBar}
      {/* Perf (W9b): the filters bar above only needs the option-set
          batch already resolved, not the grid's own task fetch -- the
          grid streams in separately via Suspense instead of blocking the
          filters from appearing. */}
      <Suspense fallback={<div className="animate-pulse h-32 rounded-lg bg-muted" />}>
        <WeekGridSection
          workspaceId={workspace.id}
          workspaceSlug={workspaceSlug}
          start={weekRange.start}
          end={weekRange.end}
          filters={filters}
          week={week}
          weekKey={weekKey}
          weekHrefFor={weekHrefFor}
        />
      </Suspense>
    </div>
  );
}

// Streams behind the filters bar (same Suspense boundary the previous
// month grid used) -- reuses the SAME getCalendarTasks/getCalendarBlocks
// queries, bounded to the 7-day week window instead of a whole month.
async function WeekGridSection({
  workspaceId,
  workspaceSlug,
  start,
  end,
  filters,
  week,
  weekKey,
  weekHrefFor,
}: {
  workspaceId: string;
  workspaceSlug: string;
  start: string;
  end: string;
  filters: ReturnType<typeof resolveCalendarFilters>["filters"];
  week: ReturnType<typeof buildCalendarWeek>;
  weekKey: string;
  weekHrefFor: (key: string) => string;
}) {
  const rangeEndExclusive = new Date(`${end}T00:00:00.000Z`);
  rangeEndExclusive.setUTCDate(rangeEndExclusive.getUTCDate() + 1);

  const rangeEndExclusiveDateOnly = rangeEndExclusive.toISOString().slice(0, 10);

  const [tasks, blocks, timeOffEntries] = await Promise.all([
    getCalendarTasks(workspaceId, start, end, filters),
    getCalendarBlocks(workspaceId, `${start}T00:00:00.000Z`, rangeEndExclusive.toISOString()),
    getTimeOffEntries(workspaceId, start, rangeEndExclusiveDateOnly),
  ]);

  const tasksByDate = new Map<string, CalendarTask[]>();
  for (const task of tasks) {
    const list = tasksByDate.get(task.dueDate) ?? [];
    list.push(task);
    tasksByDate.set(task.dueDate, list);
  }

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
