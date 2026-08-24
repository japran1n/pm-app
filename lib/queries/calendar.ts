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

/**
 * Every task due inside [rangeStart, rangeEnd] (both "YYYY-MM-DD",
 * inclusive) that the caller can see in `workspaceId` -- the real query
 * path AS-442/AS-450 are proven against (see this feature's handoff for
 * the exact integration test names).
 */
export async function getCalendarTasks(
  workspaceId: string,
  rangeStart: DateOnly,
  rangeEnd: DateOnly,
  // Optional narrowing seam for F235 (AS-448) -- unused by this
  // feature's own page.
  projectId?: string,
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

  if (projectId) {
    query = query.eq("project_id", projectId);
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
