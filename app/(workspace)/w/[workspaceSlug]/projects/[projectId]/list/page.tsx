// F053 (AS-085): the real List view — supersedes the F030 placeholder that
// rendered "List view coming soon." Fetches all non-deleted tasks for this
// project (getProjectListTasks, lib/queries/tasks.ts — the board query's
// flat, ungrouped sibling) and renders them as a shadcn Table via
// <TaskListTable>.
//
// Server Component per the clarified spec ("Server Component for
// data-fetching") — the table's primary content is server-rendered in the
// initial HTML (AS-155). F122 (AS-214): assignee display data (name,
// email, avatarUrl) for the table/pickers no longer needs its own
// resolveAssigneeNames() call — every valid assignee is, by construction,
// an active workspace member (assignTask only accepts one), so the
// `assignees` map handed to <TaskListTable> is built directly from the
// `getWorkspaceMembers` fetch already made below for the filter/creation
// pickers, avoiding a second Admin-API-backed resolution pass over the
// same set of people.
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
  type ProjectListTaskSort,
} from "@/lib/queries/tasks";
import { getCurrentUserTimezone } from "@/lib/queries/profile";
import { getWorkspaceMembers } from "@/lib/queries/members";
import { TaskListTable } from "@/components/task/task-list-table";
import { ListFilters } from "@/components/task/list-filters";
import { NewTaskDialog } from "@/components/task/new-task-dialog";
import type { UserAvatarPerson } from "@/components/user-avatar";

const VALID_STATUSES = new Set(["todo", "in_progress", "in_review", "done"]);
const VALID_PRIORITIES = new Set([
  "urgent",
  "high",
  "medium",
  "low",
  "backlog",
]);
const VALID_SORTS = new Set(["due_date_asc", "due_date_desc"]);

export default async function ProjectListPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
  searchParams: Promise<{
    status?: string;
    priority?: string;
    assigneeId?: string;
    sort?: string;
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

  // F055 (AS-091): sort is applied on top of the (already-filtered) query
  // — an invalid/unrecognized `sort` param degrades to the default
  // created_at-ascending order, same "tampered param = ignored" posture
  // as the F054 filter validation just above.
  const sort = query.sort && VALID_SORTS.has(query.sort)
    ? (query.sort as ProjectListTaskSort)
    : undefined;

  // F056 (AS-092): whether any filter is active, used to pick between the
  // "no tasks match your filters" empty state and the plain "no tasks yet"
  // one below. `clearFiltersHref` is the same "base pathname, no query
  // params" target `<ListFilters>`'s own Clear filters button navigates to
  // (F054) — reused here as a plain link since <TaskListTable> is a Server
  // Component and can't call `useRouter` itself.
  const hasActiveFilters = Boolean(
    filters.status || filters.priority || filters.assigneeId,
  );
  const clearFiltersHref = `/w/${workspaceSlug}/projects/${projectId}/list`;

  // RLS-scoped lookup (workspaces_select_active_members) — same fallback
  // pattern as the project detail layout: reaching this route already
  // means the caller is an active member, this just resolves the id.
  const supabase = await createClient();

  // F124 (AS-207): the viewer's timezone is resolved ONCE per request here
  // (lib/queries/profile.ts's getCurrentUserTimezone) and threaded down to
  // <TaskListTable> as a prop — never re-queried per row. Run alongside
  // the other independent fetches below rather than sequentially awaited.
  const [tasks, workspaceResult, timezone] = await Promise.all([
    getProjectListTasks(projectId, filters, sort),
    supabase.from("workspaces").select("id").eq("slug", workspaceSlug).maybeSingle(),
    getCurrentUserTimezone(supabase),
  ]);
  const { data: workspace } = workspaceResult;

  const workspaceMembers = workspace
    ? await getWorkspaceMembers(workspace.id)
    : { active: [], pending: [] };

  const assigneeOptions = workspaceMembers.active.map((member) => ({
    id: member.userId,
    label: member.name ?? member.email ?? member.userId,
    avatarUrl: member.avatarUrl,
  }));

  // BUGFIX: TaskDetailSheet's assignee Select needs the full members list
  // (TaskDetailSheetMember shape), not just the New Task dialog's
  // narrower `{ id, label }` assignee options — same pattern the board
  // page uses.
  const detailSheetMembers = workspaceMembers.active.map((member) => ({
    userId: member.userId,
    email: member.email,
    name: member.name,
    avatarUrl: member.avatarUrl,
  }));

  // F122 (AS-214): taskAssigneeId -> resolved person, built from the same
  // `workspaceMembers` fetch above (see this file's top comment for why
  // that's sufficient — no second query needed).
  const assignees = new Map<string, UserAvatarPerson>(
    workspaceMembers.active.map((member) => [
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
      {/* Task-creation fix: a user might land on List first (e.g. via a
          bookmarked/shared filtered URL), so it needs its own "New Task"
          entry point rather than relying on the Board view's. */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <ListFilters assigneeOptions={assigneeOptions} />
        <NewTaskDialog projectId={projectId} assigneeOptions={assigneeOptions} />
      </div>
      <TaskListTable
        tasks={tasks}
        assignees={assignees}
        sort={sort}
        hasActiveFilters={hasActiveFilters}
        clearFiltersHref={clearFiltersHref}
        members={detailSheetMembers}
        timezone={timezone}
      />
    </div>
  );
}
