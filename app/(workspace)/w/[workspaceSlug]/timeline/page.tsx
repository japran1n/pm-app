// F237 (AS-451, AS-452, AS-457, AS-458): workspace-wide timeline (Gantt-
// style) view -- every visible task rendered as a bar from start date to
// due date, positioned with CSS (absolute offsets computed by
// lib/timeline/layout.ts's pure pixels-per-day maths), no Gantt library.
//
// Server Component, data-fetching only (clarified "server-fetched ...
// passed down as typed props" pattern) -- getTimelineTasks
// (lib/queries/timeline.ts) does the real query through the RLS-scoped
// session client, so private-project visibility and archived/trash
// exclusion are enforced by the query itself, exactly like the calendar
// page (app/(workspace)/w/[workspaceSlug]/calendar/page.tsx) this page
// mirrors the structure of.
//
// State: the visible window's anchor month lives in the URL
// ("?month=YYYY-MM"), reusing lib/calendar/month-grid.ts's
// parseMonthKey/currentMonthKey/toMonthKey rather than a second
// "?month=" parser -- one URL convention shared by both date-scale
// views, per the clarified "simpler option, no second source of truth"
// answer. F240's own zoom-level switcher (AS-456, not this feature's
// assigned assertion) is the seam that will vary `pixelsPerDay`/the
// range width; this page passes both as plain values so that seam can be
// added without restructuring this file (mirrors month-grid.tsx's own
// documented seam for F234's client wrapper).
//
// Grouping (this feature's Notes "grouping rows by project or by
// assignee -- pick a default and keep it swappable"): rows are grouped
// by PROJECT, per the clarified ambiguity-resolution default (simpler
// option: `getTimelineTasks` already returns `projectId`/`projectName`
// on every row with no second query, whereas grouping by assignee would
// need a one-task-many-assignees fan-out decision this feature doesn't
// need to make). `groupTimelineTasksByProject` below is a small, pure,
// swappable step -- an assignee-grouping variant could be dropped in
// beside it later without touching the query or the layout maths.

import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUserTimezone } from "@/lib/queries/profile";
import { todayInTimeZone } from "@/lib/time/user-timezone";
import {
  getTimelineTasks,
  getUndatedTimelineTaskCount,
  getTimelineDependencyEdges,
  type TimelineTask,
} from "@/lib/queries/timeline";
import {
  currentMonthKey,
  nextMonthKey,
  parseMonthKey,
  previousMonthKey,
  toMonthKey,
} from "@/lib/calendar/month-grid";
import {
  isPlaceableOnTimeline,
  timelineRangeForZoom,
  resolveTimelineZoom,
  PIXELS_PER_DAY_BY_ZOOM,
  type TimelineZoomLevel,
} from "@/lib/timeline/layout";
import { TimelineScale } from "@/components/timeline/timeline-scale";
import { TimelineBody } from "@/components/timeline/timeline-body";
import { TimelineToolbar } from "@/components/timeline/timeline-toolbar";
import { Button } from "@/components/ui/button";

function groupTimelineTasksByProject(
  tasks: TimelineTask[],
): { projectId: string; projectName: string; tasks: TimelineTask[] }[] {
  const byProject = new Map<string, { projectId: string; projectName: string; tasks: TimelineTask[] }>();
  for (const task of tasks) {
    const existing = byProject.get(task.projectId);
    if (existing) {
      existing.tasks.push(task);
    } else {
      byProject.set(task.projectId, {
        projectId: task.projectId,
        projectName: task.projectName,
        tasks: [task],
      });
    }
  }
  return Array.from(byProject.values()).sort((a, b) => a.projectName.localeCompare(b.projectName));
}

export default async function TimelinePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ month?: string; zoom?: string }>;
}) {
  const { workspaceSlug } = await params;
  const { month: monthParam, zoom: zoomParam } = await searchParams;
  // F240 (AS-456): a stale/tampered `?zoom=` value degrades to the
  // default "month" zoom rather than erroring -- same posture
  // lib/calendar/resolve-filters.ts and lib/views/resolve-view.ts already
  // take for their own URL/saved-view params.
  const zoom: TimelineZoomLevel = resolveTimelineZoom(zoomParam);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // RLS-scoped lookup (workspaces_select_active_members) -- same
  // "reaching this route already means the caller is an active member"
  // fallback pattern the calendar/My Tasks pages use.
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  if (!workspace || !user) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Unable to load the timeline.
      </p>
    );
  }

  // AS-457: "today" for the timeline's own line is resolved from the
  // SAME per-user timezone helper the calendar/My Tasks/overdue badge
  // already share -- never a second "what day is it" implementation.
  const timezone = await getCurrentUserTimezone(supabase);
  const today = todayInTimeZone(timezone);

  const parsed = parseMonthKey(monthParam);
  const { year, month } = parsed ?? currentMonthKey(timezone);
  // F240 (AS-456): the anchor month is untouched by zoom -- only the
  // window WIDTH around it varies (see timelineRangeForZoom's own doc
  // comment) -- which is what "preserve the centre date across zoom"
  // requires: switching zoom never resets `year`/`month`.
  const { start, end } = timelineRangeForZoom(year, month, zoom);
  const pixelsPerDay = PIXELS_PER_DAY_BY_ZOOM[zoom];

  const tasks = await getTimelineTasks(workspace.id, start, end);
  const undatedCount = await getUndatedTimelineTaskCount(workspace.id);

  const prev = previousMonthKey(year, month);
  const next = nextMonthKey(year, month);
  const todayMonth = currentMonthKey(timezone);

  const hrefFor = (key: string) => `/w/${workspaceSlug}/timeline?month=${key}&zoom=${zoom}`;
  const hrefForZoom = (z: TimelineZoomLevel) =>
    `/w/${workspaceSlug}/timeline?month=${toMonthKey(year, month)}&zoom=${z}`;

  const placeable = tasks.filter((t) => isPlaceableOnTimeline(t));
  const groups = groupTimelineTasksByProject(placeable);

  // F239 (AS-455): fetched against the SAME `tasks` result this page
  // already has -- every id in `tasks` is already this caller's own
  // RLS + project-visibility-filtered set (getTimelineTasks's own doc
  // comment), so passing `tasks.map(t => t.id)` (not just the rendered
  // `placeable` subset) as `getTimelineDependencyEdges`'s
  // `visibleTaskIds` costs nothing extra and stays correct even though
  // only `placeable` tasks get a row (an edge touching a date-less task
  // in `tasks` is still correctly omitted downstream, in
  // `TimelineBody`, because that task has no row position -- never
  // fetched-then-discarded here).
  const dependencyEdges = await getTimelineDependencyEdges(tasks.map((t) => t.id));

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-lg font-semibold">Timeline</h1>
      <div className="flex flex-wrap items-center gap-2">
        <TimelineToolbar currentZoom={zoom} hrefForZoom={hrefForZoom} />
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={
            <Link href={hrefFor(toMonthKey(prev.year, prev.month))} aria-label="Previous month">
              &larr;
            </Link>
          }
        />
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href={hrefFor(toMonthKey(todayMonth.year, todayMonth.month))}>Today</Link>}
        />
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={
            <Link href={hrefFor(toMonthKey(next.year, next.month))} aria-label="Next month">
              &rarr;
            </Link>
          }
        />
      </div>
    </div>
  );

  if (groups.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <p
          className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
          data-testid="timeline-empty-message"
        >
          No tasks with a start or due date fall in this window.
        </p>
        <UndatedTimelineFooter count={undatedCount} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {header}
      {/* AS-458: ONE overflow-x-auto container holds both the scale
          header and every row's track, so scrolling never desyncs the
          date labels from the bars beneath them; the task-name column is
          `sticky left-0` OUTSIDE that scrolling axis (a plain flex row
          per task, not inside the scroll container), so it stays put
          while the date area scrolls underneath it -- the exact
          "sticky column, its own scrollable date area" shape this
          feature's Draft scope names. */}
      <div className="overflow-x-auto rounded-lg border" data-testid="timeline-scroll-container">
        <div className="flex min-w-max flex-col">
          <div className="flex">
            <div className="sticky left-0 z-20 w-56 shrink-0 border-b border-r bg-background" />
            <TimelineScale rangeStart={start} rangeEnd={end} today={today} pixelsPerDay={pixelsPerDay} zoom={zoom} />
          </div>
          {/* F238 (AS-454): drag/resize is the one client-side "island"
              this Server Component page needs -- TimelineBody owns the
              DndContext and calls the real editTask Server Action on
              drop, mirroring CalendarDayGrid's own client-wrapper seam
              (F234). Everything above (header, month nav, scale) stays
              server-rendered. */}
          <TimelineBody
            groups={groups}
            workspaceSlug={workspaceSlug}
            rangeStart={start}
            rangeEnd={end}
            today={today}
            pixelsPerDay={pixelsPerDay}
            dependencyEdges={dependencyEdges}
          />
        </div>
      </div>
      <UndatedTimelineFooter count={undatedCount} />
    </div>
  );
}

// Mirrors calendar/page.tsx's `UndatedTaskFooter` -- explains the "no
// start date and no due date" exclusion instead of a task silently
// vanishing. Zero-count renders nothing (no-op UI is noise, same
// convention).
function UndatedTimelineFooter({ count }: { count: number }) {
  if (count === 0) return null;

  return (
    <p
      className="text-center text-xs text-muted-foreground"
      data-testid="timeline-undated-task-count"
    >
      {count} task{count === 1 ? "" : "s"} {count === 1 ? "has" : "have"} no start or due
      date and {count === 1 ? "isn't" : "aren't"} shown on the timeline.
    </p>
  );
}
