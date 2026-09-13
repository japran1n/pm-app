// F230 (AS-435, AS-436, AS-439): read path for the My Tasks page —
// every task assigned to the caller, across every project the caller can
// see in one workspace, bucketed into overdue/today/thisWeek/later.
//
// Correctness notes (see this feature's spec for the full rationale):
//
// - Assignment is many-to-many (`task_assignees`, F159), never the
//   deprecated single `tasks.assignee_id` column -- same convention
//   `filterTaskIdsByAnyAssignee` (lib/queries/tasks.ts) already
//   established. This query filters via an INNER embed
//   `task_assignees!inner(user_id)` narrowed with
//   `.eq("task_assignees.user_id", userId)`, mirroring
//   `getWorkspaceListTasks`'s existing `projects!inner(...)` +
//   `.eq("projects.workspace_id", ...)` dotted-embed-filter pattern in
//   this same file's sibling function. Because the embed is used only to
//   FILTER (never to SELECT every assignee row), a multi-assignee task
//   still comes back as exactly one `tasks` row -- there is no
//   fan-out/duplication to dedupe, unlike `getProjectBoardTasks`'s
//   `assignee_ids` array embed, which selects (not just filters) the
//   join table.
//
// - Statuses are per-project (`project_statuses`, F218-F223). This query
//   never assumes the fixed four; "done" is decided purely by
//   `project_statuses.category` via `lib/tasks/status-category.ts`'s
//   `isDoneStatus` (never a literal `status === "done"` comparison) --
//   same rule the board/list views already apply post-F222.
//
// - Visibility: this is a cross-project, cross-workspace-membership-only
//   query, so it MUST NOT leak a private project's tasks to a caller who
//   is merely an active workspace member without project access. This
//   uses the plain RLS-scoped session client (`createClient()`, never
//   `createAdminClient()`), so `tasks_select_active_members`'s existing
//   `public.is_project_visible_to(project_id)` predicate
//   (supabase/migrations/20260821140526_project_visibility_rls_sweep.sql)
//   already enforces private-project visibility for every row this query
//   could possibly return -- there is no admin-client bypass here for
//   F322/F323's bug class to recur through, and no second visibility
//   check needs to be (or should be) re-implemented in application code
//   on top of it (`isProjectVisibleToCaller` is for admin-client call
//   sites only, per its own doc comment -- this query is not one).
//
// - Archived projects and trashed tasks: excluded the same way
//   `getWorkspaceListTasks` already does it (`projects!inner(...,
//   deleted_at)` + `.is("projects.deleted_at", null)` +
//   `.is("deleted_at", null)` on the top-level `tasks` row) rather than
//   reaching for the `active_project_tasks` view -- that view doesn't
//   expose the `projects`/`project_statuses` embeds this query needs, and
//   duplicating its two-predicate exclusion inline here matches the
//   sibling `getWorkspaceListTasks` function's own existing approach one
//   screen up in this same file, not a new pattern.
//
// - Performance: one round trip, no per-row query -- project key/name and
//   status category arrive via the same embedded select as the board/list
//   queries.

import { createClient } from "@/lib/supabase/server";
import { isDoneStatus } from "@/lib/tasks/status-category";
import { bucketForDueDate, type MyTasksBucket } from "@/lib/my-tasks/bucket";
// Portal-parity fix (My Tasks Type/Estimate/Logged columns): the exact
// same batched logged-minutes helper the project List view/dashboard table
// use (lib/queries/tasks.ts) — one round trip for the whole page, never a
// per-row fetch.
import { getTaskLoggedMinutes } from "@/lib/queries/time-entries";

export type MyTaskRow = {
  id: string;
  title: string;
  status: string;
  statusCategory: string | null;
  priority: string | null;
  dueDate: string | null;
  number: number;
  projectId: string;
  projectKey: string | null;
  projectName: string;
  isDone: boolean;
  bucket: MyTasksBucket;
  // F231 (AS-441): true when this row is included because the caller
  // watches it (via task_watchers), whether or not they are also
  // assigned -- lets the UI visually distinguish watched-only rows from
  // assigned ones per the clarified "watched tasks should be visually
  // distinguishable" answer. A task the caller is BOTH assigned to AND
  // watches still appears exactly once (isAssigned && isWatched both
  // true), never as two rows.
  isWatched: boolean;
  isAssigned: boolean;
  // F083: same client-visibility/awaiting-client fields the board/list
  // TaskCards carry (TaskCardTask.clientVisible/pendingClientApproval) —
  // "which of my tasks is the client watching" is exactly the question
  // My Tasks needs to answer without opening every row.
  clientVisible: boolean;
  pendingClientApproval: boolean;
  // Portal-parity fix (My Tasks Type/Estimate/Logged columns): the same
  // three fields TaskListTable's row already carries (task-list-table.tsx),
  // so <MyTaskRowItem> can render the identical <ListTaskTypeSelect> and
  // estimate/logged cells rather than a lookalike.
  taskType: { id: string; name: string; color: string } | null;
  estimateMinutes: number | null;
  totalMinutes: number;
};

export type MyTasksBuckets = {
  overdue: MyTaskRow[];
  today: MyTaskRow[];
  thisWeek: MyTaskRow[];
  later: MyTaskRow[];
};

function firstRelated<T>(relation: T | T[] | null | undefined): T | null {
  if (!relation) return null;
  return Array.isArray(relation) ? (relation[0] ?? null) : relation;
}

const TASK_SELECT_COLUMNS =
  // F083: `client_visible, pending_client_approval` added — see
  // MyTaskRow.clientVisible/pendingClientApproval's own comment.
  // Portal-parity fix: `estimate_minutes, task_type_id, task_types(...)`
  // added so this row carries the same Type/Estimate data TaskListTable's
  // row already does — see MyTaskRow.taskType/estimateMinutes comments.
  "id, title, status, status_id, priority, due_date, number, project_id, deleted_at, client_visible, pending_client_approval, estimate_minutes, task_type_id, projects!inner(id, key, name, workspace_id, deleted_at), project_statuses(category), task_types(id, name, color)";

function toRow(
  task: {
    id: string;
    title: string;
    status: string;
    priority: string | null;
    due_date: string | null;
    number: number;
    project_id: string;
    client_visible?: boolean | null;
    pending_client_approval?: boolean | null;
    estimate_minutes?: number | null;
    projects: { id: string; key: string | null; name: string } | { id: string; key: string | null; name: string }[] | null;
    project_statuses: { category: string } | { category: string }[] | null;
    task_types?:
      | { id: string; name: string; color: string }
      | { id: string; name: string; color: string }[]
      | null;
  },
  timeZone: string,
  loggedMinutes: number,
): MyTaskRow {
  const project = firstRelated(task.projects);
  const category = firstRelated(task.project_statuses)?.category ?? null;
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    statusCategory: category,
    priority: task.priority,
    dueDate: task.due_date,
    number: task.number,
    projectId: task.project_id,
    projectKey: project?.key ?? null,
    projectName: project?.name ?? "",
    isDone: isDoneStatus(task.status, category),
    bucket: bucketForDueDate(task.due_date, timeZone),
    isWatched: false,
    isAssigned: false,
    clientVisible: task.client_visible ?? false,
    pendingClientApproval: task.pending_client_approval ?? false,
    taskType: firstRelated(task.task_types) ?? null,
    estimateMinutes: task.estimate_minutes ?? null,
    totalMinutes: loggedMinutes,
  };
}

export async function getMyTasks(
  workspaceId: string,
  userId: string,
  timeZone: string,
  // F231 (AS-441): when true, also merges in tasks the caller watches
  // (task_watchers, F163) that they are not necessarily assigned to. A
  // task that is both assigned AND watched still appears exactly once,
  // with both `isAssigned` and `isWatched` set. Defaults to false so
  // F230's already-proven assigned-only behaviour (AS-435/436/439) is
  // unchanged for existing callers.
  includeWatched = false,
): Promise<MyTasksBuckets> {
  const supabase = await createClient();

  // F011 (AS-010, AS-011): drive this from `task_assignees` filtered by
  // `user_id` instead of scanning every RLS-visible task and filtering
  // down via a `task_assignees!inner` join predicate. `task_assignees.user_id`
  // is indexed, so `.eq("user_id", userId)` here narrows to this caller's
  // handful of assignment rows first; the embedded `tasks!inner(...)` then
  // joins through to the task exactly like the previous shape did, so the
  // returned columns/order are unchanged -- only the outer scan direction
  // is reversed (assignee-row-driven, not task-row-driven).
  const { data: assignedRows, error } = await supabase
    .from("task_assignees")
    .select(`task_id, tasks!inner(${TASK_SELECT_COLUMNS})`)
    .eq("user_id", userId)
    .eq("tasks.projects.workspace_id", workspaceId)
    .is("tasks.projects.deleted_at", null)
    .is("tasks.deleted_at", null);

  if (error) {
    throw error;
  }

  const data = (assignedRows ?? [])
    .map((row) => firstRelated(row.tasks))
    .filter((task): task is NonNullable<typeof task> => task !== null);

  const rowsById = new Map<string, MyTaskRow>();

  // Portal-parity fix: one batched sum of logged time for the assigned set
  // — same "batch once, never per-row" rationale getTaskLoggedMinutes's own
  // doc comment documents for the project List view.
  const assignedLoggedMinutes = await getTaskLoggedMinutes(
    data.map((task) => task.id),
  );

  for (const task of data) {
    const row = toRow(task, timeZone, assignedLoggedMinutes.get(task.id) ?? 0);
    row.isAssigned = true;
    rowsById.set(row.id, row);
  }

  // F231 (AS-441): a second, bounded round trip (never a per-row loop) --
  // resolve the caller's watched task ids via `task_watchers` (RLS-scoped
  // to visible tasks, same as everything else in this query), then fetch
  // those tasks the same way the assigned query does, applying the exact
  // same archived-project/trashed-task exclusion predicates (AS-437) so a
  // watched task in an archived project or a trashed task never leaks in
  // through this second path.
  if (includeWatched) {
    const { data: watcherRows, error: watcherError } = await supabase
      .from("task_watchers")
      .select("task_id")
      .eq("user_id", userId);

    if (watcherError) {
      throw watcherError;
    }

    const watchedTaskIds = (watcherRows ?? []).map((row) => row.task_id);

    if (watchedTaskIds.length > 0) {
      const { data: watchedData, error: watchedError } = await supabase
        .from("tasks")
        .select(TASK_SELECT_COLUMNS)
        .eq("projects.workspace_id", workspaceId)
        .is("projects.deleted_at", null)
        .is("deleted_at", null)
        .in("id", watchedTaskIds);

      if (watchedError) {
        throw watchedError;
      }

      const watchedLoggedMinutes = await getTaskLoggedMinutes(
        (watchedData ?? []).map((task) => task.id),
      );

      for (const task of watchedData ?? []) {
        const existing = rowsById.get(task.id);
        if (existing) {
          existing.isWatched = true;
        } else {
          const row = toRow(
            task,
            timeZone,
            watchedLoggedMinutes.get(task.id) ?? 0,
          );
          row.isWatched = true;
          rowsById.set(row.id, row);
        }
      }
    }
  }

  const buckets: MyTasksBuckets = {
    overdue: [],
    today: [],
    thisWeek: [],
    later: [],
  };

  for (const row of rowsById.values()) {
    buckets[row.bucket].push(row);
  }

  return buckets;
}
