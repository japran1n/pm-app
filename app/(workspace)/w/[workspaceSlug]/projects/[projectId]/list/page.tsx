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
//
// F054 (AS-086..090): filter controls. `searchParams` (Next 16: async, per
// tech-decisions.md) carries `status` / `priority` / `assigneeId` — read
// here and passed straight into `getProjectListTasks`'s `filters` argument,
// so narrowing happens in the DB query itself rather than client-side, and
// the Server Component re-fetches on every filter change because the URL
// (hence `searchParams`) changed. <ListFilters> (thin Client Component) is
// what writes those params; this page never imports client-only APIs.
// Assignee options for the filter reuse `getWorkspaceMembers` (already
// used by the members page) resolved from the workspace slug in `params`,
// same RLS-scoped lookup pattern as the project detail layout above this
// route.

import { createClient } from "@/lib/supabase/server";
import {
  getProjectListTasks,
  type ProjectListTaskFilters,
} from "@/lib/queries/tasks";
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

export default async function ProjectListPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
  searchParams: Promise<{
    status?: string;
    priority?: string;
    assigneeId?: string;
  }>;
}) {
  const { workspaceSlug, projectId } = await params;
  const query = await searchParams;

  const filters: ProjectListTaskFilters = {};
  if (query.status && VALID_STATUSES.has(query.status)) {
    filters.status = query.status as ProjectListTaskFilters["status"];
  }
  if (query.priority && VALID_PRIORITIES.has(query.priority)) {
    filters.priority = query.priority as ProjectListTaskFilters["priority"];
  }
  if (query.assigneeId) {
    filters.assigneeId = query.assigneeId;
  }

  const tasks = await getProjectListTasks(projectId, filters);
  const assigneeNames = await resolveAssigneeNames(
    tasks.map((task) => task.assigneeId),
  );

  // RLS-scoped lookup (workspaces_select_active_members) — same fallback
  // pattern as the project detail layout: reaching this route already
  // means the caller is an active member, this just resolves the id.
  const supabase = await createClient();
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  const assigneeOptions = workspace
    ? (await getWorkspaceMembers(workspace.id)).active.map((member) => ({
        id: member.userId,
        label: member.name ?? member.email ?? member.userId,
      }))
    : [];

  return (
    <div className="flex flex-col gap-4">
      <ListFilters assigneeOptions={assigneeOptions} />
      <TaskListTable tasks={tasks} assigneeNames={assigneeNames} />
    </div>
  );
}
