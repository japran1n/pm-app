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
//
// F088: the Planner header (week label, week-nav controls, the URL-bound
// people switcher) is rendered ONCE here, ABOVE the "week-grid"/"stacked"
// layout branch -- see <PlannerHeader> below. It used to live inside
// WeekView alone, so it disappeared whenever `resolvePlannerLayout` picked
// "stacked" (StackedPlanner has no header of its own); multi-select was a
// one-way trip. See components/calendar/planner-header.tsx.

import { Suspense } from "react";

import { getCurrentUser, getRequestClient } from "@/lib/auth/current-user";
import { getCurrentUserTimezone } from "@/lib/queries/profile";
import { getCalendarBlocks } from "@/lib/queries/calendar-blocks";
import { getTimeOffEntries } from "@/lib/queries/time-off";
import type { TimeOffEntry } from "@/lib/queries/time-off";
import { getWorkspaceMembers } from "@/lib/queries/members";
import {
  buildCalendarWeek,
  currentWeekKey,
  formatWeekRangeLabel,
  nextWeekKey,
  parseWeekKey,
  previousWeekKey,
  weekDateRange,
} from "@/lib/calendar/week-grid";
import { parsePeopleParam } from "@/lib/calendar/people-selection";
import { buildPlannerNavHrefs } from "@/lib/calendar/week-nav";
import { buildBlockUserIds, buildSwitcherMembers } from "@/lib/calendar/workspace-members";
import type { SwitcherMember } from "@/lib/calendar/workspace-members";
import { resolvePlannerLayout } from "@/lib/calendar/planner-layout";
import { PlannerHeader } from "@/components/calendar/planner-header";
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
  // F112 (AS-014): the DEFAULT week (no "?week=" param) must resolve from
  // server time (UTC), not the viewer's own profile timezone -- otherwise
  // two viewers with different timezones can land on different default
  // weeks near a week boundary. `timezone` is still threaded to
  // `buildCalendarWeek` below for per-day "isToday" highlighting, which is
  // intentionally viewer-local.
  const weekKey = parseWeekKey(weekParam) ?? currentWeekKey("UTC");
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

  // F090 (AS-001, AS-059): go through the single helper that decides which
  // user ids the calendar-blocks query is scoped to -- never widened to
  // every workspace member, and never inlined so a dropped argument to
  // getCalendarBlocks(...) can't silently desync from this prop again.
  const blockUserIds = buildBlockUserIds(selectedUserIds);

  return (
    <div className="flex flex-col gap-3 p-6 pt-4 lg:p-8 lg:pt-8">
      {/* F088: rendered ONCE, above the layout branch, so the switcher
          (and nav/label) survive switching between "week-grid" and
          "stacked" instead of vanishing along with WeekView's own header. */}
      <PlannerHeader
        rangeLabel={formatWeekRangeLabel(week)}
        workspaceSlug={workspaceSlug}
        workspaceId={workspace.id}
        prevHref={prevHref}
        nextHref={nextHref}
        todayHref={todayHref}
        // F029 (AS-011, AS-012, AS-013, AS-059): the URL-bound people
        // switcher's own props -- these come straight from page-level
        // data (switcherMembers/selectedUserIds resolved above), never
        // from inside either layout branch.
        peopleSwitcher={{
          members: switcherMembers,
          selectedUserIds,
          selfId: user.id,
          weekParam,
        }}
      />
      <Suspense fallback={<div className="animate-pulse h-32 rounded-lg bg-muted" />}>
        <WeekGridSection
          workspaceId={workspace.id}
          workspaceSlug={workspaceSlug}
          start={weekRange.start}
          end={weekRange.end}
          week={week}
          // F031 (AS-001): fetch blocks for exactly the selected people --
          // no params means [selfId] alone, never the whole workspace.
          blockUserIds={blockUserIds}
          layout={layout}
          weekKey={weekKey}
          // F020 (AS-046): the signed-in member's id, threaded all the
          // way down to WeekView/WeekTimeGrid/WeekAgenda so the single
          // `isOwnBlock` predicate (lib/calendar/ownership.ts) has what
          // it needs at every call site -- no component re-derives "is
          // this mine" independently.
          currentUserId={user.id}
          // F032 (AS-062): the same switcher member list, reused so the
          // stacked layout's row labels and the switcher can never desync.
          peopleSwitcherMembers={switcherMembers}
          selectedUserIds={selectedUserIds}
          // F035: needed by StackedPlanner's own drag-to-reorder persistence
          // (router.replace back to this same URL shape) -- unrelated to
          // F088's header lift, kept intact from that feature's own wiring.
          weekParam={weekParam}
        />
      </Suspense>
    </div>
  );
}

// Streams behind the grid's own Suspense boundary -- reuses the SAME
// getCalendarBlocks/getTimeOffEntries queries, bounded to the 7-day week
// window. F088: no longer receives/threads prevHref/nextHref/todayHref/
// weekParam -- those feed the shared <PlannerHeader> in the parent above,
// not this section's own layout branch.
async function WeekGridSection({
  workspaceId,
  workspaceSlug,
  start,
  end,
  week,
  blockUserIds,
  currentUserId,
  peopleSwitcherMembers,
  selectedUserIds,
  layout,
  weekKey,
  weekParam,
}: {
  workspaceId: string;
  workspaceSlug: string;
  start: string;
  end: string;
  week: ReturnType<typeof buildCalendarWeek>;
  blockUserIds: string[];
  currentUserId: string;
  peopleSwitcherMembers: SwitcherMember[];
  selectedUserIds: string[];
  layout: "week-grid" | "stacked";
  weekKey: string;
  weekParam?: string;
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

    // F034 (AS-066): bucket time-off entries by user, mirroring
    // blocksByUser above, so each row can render its own strip.
    const timeOffByUser = new Map<string, TimeOffEntry[]>();
    for (const entry of timeOffEntries) {
      const existing = timeOffByUser.get(entry.userId);
      if (existing) {
        existing.push(entry);
      } else {
        timeOffByUser.set(entry.userId, [entry]);
      }
    }

    return (
      <StackedPlanner
        selectedUserIds={selectedUserIds}
        blocksByUser={blocksByUser}
        timeOffByUser={timeOffByUser}
        weekKey={weekKey}
        members={peopleSwitcherMembers}
        // F035: reorder persistence -- unrelated to F088's header lift,
        // kept so this fix doesn't regress drag-to-reorder.
        workspaceSlug={workspaceSlug}
        selfId={currentUserId}
        weekParam={weekParam}
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
    />
  );
}
