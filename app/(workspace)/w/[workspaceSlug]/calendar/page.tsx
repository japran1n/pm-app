// F232 (AS-442, AS-443, AS-450): workspace-wide calendar month view --
// every visible task's due date positioned in a month grid, navigable to
// previous/next month and back to today, computed in the caller's own
// timezone.
//
// Server Component, data-fetching only (clarified "server-fetched ...
// passed down as typed props" pattern) -- getCalendarTasks
// (lib/queries/calendar.ts) does the real query through the RLS-scoped
// session client, so private-project visibility and archived/trash
// exclusion are enforced by the query itself, exactly like the My Tasks
// page (app/(workspace)/w/[workspaceSlug]/my-tasks/page.tsx) this page
// mirrors the structure of.
//
// State: the visible month lives in the URL ("?month=YYYY-MM"), per the
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
// uses). `hrefFor` below carries the CURRENT filters through every month
// navigation link, and `<CalendarFilters>`'s own Select writes never
// touch `month` -- both directions of "filters persist across
// navigation."

import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUserTimezone } from "@/lib/queries/profile";
import {
  getCalendarTasks,
  getUndatedTaskCount,
  getWorkspaceStatusOptions,
  type CalendarTask,
} from "@/lib/queries/calendar";
import { getWorkspaceProjects } from "@/lib/queries/projects";
import { getWorkspaceMembers } from "@/lib/queries/members";
import {
  buildCalendarMonth,
  currentMonthKey,
  monthDateRange,
  nextMonthKey,
  parseMonthKey,
  previousMonthKey,
  toMonthKey,
} from "@/lib/calendar/month-grid";
import { resolveCalendarFilters } from "@/lib/calendar/resolve-filters";
import { MonthGrid } from "@/components/calendar/month-grid";
import { CalendarFilters } from "@/components/calendar/calendar-filters";

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{
    month?: string;
    status?: string;
    priority?: string;
    assigneeId?: string;
    projectId?: string;
  }>;
}) {
  const { workspaceSlug } = await params;
  const {
    month: monthParam,
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
    // F124/AS-450: the viewer's timezone -- both which month opens by
    // default AND which day cell is "today" depend on it, same
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

  const parsed = parseMonthKey(monthParam);
  const { year, month } = parsed ?? currentMonthKey(timezone);

  const grid = buildCalendarMonth(year, month, timezone);
  const { start, end } = monthDateRange(year, month);

  // F235: the filter dropdowns' own real option sets -- also what a
  // stale/tampered URL value is validated against below. All three reads
  // are RLS-scoped (private projects/their columns never appear here for
  // a caller who can't see them, same visibility posture as the grid
  // query itself). `undatedCount` moved into `CalendarGridSection` (W9b)
  // since it's only needed once the grid itself streams in.
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

  const prev = previousMonthKey(year, month);
  const next = nextMonthKey(year, month);
  const today = currentMonthKey(timezone);

  // F235: every month-navigation link carries the CURRENT filters --
  // changing month never resets an active filter.
  const filterQuery = new URLSearchParams();
  if (filters.status) filterQuery.set("status", filters.status);
  if (filters.priority) filterQuery.set("priority", filters.priority);
  if (filters.assigneeId) filterQuery.set("assigneeId", filters.assigneeId);
  if (filters.projectId) filterQuery.set("projectId", filters.projectId);
  const filterSuffix = filterQuery.toString() ? `&${filterQuery.toString()}` : "";

  // B1 fix (AS-442, AS-443, AS-448): identity for the client grid's
  // internal optimistic-drag state, so a soft navigation (month <Link> or
  // a filter Select's router.push -- both keep this Server Component's
  // client child mounted) forces a real remount instead of leaving stale
  // `useState` data behind. See MonthGrid/CalendarDayGrid for the rest of
  // this fix and its AUTONOMOUS_DECISION writeup.
  const dataKey = `${toMonthKey(year, month)}${filterSuffix}`;

  const hrefFor = (key: string) =>
    `/w/${workspaceSlug}/calendar?month=${key}${filterSuffix}`;

  const hasActiveFilters = Boolean(
    filters.status || filters.priority || filters.assigneeId || filters.projectId,
  );

  const filtersBar = (
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
  );

  return (
    <div className="flex flex-col gap-3">
      {filtersBar}
      {/* Perf (W9b): the filters bar above only needs the option-set
          batch already resolved, not the grid's own task fetch -- the
          grid + undated-count footer stream in separately via Suspense
          instead of blocking the filters from appearing. */}
      <Suspense fallback={<div className="animate-pulse h-32 rounded-lg bg-muted" />}>
        <CalendarGridSection
          workspaceId={workspace.id}
          workspaceSlug={workspaceSlug}
          projectIds={projects.map((p) => p.id)}
          start={start}
          end={end}
          filters={filters}
          grid={grid}
          dataKey={dataKey}
          hrefFor={hrefFor}
          prev={prev}
          next={next}
          today={today}
          hasActiveFilters={hasActiveFilters}
        />
      </Suspense>
    </div>
  );
}

// Perf (W9b): extracted so the filters bar above can stream ahead of the
// grid's own task fetch this component owns -- see the `<Suspense>` call
// site in `CalendarPage` above for why.
async function CalendarGridSection({
  workspaceId,
  workspaceSlug,
  projectIds,
  start,
  end,
  filters,
  grid,
  dataKey,
  hrefFor,
  prev,
  next,
  today,
  hasActiveFilters,
}: {
  workspaceId: string;
  workspaceSlug: string;
  /** F009 (AS-019..AS-022): every project id visible to this caller in
   * this workspace -- threaded through to CalendarDayGrid's Realtime
   * client-side visibility backstop. */
  projectIds: string[];
  start: string;
  end: string;
  filters: ReturnType<typeof resolveCalendarFilters>["filters"];
  grid: ReturnType<typeof buildCalendarMonth>;
  dataKey: string;
  hrefFor: (key: string) => string;
  prev: { year: number; month: number };
  next: { year: number; month: number };
  today: { year: number; month: number };
  hasActiveFilters: boolean;
}) {
  // Perf (W9): undatedCount is batched here -- it only depends on
  // `workspaceId`, same as `getCalendarTasks`, not on the resolved
  // filters.
  const [tasks, undatedCount] = await Promise.all([
    getCalendarTasks(workspaceId, start, end, filters),
    getUndatedTaskCount(workspaceId),
  ]);

  // F233 (AS-446): tasks with no due date are excluded from the grid by
  // construction (getCalendarTasks's own `.not("due_date", "is", null)`
  // filter -- there is no chip anywhere for one) -- this count is what
  // explains that absence to the viewer instead of it just silently
  // dropping tasks. Workspace-wide, same visibility rules as the grid
  // itself (see getUndatedTaskCount's own doc comment). Deliberately
  // UNFILTERED by F235's own filters (out of this feature's own scope --
  // see this feature's handoff "Out-of-scope work needed"): it explains
  // an absence that has nothing to do with which filters are active.

  const tasksByDate = new Map<string, CalendarTask[]>();
  for (const task of tasks) {
    const list = tasksByDate.get(task.dueDate) ?? [];
    list.push(task);
    tasksByDate.set(task.dueDate, list);
  }

  if (tasks.length === 0) {
    return (
      <>
        <MonthGrid
          grid={grid}
          tasksByDate={tasksByDate}
          workspaceSlug={workspaceSlug}
          workspaceId={workspaceId}
          projectIds={projectIds}
          dataKey={dataKey}
          prevHref={hrefFor(toMonthKey(prev.year, prev.month))}
          nextHref={hrefFor(toMonthKey(next.year, next.month))}
          todayHref={hrefFor(toMonthKey(today.year, today.month))}
        />
        {/* AS-446 (F235's own assigned assertion): the empty grid itself
            already explains its absence of chips -- no dates without a
            due date are ever shown as chips, so there is nothing further
            to add here for this feature's own scope; the shared
            EmptyState pattern is a poor fit for "no tasks this month"
            since the grid itself is still the useful content. */}
        <p
          className="text-center text-sm text-muted-foreground"
          data-testid="calendar-empty-message"
        >
          {hasActiveFilters
            ? "No tasks match your filters this month."
            : "No tasks are due this month."}
        </p>
        <UndatedTaskFooter count={undatedCount} />
      </>
    );
  }

  return (
    <>
      <MonthGrid
        grid={grid}
        tasksByDate={tasksByDate}
        workspaceSlug={workspaceSlug}
        workspaceId={workspaceId}
        projectIds={projectIds}
        dataKey={dataKey}
        prevHref={hrefFor(toMonthKey(prev.year, prev.month))}
        nextHref={hrefFor(toMonthKey(next.year, next.month))}
        todayHref={hrefFor(toMonthKey(today.year, today.month))}
      />
      <UndatedTaskFooter count={undatedCount} />
    </>
  );
}

// F233 (AS-446): the explanation for why some tasks never appear on this
// page at all -- a task with no due date has nothing to place in a day
// cell, and would otherwise just silently vanish with no indication it
// exists. Zero-count renders nothing (a no-op "0 tasks" footer would be
// noise, same "no-op input, no unnecessary UI" convention this feature's
// clarified empty/zero-state answer describes for its mutations).
function UndatedTaskFooter({ count }: { count: number }) {
  if (count === 0) {
    return null;
  }

  return (
    <p
      className="text-center text-xs text-muted-foreground"
      data-testid="calendar-undated-task-count"
    >
      {count} task{count === 1 ? "" : "s"} {count === 1 ? "has" : "have"} no due
      date and {count === 1 ? "isn't" : "aren't"} shown on the calendar.
    </p>
  );
}
