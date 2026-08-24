// F232 (AS-442, AS-446(seam), AS-450): read path for the workspace-wide
// calendar month view -- every task with a due date inside the visible
// grid range (leading/trailing days from adjacent months included), for
// every project in the workspace the caller can see.
//
// AUTONOMOUS_DECISION (spec's Notes "Scope: workspace-wide with a project
// filter, or per project?" -- resolved per the clarified answer "Workspace-
// wide is the more useful default"): this query is workspace-scoped, not
// project-scoped. `projectId` is accepted as an OPTIONAL filter (unused by
// this feature's own page, but is the clean seam F235 (AS-448, active
// filters incl. assignee) is expected to extend rather than re-querying
// from scratch) -- passing it narrows to one project, omitting it returns
// every visible project's tasks, exactly like getMyTasks's own
// workspace-wide-with-optional-narrowing shape.
//
// Visibility (F322/F323's recurring bug class): this uses the plain
// RLS-scoped session client (`createClient()`), never
// `createAdminClient()` -- `tasks_select_active_members`'s existing
// `public.is_project_visible_to(project_id)` predicate
// (supabase/migrations/20260821140526_project_visibility_rls_sweep.sql)
// enforces private-project visibility for every row this query could
// possibly return, exactly as lib/queries/my-tasks.ts's own comment
// documents for the same reason. No admin-client bypass, no second
// hand-rolled visibility check needed or added.
//
// Archived projects / trashed tasks: excluded the same explicit way
// getMyTasks/getWorkspaceListTasks already do it -- `projects!inner(...,
// deleted_at)` + `.is("projects.deleted_at", null)` on the embed, plus
// `.is("deleted_at", null)` on the top-level `tasks` row.
//
// Statuses are per-project (F218-F223); `status_category` comes back via
// the same `project_statuses(category)` embed getMyTasks/getProjectBoardTasks
// use, so `isDoneStatus` (lib/tasks/status-category.ts) can be applied by
// callers without a literal 'done' string comparison anywhere in this file.
//
// AS-446 (F235's assigned assertion, not this feature's): tasks with a
// NULL due_date are excluded from the result set by the `.not("due_date",
// "is", null)` filter below by construction -- there is no separate
// "does this task have a due date" branch to duplicate or get out of sync
// with a UI-side filter, so F235 doesn't need to touch this query to
// preserve that behaviour, only to add its own assignee filter on top.
//
// Performance: one round trip, no per-day/per-task query -- every task
// due inside [rangeStart, rangeEnd] arrives in the single select below,
// and the caller (lib/calendar/month-grid.ts-driven page) buckets them by
// due_date client-side/server-side in memory, same "one query, bucket in
// TypeScript" shape as getMyTasks.

import { createClient } from "@/lib/supabase/server";
import { isDoneStatus } from "@/lib/tasks/status-category";
import { resolveAssignees } from "@/lib/queries/assignee-names";
// F235 (AS-448): reuses the exact same "resolve an assignee filter to the
// set of matching task ids" helper getWorkspaceListTasks
// (lib/queries/tasks.ts) already uses for the dashboard's own
// workspace-wide assignee filter -- same RLS-scoped `task_assignees`
// read, same dedup rule, no second implementation.
import { filterTaskIdsByAnyAssignee } from "@/lib/queries/tasks";
import type { DateOnly } from "@/lib/time/user-timezone";

export type CalendarAssignee = {
  id: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
};

export type CalendarTask = {
  id: string;
  title: string;
  status: string;
  statusCategory: string | null;
  isDone: boolean;
  priority: string | null;
  dueDate: DateOnly;
  number: number;
  projectId: string;
  projectKey: string | null;
  projectName: string;
  assignees: CalendarAssignee[];
};

function firstRelated<T>(relation: T | T[] | null | undefined): T | null {
  if (!relation) return null;
  return Array.isArray(relation) ? (relation[0] ?? null) : relation;
}

const TASK_SELECT_COLUMNS =
  "id, title, status, priority, due_date, number, project_id, deleted_at, " +
  "projects!inner(id, key, name, workspace_id, deleted_at), " +
  "project_statuses(category), " +
  "task_assignees(user_id)";

type CalendarTaskRow = {
  id: string;
  title: string;
  status: string;
  priority: string | null;
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

function toCalendarTask(
  row: CalendarTaskRow,
  assigneesByUserId: Map<string, CalendarAssignee>,
): CalendarTask {
  const project = firstRelated(row.projects);
  const category = firstRelated(row.project_statuses)?.category ?? null;
  const assignees: CalendarAssignee[] = (row.task_assignees ?? [])
    .map((a) => assigneesByUserId.get(a.user_id))
    .filter((a): a is CalendarAssignee => Boolean(a));

  return {
    id: row.id,
    title: row.title,
    status: row.status,
    statusCategory: category,
    isDone: isDoneStatus(row.status, category),
    priority: row.priority,
    // `due_date` is guaranteed non-null by the `.not("due_date", "is",
    // null)` filter this row was fetched through -- see getCalendarTasks.
    dueDate: row.due_date as DateOnly,
    number: row.number,
    projectId: row.project_id,
    projectKey: project?.key ?? null,
    projectName: project?.name ?? "",
    assignees,
  };
}

// F235 (AS-448): the calendar's own filter set -- reuses exactly the
// shape `<ListFilters>`/`WorkspaceListTaskFilters` already established
// (status/priority/assigneeId), plus `projectId`, the seam this query
// already carried from F232. Every field is optional/AND-combined, same
// "no filter = param absent" contract the List view's URL encoding uses.
//
// `status` (AS-448 cross-project note): the calendar spans projects with
// DIFFERENT `project_statuses` column sets (F218-F223) -- there is no
// fixed four-value status a cross-project filter could assume. This
// follows the SAME precedent F223 already established for the OTHER
// workspace-wide surface that has this exact problem
// (getWorkspaceListTasks, lib/queries/tasks.ts, and the dashboard status
// chart's `get_status_counts` RPC): filter on the column's real NAME,
// matched with a plain `.eq("status", name)` against `tasks.status`
// (kept byte-for-byte in sync with `project_statuses.name` by
// `sync_task_status_and_status_id`, see
// supabase/migrations/20260824010000_project_statuses.sql) -- so "Done"
// on one project's board and "Completed" on another's are two distinct
// filter values, never silently merged by CATEGORY the way the
// completedness/isDone computation is. A worker choosing to filter by
// "done-ness" instead picks a specific project's own "Done"-category
// column name, exactly as the dashboard chart's per-workspace status
// list already requires.
export type CalendarTaskFilters = {
  projectId?: string;
  /** A real `project_statuses.name` value -- see the cross-project note
   * above for why this is a name, not a category. */
  status?: string;
  priority?: string;
  assigneeId?: string;
};

/**
 * Every task due inside [rangeStart, rangeEnd] (both "YYYY-MM-DD",
 * inclusive) that the caller can see in `workspaceId`, narrowed by
 * `filters` (F235, AS-448) -- the real query path AS-442/AS-450/AS-448
 * are proven against (see this feature's handoff for the exact
 * integration test names).
 */
export async function getCalendarTasks(
  workspaceId: string,
  rangeStart: DateOnly,
  rangeEnd: DateOnly,
  filters?: CalendarTaskFilters,
): Promise<CalendarTask[]> {
  const supabase = await createClient();

  let query = supabase
    .from("tasks")
    .select(TASK_SELECT_COLUMNS)
    .eq("projects.workspace_id", workspaceId)
    .is("projects.deleted_at", null)
    .is("deleted_at", null)
    .not("due_date", "is", null)
    .gte("due_date", rangeStart)
    .lte("due_date", rangeEnd);

  if (filters?.projectId) {
    query = query.eq("project_id", filters.projectId);
  }
  if (filters?.status) {
    query = query.eq("status", filters.status);
  }
  if (filters?.priority) {
    query = query.eq("priority", filters.priority);
  }

  // F235 (AS-448): assignee narrows in the QUERY, not client-side --
  // resolved to a set of matching task ids up front (one batched read),
  // then folded into the same `tasks` query as an `.in("id", ...)`
  // filter, exactly like getWorkspaceListTasks's identical assignee
  // filter does for the dashboard's own workspace-wide task table.
  const assigneeTaskIds = await filterTaskIdsByAnyAssignee(
    supabase,
    filters?.assigneeId,
  );
  if (assigneeTaskIds !== null) {
    query = query.in("id", assigneeTaskIds);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as unknown as CalendarTaskRow[];

  // Performance: one batched resolve for every distinct assignee id
  // across the whole result set, not one lookup per task/per cell (the
  // same "resolvePeople batches with one .in(ids) query" convention
  // lib/queries/assignee-names.ts documents).
  const allUserIds = Array.from(
    new Set(rows.flatMap((r) => (r.task_assignees ?? []).map((a) => a.user_id))),
  );
  const resolved = allUserIds.length > 0 ? await resolveAssignees(allUserIds) : new Map();
  const assigneesByUserId = new Map<string, CalendarAssignee>();
  for (const [id, person] of resolved) {
    assigneesByUserId.set(id, {
      id,
      name: person.name,
      email: person.email,
      avatarUrl: person.avatarUrl,
    });
  }

  return rows.map((row) => toCalendarTask(row, assigneesByUserId));
}

// F233 (AS-446): tasks with a NULL due_date are excluded from the calendar
// grid by construction (getCalendarTasks's `.not("due_date", "is", null)`
// filter above), never shown as a chip anywhere -- but that absence needs
// an explanation on the page itself rather than silently vanishing. This
// is the count that explanation reads, computed with the exact same
// visibility/soft-delete/optional-project-narrowing shape as
// getCalendarTasks (same RLS-scoped session client -- never
// `createAdminClient()` -- so a private-project task the caller can't see
// is never counted, matching F322/F323's fix for the same query class).
//
// Performance: one `count: "exact", head: true` round trip -- no rows are
// fetched, matching the "one statement, never a per-row loop" budget.
export async function getUndatedTaskCount(
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

// F235 (AS-448): the status filter's dropdown options -- every DISTINCT
// column NAME across every project in the workspace the caller can see
// (RLS-scoped `project_statuses_select_visible`, same predicate as the
// tasks themselves -- see supabase/migrations/20260824010000_
// project_statuses.sql), deduplicated once here so a workspace with ten
// projects that all kept the default four columns doesn't show forty
// duplicate entries. Mirrors the exact "group on column NAME across
// projects" precedent `getStatusCounts` (lib/queries/dashboard.ts, F223)
// already established for the other workspace-wide surface with this
// same "no single fixed column set" problem -- first-seen color/category
// wins for a name that differs slightly between projects (matching a
// dropdown's own "one representative option per name" requirement; the
// REAL per-row category still comes from that row's own project_statuses
// join in getCalendarTasks/toCalendarTask, never from this list).
export type CalendarStatusOption = {
  name: string;
  color: string | null;
  category: string | null;
};

export async function getWorkspaceStatusOptions(
  workspaceId: string,
): Promise<CalendarStatusOption[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("project_statuses")
    .select("name, color, category, position, projects!inner(workspace_id, deleted_at)")
    .eq("projects.workspace_id", workspaceId)
    .is("projects.deleted_at", null)
    .order("position", { ascending: true });

  if (error) {
    throw error;
  }

  const byName = new Map<string, CalendarStatusOption>();
  for (const row of (data ?? []) as unknown as {
    name: string;
    color: string | null;
    category: string | null;
  }[]) {
    if (!byName.has(row.name)) {
      byName.set(row.name, {
        name: row.name,
        color: row.color,
        category: row.category,
      });
    }
  }

  return Array.from(byName.values());
}
