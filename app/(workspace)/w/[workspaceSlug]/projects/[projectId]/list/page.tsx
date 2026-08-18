// F053 (AS-085): the real List view — supersedes the F030 placeholder that
// rendered "List view coming soon." Fetches all non-deleted tasks for this
// project (getProjectListTasks, lib/queries/tasks.ts — the board query's
// flat, ungrouped sibling) and renders them as a shadcn Table via
// <TaskListTable>.
//
// Server Component per the clarified spec ("Server Component for
// data-fetching") — the table's primary content is server-rendered in the
// initial HTML (AS-155). Assignee names are resolved server-side too
// (resolveAssigneeNames, lib/queries/assignee-names.ts) via the same
// Admin-API pattern the members page already uses, since there is no
// public.profiles table in this schema.
//
// Access relies on the project detail layout's guard one level up
// (workspace membership, F010/F023) plus getProjectById's cross-workspace
// 404 handling — no duplicate page-level gate here, matching the board
// page's approach.

import { getProjectListTasks } from "@/lib/queries/tasks";
import { resolveAssigneeNames } from "@/lib/queries/assignee-names";
import { TaskListTable } from "@/components/task/task-list-table";

export default async function ProjectListPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
}) {
  const { projectId } = await params;

  const tasks = await getProjectListTasks(projectId);
  const assigneeNames = await resolveAssigneeNames(
    tasks.map((task) => task.assigneeId),
  );

  return <TaskListTable tasks={tasks} assigneeNames={assigneeNames} />;
}
