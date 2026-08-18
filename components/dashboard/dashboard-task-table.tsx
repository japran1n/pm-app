// F078 (AS-134): the dashboard's task table — workspace-wide (across ALL
// of the workspace's projects), not project-scoped like F053/F054's list
// view. Reuses `<ListFilters>` (components/task/list-filters.tsx, F054)
// and `<TaskListTable>` (components/task/task-list-table.tsx, F053)
// completely unmodified: `<ListFilters>` only ever writes
// status/priority/assigneeId into the current pathname's URL query string
// and knows nothing about project vs. workspace scope, and
// `<TaskListTable>` only ever renders whatever `TaskCardTask[]` it's
// handed — neither needed a single line changed to work here.
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
import { resolveAssigneeNames } from "@/lib/queries/assignee-names";
import { getWorkspaceMembers } from "@/lib/queries/members";
import { TaskListTable } from "@/components/task/task-list-table";
import { ListFilters } from "@/components/task/list-filters";

const VALID_STATUSES = new Set(["todo", "in_progress", "in_review", "done"]);
const VALID_PRIORITIES = new Set([
  "urgent",
  "high",
  "medium",
  "low",
  "backlog",
]);

export async function DashboardTaskTable({
  workspaceId,
  workspaceSlug,
  searchParams,
}: {
  workspaceId: string;
  workspaceSlug: string;
  searchParams: {
    status?: string;
    priority?: string;
    assigneeId?: string;
  };
}) {
  const filters: {
    status?: "todo" | "in_progress" | "in_review" | "done";
    priority?: "urgent" | "high" | "medium" | "low" | "backlog";
    assigneeId?: string;
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

  const hasActiveFilters = Boolean(
    filters.status || filters.priority || filters.assigneeId,
  );
  const clearFiltersHref = `/w/${workspaceSlug}`;

  const [tasks, members] = await Promise.all([
    getWorkspaceListTasks(workspaceId, filters),
    getWorkspaceMembers(workspaceId),
  ]);
  const assigneeNames = await resolveAssigneeNames(
    tasks.map((task) => task.assigneeId),
  );
  const assigneeOptions = members.active.map((member) => ({
    id: member.userId,
    label: member.name ?? member.email ?? member.userId,
  }));

  return (
    <div className="flex flex-col gap-4">
      <ListFilters assigneeOptions={assigneeOptions} />
      <TaskListTable
        tasks={tasks}
        assigneeNames={assigneeNames}
        hasActiveFilters={hasActiveFilters}
        clearFiltersHref={clearFiltersHref}
      />
    </div>
  );
}
