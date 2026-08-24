// F237 (AS-451, AS-452): read path for the workspace-wide timeline view --
// every task whose [start_date, due_date] interval overlaps the visible
// range (F236's `tasks.start_date` + the existing `tasks.due_date`), for
// every project in the workspace the caller can see. Mirrors
// lib/queries/calendar.ts's own getCalendarTasks structure closely (same
// select shape, same visibility/archive/trash posture) -- deliberately
// NOT a copy-paste of that file's exports, since the timeline's range
// filter is an INTERVAL overlap test (start..due can straddle the window
// on either edge), not calendar's single-column due_date range test.
//
// Visibility (F322/F323's recurring bug class): plain RLS-scoped session
// client (`createClient()`), never `createAdminClient()` --
// `tasks_select_active_members`'s existing
// `public.is_project_visible_to(project_id)` predicate
// (supabase/migrations/20260821140526_project_visibility_rls_sweep.sql)
// enforces private-project visibility for every row this query could
// possibly return. No admin-client bypass, no second hand-rolled
// visibility check.
//
// Archived projects / trashed tasks: excluded the same explicit way
// getCalendarTasks/getMyTasks already do it -- `projects!inner(...,
// deleted_at)` + `.is("projects.deleted_at", null)` on the embed, plus
// `.is("deleted_at", null)` on the top-level `tasks` row.
//
// Statuses are per-project (F218-F223); `status_category` comes back via
// the same `project_statuses(category)` embed getCalendarTasks uses, so
// `isDoneStatus` (lib/tasks/status-category.ts) can be applied without a
// literal 'done' string comparison anywhere in this file.
//
// A task with NEITHER start_date nor due_date has nothing to place on the
// timeline and is excluded by the `.or("start_date.not.is.null,due_date.
// not.is.null")` filter below -- see lib/timeline/layout.ts's
// `isPlaceableOnTimeline` for the corresponding client-side rule (kept
// here too as defense-in-depth against a future caller reusing this
// query without going through the layout module first).
//
// Performance: one round trip, no per-row/per-bar query -- the interval
// overlap test (`start_date <= rangeEnd AND due_date >= rangeStart`,
// treating a null start/due as "unbounded on that side" since a task
// with only one date is a single-day marker, not a half-open interval
// that could still overlap from the other direction) is expressed
// entirely in the PostgREST `.or()` filter below, never fetched-then-
// filtered client-side.

import { createClient } from "@/lib/supabase/server";
import { isDoneStatus } from "@/lib/tasks/status-category";
import { resolveAssignees } from "@/lib/queries/assignee-names";
import type { DateOnly } from "@/lib/time/user-timezone";

export type TimelineAssignee = {
  id: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
};

export type TimelineTask = {
  id: string;
  title: string;
  status: string;
  statusCategory: string | null;
  isDone: boolean;
  priority: string | null;
  startDate: DateOnly | null;
  dueDate: DateOnly | null;
  number: number;
  projectId: string;
  projectKey: string | null;
  projectName: string;
  assignees: TimelineAssignee[];
};

function firstRelated<T>(relation: T | T[] | null | undefined): T | null {
  if (!relation) return null;
  return Array.isArray(relation) ? (relation[0] ?? null) : relation;
}

const TASK_SELECT_COLUMNS =
  "id, title, status, priority, start_date, due_date, number, project_id, deleted_at, " +
  "projects!inner(id, key, name, workspace_id, deleted_at), " +
  "project_statuses(category), " +
  "task_assignees(user_id)";

type TimelineTaskRow = {
  id: string;
  title: string;
  status: string;
  priority: string | null;
  start_date: string | null;
  due_date: string | null;
  number: number;
  project_id: string;
  projects:
    | { id: string; key: string | null; name: string }
    | { id: string; key: string | null; name: string }[]
    | null;
  project_statuses: { category: string } | { category: string }[] | null;
  task_assignees: { user_id: string }[] | null;
};

function toTimelineTask(
  row: TimelineTaskRow,
  assigneesByUserId: Map<string, TimelineAssignee>,
): TimelineTask {
  const project = firstRelated(row.projects);
  const category = firstRelated(row.project_statuses)?.category ?? null;
  const assignees: TimelineAssignee[] = (row.task_assignees ?? [])
    .map((a) => assigneesByUserId.get(a.user_id))
    .filter((a): a is TimelineAssignee => Boolean(a));

  return {
    id: row.id,
    title: row.title,
    status: row.status,
    statusCategory: category,
    isDone: isDoneStatus(row.status, category),
    priority: row.priority,
    startDate: row.start_date as DateOnly | null,
    dueDate: row.due_date as DateOnly | null,
    number: row.number,
    projectId: row.project_id,
    projectKey: project?.key ?? null,
    projectName: project?.name ?? "",
    assignees,
  };
}

export type TimelineTaskFilters = {
  projectId?: string;
};

/**
 * Every task whose [start_date, due_date] interval overlaps
 * [rangeStart, rangeEnd] (both "YYYY-MM-DD", inclusive) that the caller
 * can see in `workspaceId` -- the real query path AS-451/AS-452 are
 * proven against (see this feature's handoff for the exact integration
 * test names).
 */
export async function getTimelineTasks(
  workspaceId: string,
  rangeStart: DateOnly,
  rangeEnd: DateOnly,
  filters?: TimelineTaskFilters,
): Promise<TimelineTask[]> {
  const supabase = await createClient();

  let query = supabase
    .from("tasks")
    .select(TASK_SELECT_COLUMNS)
    .eq("projects.workspace_id", workspaceId)
    .is("projects.deleted_at", null)
    .is("deleted_at", null)
    // Interval-overlap test against the visible window. A task with only
    // one of the two dates set is a single-day point at that date (both
    // sides of the AND collapse to the same column), so the SAME filter
    // correctly captures range bars, markers, and every task-with-no-
    // date exclusion (final "not.is.null" leg) in one round trip.
    .or(
      `and(due_date.not.is.null,due_date.gte.${rangeStart},due_date.lte.${rangeEnd}),` +
        `and(start_date.not.is.null,start_date.gte.${rangeStart},start_date.lte.${rangeEnd}),` +
        `and(start_date.not.is.null,due_date.not.is.null,start_date.lte.${rangeStart},due_date.gte.${rangeEnd})`,
    );

  if (filters?.projectId) {
    query = query.eq("project_id", filters.projectId);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as unknown as TimelineTaskRow[];

  // Performance: one batched resolve for every distinct assignee id
  // across the whole result set, matching getCalendarTasks's identical
  // "one .in(ids) query, never per-row" convention.
  const allUserIds = Array.from(
    new Set(rows.flatMap((r) => (r.task_assignees ?? []).map((a) => a.user_id))),
  );
  const resolved = allUserIds.length > 0 ? await resolveAssignees(allUserIds) : new Map();
  const assigneesByUserId = new Map<string, TimelineAssignee>();
  for (const [id, person] of resolved) {
    assigneesByUserId.set(id, {
      id,
      name: person.name,
      email: person.email,
      avatarUrl: person.avatarUrl,
    });
  }

  return rows.map((row) => toTimelineTask(row, assigneesByUserId));
}

// AS-451/452's own "excluded entirely" case: a task with NEITHER a start
// nor a due date has nowhere to be placed on the timeline. Mirrors
// lib/queries/calendar.ts's `getUndatedTaskCount` shape exactly (same
// RLS-scoped session client, same archived/trash exclusion), so the
// timeline's own footer can explain the same kind of absence the
// calendar already does, rather than a task silently vanishing with no
// indication it exists.
export async function getUndatedTimelineTaskCount(
  workspaceId: string,
  projectId?: string,
): Promise<number> {
  const supabase = await createClient();

  let query = supabase
    .from("tasks")
    .select("id, projects!inner(workspace_id, deleted_at)", {
      count: "exact",
      head: true,
    })
    .eq("projects.workspace_id", workspaceId)
    .is("projects.deleted_at", null)
    .is("deleted_at", null)
    .is("start_date", null)
    .is("due_date", null);

  if (projectId) {
    query = query.eq("project_id", projectId);
  }

  const { count, error } = await query;

  if (error) {
    throw error;
  }

  return count ?? 0;
}
