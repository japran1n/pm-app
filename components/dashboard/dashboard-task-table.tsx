// F078 (AS-134): the dashboard's task table — workspace-wide (across ALL
// of the workspace's projects), not project-scoped like F053/F054's list
// view. Reuses `<ListFilters>` (components/task/list-filters.tsx, F054)
// and `<TaskListTable>` (components/task/task-list-table.tsx, F053):
// `<ListFilters>` only ever writes status/priority/assigneeId into the
// current pathname's URL query string and knows nothing about project vs.
// workspace scope, and `<TaskListTable>` only ever renders whatever
// `TaskCardTask[]` it's handed.
//
// F1 (status-sitemap-audit mission, AS-1): one exception to the
// "unmodified" note above — this Server Component now also batch-fetches
// each DISTINCT project's real `project_statuses` columns
// (lib/queries/statuses.ts's getProjectColumns) for the tasks it fetched,
// and passes the resulting per-project map down as `statusOptionsByProject`
// so a bulk status change over a selection spanning multiple projects can
// offer/verify each task's own project's real statuses, mirroring
// my-tasks/page.tsx's own per-project batch pattern — one query per
// distinct project touched by the current page of results, never one
// query per task.
//
// Server Component (clarified spec's "Server Component for data-fetching,
// thin Client Component only for the interactive part") — this component
// does the workspace-wide fetch itself (`getWorkspaceListTasks`,
// lib/queries/tasks.ts) so the table's primary content is part of the
// initial HTML (AS-155), exactly like the project list page's own
// pattern. The workspace home page (app/(workspace)/w/[workspaceSlug]/
// page.tsx) just forwards `searchParams` + the resolved `workspaceId`/
// `workspaceSlug` in as props.
//
// AS-134's own filter semantics (AND-combined, clearable) are unit-tested
// against `getWorkspaceListTasks` directly in
// tests/integration/dashboard-task-table-filters.test.ts, mirroring
// F054's tests/integration/list-view-filters.test.ts.

import { getWorkspaceListTasks } from "@/lib/queries/tasks";
import { getWorkspaceMembers } from "@/lib/queries/members";
// F1 (status-sitemap-audit mission, AS-1): same batched-per-distinct-
// project-id query my-tasks/page.tsx already uses for its own
// `statusOptionsByProject` map — see that page's own doc comment.
import { createClient } from "@/lib/supabase/server";
import { statusLabelFor } from "@/lib/task-colors";
// Portal-parity fix: the dashboard's Type column was always empty because
// this Server Component never fetched the workspace's task types (the
// per-project List page always has, via getTaskTypes — see that page's own
// comment). <TaskListTable>'s Type cell (ListTaskTypeSelect) already
// quietly renders nothing when handed an empty array, which is exactly
// what made this bug silent instead of a crash.
import { getTaskTypes } from "@/lib/queries/task-types";
import { TaskListTable } from "@/components/task/task-list-table";
import { ListFilters } from "@/components/task/list-filters";
import type { UserAvatarPerson } from "@/components/user-avatar";

const VALID_STATUSES = new Set(["todo", "in_progress", "in_review", "done"]);
const VALID_PRIORITIES = new Set([
  "urgent",
  "high",
  "medium",
  "low",
  "backlog",
]);
// UX-20: the four KPI tiles above this table each write one of these into
// `?flag=`.
const VALID_FLAGS = new Set(["overdue", "due_soon", "blocked", "completed"]);

export async function DashboardTaskTable({
  workspaceId,
  workspaceSlug,
  searchParams,
  timezone,
}: {
  workspaceId: string;
  workspaceSlug: string;
  searchParams: {
    status?: string;
    priority?: string;
    assigneeId?: string;
    flag?: string;
  };
  /** F124/F275 (AS-207): the viewer's IANA timezone, resolved ONCE per
   * request by the workspace dashboard page
   * (app/(workspace)/w/[workspaceSlug]/page.tsx) and passed down here —
   * this component does not call lib/queries/profile.ts itself, so the
   * same request never resolves the timezone twice. Forwarded straight
   * through to <TaskListTable>. REQUIRED since F275 — see
   * components/task/task-list-table.tsx's own doc comment on this same
   * prop for why. */
  timezone: string;
}) {
  const filters: {
    status?: "todo" | "in_progress" | "in_review" | "done";
    priority?: "urgent" | "high" | "medium" | "low" | "backlog";
    assigneeId?: string;
    flag?: "overdue" | "due_soon" | "blocked" | "completed";
  } = {};
  if (searchParams.status && VALID_STATUSES.has(searchParams.status)) {
    filters.status = searchParams.status as NonNullable<typeof filters.status>;
  }
  if (searchParams.priority && VALID_PRIORITIES.has(searchParams.priority)) {
    filters.priority = searchParams.priority as NonNullable<
      typeof filters.priority
    >;
  }
  if (searchParams.assigneeId) {
    filters.assigneeId = searchParams.assigneeId;
  }
  if (searchParams.flag && VALID_FLAGS.has(searchParams.flag)) {
    filters.flag = searchParams.flag as NonNullable<typeof filters.flag>;
  }

  const hasActiveFilters = Boolean(
    filters.status || filters.priority || filters.assigneeId || filters.flag,
  );
  const clearFiltersHref = `/w/${workspaceSlug}`;

  const [tasks, members, taskTypes] = await Promise.all([
    getWorkspaceListTasks(workspaceId, filters, timezone),
    getWorkspaceMembers(workspaceId),
    getTaskTypes(workspaceId),
  ]);

  // F1 (status-sitemap-audit mission, AS-1): resolve every distinct
  // project's real `project_statuses` columns in ONE batched query,
  // covering every project this page's (already status/priority/assignee/
  // flag-filtered) result set touches — never a query per task, mirroring
  // my-tasks/page.tsx's own `statusOptionsByProject` build exactly.
  const distinctProjectIds = Array.from(
    new Set(
      tasks
        .map((task) => task.projectId)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const statusOptionsByProject = new Map<
    string,
    {
      value: string;
      label: string;
      color: string;
      category?: string | null;
      displayGroup?: string | null;
    }[]
  >();
  if (distinctProjectIds.length > 0) {
    const supabase = await createClient();
    const { data: columnRows } = await supabase
      .from("project_statuses")
      .select("project_id, name, color, category, display_group, position")
      .in("project_id", distinctProjectIds)
      .order("position", { ascending: true });

    for (const row of columnRows ?? []) {
      const list = statusOptionsByProject.get(row.project_id) ?? [];
      list.push({
        value: row.name,
        label: statusLabelFor(row.name),
        color: row.color,
        category: row.category,
        displayGroup: row.display_group,
      });
      statusOptionsByProject.set(row.project_id, list);
    }
  }
  const assigneeOptions = members.active.map((member) => ({
    id: member.userId,
    label: member.name ?? member.email ?? member.userId,
    avatarUrl: member.avatarUrl,
  }));

  // F122 (AS-214): taskAssigneeId -> resolved person for the table's
  // Assignee column avatar. Every valid assignee is, by construction, an
  // active member of the workspace the task belongs to, so this is built
  // directly from the `getWorkspaceMembers` fetch already made above
  // instead of a second resolveAssigneeNames()-style Admin API pass.
  const assignees = new Map<string, UserAvatarPerson>(
    members.active.map((member) => [
      member.userId,
      {
        id: member.userId,
        name: member.name,
        email: member.email,
        avatarUrl: member.avatarUrl,
      },
    ]),
  );

  return (
    <div className="flex flex-col gap-4">
      <ListFilters assigneeOptions={assigneeOptions} />
      <TaskListTable
        tasks={tasks}
        assignees={assignees}
        hasActiveFilters={hasActiveFilters}
        clearFiltersHref={clearFiltersHref}
        timezone={timezone}
        taskTypeOptions={taskTypes}
        statusOptionsByProject={statusOptionsByProject}
      />
    </div>
  );
}
