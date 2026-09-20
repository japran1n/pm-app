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
// F017 (AS-035): the status/priority/assignee/project filter bar and its
// URL-param resolver were deleted along with the rest of the task
// surface -- the Planner no longer has tasks to narrow, so
// `buildPlannerNavHrefs` below only ever carries the week itself through
// navigation links.

import { Suspense } from "react";

import { getCurrentUser, getRequestClient } from "@/lib/auth/current-user";
import { getCurrentUserTimezone } from "@/lib/queries/profile";
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
import { parsePeopleParam } from "@/lib/calendar/people-selection";
import { buildPlannerNavHrefs } from "@/lib/calendar/week-nav";
import { buildSwitcherMembers } from "@/lib/calendar/workspace-members";
import { resolvePlannerLayout } from "@/lib/calendar/planner-layout";
import { WeekView } from "@/components/calendar/week-view";
import { StackedPlanner } from "@/components/calendar/stacked-planner";
import type { CalendarBlock } from "@/lib/queries/calendar-blocks";

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{
    week?: string;
    people?: string;
  }>;
}) {
  const { workspaceSlug } = await params;
  const { week: weekParam, people: peopleParam } = await searchParams;

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
  // F029/F079 (AS-011): week navigation carries the raw `?people=` value
  // forward untouched -- never re-derived/re-serialized -- so a
  // stale-but-valid selection string round-trips exactly as given. ONE call
  // site, exactly once, so a mutation to that function's peopleParam
  // handling cannot be gamed by a local closure re-deriving hrefs.
  const { prevHref, nextHref, todayHref } = buildPlannerNavHrefs({
    workspaceSlug,
    currentWeekKey: weekKey,
    prevWeekKey: previousWeekKey(weekKey),
    nextWeekKey: nextWeekKey(weekKey),
    peopleParam,
  });

  // F087 (AS-052): ONE call, so the switcher's member list and the
  // `?people=` allowlist can never desync -- pending invites never reach
  // either.
  const { switcherMembers, activeMemberIds } = buildSwitcherMembers(workspaceMembers);

  // F029: the switcher's own current selection, resolved the same way any
  // other `?people=` consumer would (AS-059's empty-selection fallback to
  // `[selfId]` already lives inside parsePeopleParam itself).
  const selectedUserIds = parsePeopleParam(peopleParam, {
    selfId: user.id,
    activeMemberIds,
  });

  // F031 (AS-001, AS-023): layout is derived purely from how many people
  // are selected -- there is deliberately no `?view=` param (AS-015).
  const layout = resolvePlannerLayout(selectedUserIds.length);

  return (
    <div className="flex flex-col gap-3 p-6 pt-4 lg:p-8 lg:pt-8">
      <Suspense fallback={<div className="animate-pulse h-32 rounded-lg bg-muted" />}>
        <WeekGridSection
          workspaceId={workspace.id}
          workspaceSlug={workspaceSlug}
          start={weekRange.start}
          end={weekRange.end}
          week={week}
          prevHref={prevHref}
          nextHref={nextHref}
          todayHref={todayHref}
          // F031 (AS-001): fetch blocks for exactly the selected people --
          // no params means [selfId] alone, never the whole workspace.
          blockUserIds={selectedUserIds}
          layout={layout}
          weekKey={weekKey}
          // F020 (AS-046): the signed-in member's id, threaded all the
          // way down to WeekView/WeekTimeGrid/WeekAgenda so the single
          // `isOwnBlock` predicate (lib/calendar/ownership.ts) has what
          // it needs at every call site -- no component re-derives "is
          // this mine" independently.
          currentUserId={user.id}
          // F029 (AS-011, AS-012, AS-013, AS-059): the URL-bound people
          // switcher's own props -- see WeekView/people-switcher.tsx.
          peopleSwitcherMembers={switcherMembers}
          selectedUserIds={selectedUserIds}
          weekParam={weekParam}
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
  prevHref,
  nextHref,
  todayHref,
  blockUserIds,
  currentUserId,
  peopleSwitcherMembers,
  selectedUserIds,
  weekParam,
  layout,
  weekKey,
}: {
  workspaceId: string;
  workspaceSlug: string;
  start: string;
  end: string;
  week: ReturnType<typeof buildCalendarWeek>;
  prevHref: string;
  nextHref: string;
  todayHref: string;
  blockUserIds: string[];
  currentUserId: string;
  peopleSwitcherMembers: Array<{
    userId: string;
    name: string | null;
    email: string | null;
    avatarUrl: string | null;
  }>;
  selectedUserIds: string[];
  weekParam?: string;
  layout: "week-grid" | "stacked";
  weekKey: string;
}) {
  const rangeEndExclusive = new Date(`${end}T00:00:00.000Z`);
  rangeEndExclusive.setUTCDate(rangeEndExclusive.getUTCDate() + 1);

  const rangeEndExclusiveDateOnly = rangeEndExclusive.toISOString().slice(0, 10);

  // F016 (AS-034): the Planner no longer fetches tasks at all -- the
  // week grid renders blocks/time-off only.
  const [blocks, timeOffEntries] = await Promise.all([
    getCalendarBlocks(
      workspaceId,
      `${start}T00:00:00.000Z`,
      rangeEndExclusive.toISOString(),
      blockUserIds,
    ),
    getTimeOffEntries(workspaceId, start, rangeEndExclusiveDateOnly),
  ]);

  if (layout === "stacked") {
    // F031: one fetch for all selected people, bucketed by user in memory
    // (never one query per row) -- fleshed out in F032.
    const blocksByUser = new Map<string, CalendarBlock[]>();
    for (const block of blocks) {
      const existing = blocksByUser.get(block.userId);
      if (existing) {
        existing.push(block);
      } else {
        blocksByUser.set(block.userId, [block]);
      }
    }

    return (
      <StackedPlanner
        selectedUserIds={selectedUserIds}
        blocksByUser={blocksByUser}
        weekKey={weekKey}
      />
    );
  }

  return (
    <WeekView
      week={week}
      blocks={blocks}
      timeOffEntries={timeOffEntries}
      workspaceSlug={workspaceSlug}
      workspaceId={workspaceId}
      currentUserId={currentUserId}
      prevHref={prevHref}
      nextHref={nextHref}
      todayHref={todayHref}
      peopleSwitcher={{
        members: peopleSwitcherMembers,
        selectedUserIds,
        selfId: currentUserId,
        weekParam,
      }}
    />
  );
}
