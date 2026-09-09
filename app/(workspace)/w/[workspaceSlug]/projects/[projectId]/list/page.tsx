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

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  getProjectListTasks,
  type ProjectListTaskFilters,
  type ProjectListTaskSort,
} from "@/lib/queries/tasks";
import { getCurrentUserTimezone } from "@/lib/queries/profile";
import { getWorkspaceMembers } from "@/lib/queries/members";
// F223 (AS-411): the project's real board columns — same read path F221
// already built for the board, reused here rather than a parallel copy.
import { getProjectColumns } from "@/lib/queries/statuses";
// F221/F223 (AS-407): same fixed-four -> human-label lookup board.tsx
// already applies to a project's real columns (with a genuinely custom
// name falling back to its own raw name) — this list view's status
// options previously used the raw column name unconditionally, which
// meant a stock "todo" column showed as "todo" here while the board
// correctly showed "To Do" for the exact same column.
import { statusLabelFor } from "@/lib/task-colors";
import { TaskListTable } from "@/components/task/task-list-table";
import { ListFilters } from "@/components/task/list-filters";
import { getTaskTypes } from "@/lib/queries/task-types";
import { NewTaskDialog } from "@/components/task/new-task-dialog";
import { NewFromTemplateButton } from "@/components/task/new-from-template-button";
import { getWorkspaceTaskTemplateOptions } from "@/lib/queries/templates";
import type { UserAvatarPerson } from "@/components/user-avatar";
import type { TaskCardTask } from "@/components/task/task-card";
// F229 (AS-429, AS-431, AS-432, AS-433): saved views for this project's
// List view — server-fetched (RLS-scoped, per this feature's data-shape
// answer) and passed down to the Client Component picker; `getSavedView`
// resolves an opened `?viewId=` link, and `resolveListViewFilters`
// degrades any dangling status/assignee reference in that view's config
// rather than erroring.
import { listSavedViewsForProject, getMyDefaultSavedView } from "@/lib/queries/views";
import { getSavedView } from "@/lib/actions/views";
import { listViewTaskIds } from "@/lib/actions/view-tasks";
import { resolveListViewFilters, filterTasksByGroup } from "@/lib/views/resolve-view";
import type { FilterGroup } from "@/lib/validation/views";
import { mergeManualTaskIds } from "@/lib/views/apply-view";
import { ViewSwitcher } from "@/components/views/view-switcher";
import { ViewTabs } from "@/components/views/view-tabs";
import { SaveViewDialog } from "@/components/views/save-view-dialog";
// Follow-up (drag-and-drop view membership): a single shared dnd-kit
// DndContext wrapping both the view tab row (drop targets) and the task
// table (drag sources) below -- see that module's own doc comment for why
// this works across two sibling components.
import { ViewDropContext } from "@/components/views/view-drop-context";

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
    taskTypeId?: string;
    sort?: string;
    viewId?: string;
  }>;
}) {
  const { workspaceSlug, projectId } = await params;
  const query = await searchParams;
  const basePath = `/w/${workspaceSlug}/projects/${projectId}/list`;

  // F223 (AS-411) + workspace members: run in parallel — columns and
  // workspace lookup are independent of each other (P5: eliminates one
  // serial round-trip per list page load).
  const supabase = await createClient();
  const [columns, { data: workspace }] = await Promise.all([
    getProjectColumns(projectId),
    supabase
      .from("workspaces")
      .select("id")
      .eq("slug", workspaceSlug)
      .maybeSingle(),
  ]);
  const workspaceMembers = workspace
    ? await getWorkspaceMembers(workspace.id)
    : { active: [], pending: [] };

  const validStatusNames = new Set(columns.map((column) => column.name));
  // F221's own convention for a custom column name flowing through the
  // legacy fixed-four `TaskCardTask["status"]` union — see
  // components/board/board.tsx's `as TaskCardTask["status"]` cast.
  const statusOptions: {
    value: NonNullable<TaskCardTask["status"]>;
    label: string;
    color: string;
  }[] = columns.map((column) => ({
    value: column.name as NonNullable<TaskCardTask["status"]>,
    label: statusLabelFor(column.name),
    color: column.color,
  }));
  // F229 (AS-433 dangling-member class): the set of assignee ids a
  // saved view's `assigneeId` filter is validated against — the same
  // "currently active workspace member" set the page already resolves
  // for its own assignee filter/creation pickers below, so a member
  // removed since the view was saved is dropped rather than silently
  // producing zero rows.
  const validAssigneeIds = new Set(workspaceMembers.active.map((m) => m.userId));

  // F229 (AS-431): with NEITHER a view opened NOR any filter/sort param
  // present at all, redirect to the caller's own default view for this
  // project (if one exists) so "opening the project" auto-applies it —
  // server-side, before any tasks are fetched. Guarded by "no params at
  // all" (not just "no viewId") so a link to a specific, unfiltered state
  // (e.g. a bookmarked plain `?sort=due_date_asc`) is never silently
  // overridden by the default, and so this can never redirect-loop (the
  // redirect target always carries `viewId`, which short-circuits this
  // branch on the next render).
  const hasAnyViewOrFilterParam = Boolean(
    query.viewId ||
      query.status ||
      query.priority ||
      query.assigneeId ||
      query.taskTypeId ||
      query.sort,
  );
  if (!hasAnyViewOrFilterParam) {
    const defaultView = await getMyDefaultSavedView(projectId, "list");
    if (defaultView) {
      redirect(`${basePath}?viewId=${defaultView.id}`);
    }
  }

  // F229 (AS-432, AS-433): a `?viewId=` param is this view's shareable
  // URL. `getSavedView` re-runs the exact RLS-scoped read `saved_views`'
  // own SELECT policy enforces (F227) — a view the caller cannot see
  // (someone else's personal view, or a shared view on a project they
  // cannot see) resolves to `ok: false` here, which this page treats
  // exactly like "no viewId at all" rather than an error page or a
  // "you're not allowed" message that would confirm the view exists,
  // matching this codebase's "refuse without confirming existence"
  // convention for a resource the caller has no rights to.
  let appliedViewId: string | undefined;
  let droppedFilterCount = 0;
  let viewFilters: ProjectListTaskFilters | undefined;
  let viewSort: ProjectListTaskSort | undefined;
  // Follow-up (nested AND/OR groups): set only when the view's effective
  // filter tree is NOT a trivial single "and" -- i.e. it has an "or"
  // somewhere, or a nested group -- which the SQL-level `viewFilters`
  // above can't express. When set, `getProjectListTasks` below is called
  // with NO filters (fetch everything for the project) and this group is
  // applied in memory afterward instead.
  let nonTrivialFilterGroup: FilterGroup | undefined;

  if (query.viewId) {
    const viewResult = await getSavedView(query.viewId);
    if (viewResult.ok && viewResult.data.projectId === projectId) {
      appliedViewId = viewResult.data.id;
      const resolved = resolveListViewFilters(viewResult.data.config, {
        validStatusNames,
        validAssigneeIds,
      });
      droppedFilterCount = resolved.droppedCount;
      if (resolved.isTrivial) {
        viewFilters = resolved.filters;
        viewSort = resolved.sort;
      } else {
        nonTrivialFilterGroup = resolved.filterGroup;
        viewSort = resolved.sort;
        // Give getProjectListTasks an always-true SQL filter set so
        // the in-memory filterTasksByGroup pass below sees every task
        // for this project, not a pre-narrowed subset.
        viewFilters = {};
      }
    }
  }

  const filters: ProjectListTaskFilters = viewFilters ?? {};
  if (!viewFilters) {
    if (query.status && validStatusNames.has(query.status)) {
      filters.status = query.status as ProjectListTaskFilters["status"];
    }
    if (query.priority && VALID_PRIORITIES.has(query.priority)) {
      filters.priority = query.priority as ProjectListTaskFilters["priority"];
    }
    if (query.assigneeId) {
      filters.assigneeId = query.assigneeId;
    }
    if (query.taskTypeId) {
      filters.taskTypeId = query.taskTypeId;
    }
  }

  // F055 (AS-091): sort is applied on top of the (already-filtered) query
  // — an invalid/unrecognized `sort` param degrades to the default
  // created_at-ascending order, same "tampered param = ignored" posture
  // as the F054 filter validation just above.
  const sort = viewFilters
    ? viewSort
    : query.sort && VALID_SORTS.has(query.sort)
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

  // F124 (AS-207): the viewer's timezone is resolved ONCE per request here
  // (lib/queries/profile.ts's getCurrentUserTimezone) and threaded down to
  // <TaskListTable> as a prop — never re-queried per row. F229: the
  // project's saved views (listSavedViewsForProject) join the same
  // independent-fetches batch — RLS-scoped, so this never returns a view
  // the caller shouldn't see (AS-429/AS-434).
  const [rawFilteredTasks, timezone, taskTypes, templates, savedViews] = await Promise.all([
    getProjectListTasks(projectId, filters, sort),
    getCurrentUserTimezone(supabase),
    // F434-F440: fetched alongside the rest of this page's independent
    // batch — workspace is already resolved above.
    workspace ? getTaskTypes(workspace.id) : Promise.resolve([]),
    // F183 (AS-330 UI half): same fetch-and-pass-down pattern as the board
    // page's own templates prop.
    workspace ? getWorkspaceTaskTemplateOptions(workspace.id) : Promise.resolve([]),
    listSavedViewsForProject(projectId, "list"),
  ]);

  // Follow-up (nested AND/OR groups): when the applied view's filter tree
  // has an "or" or nesting the SQL path above couldn't express, `filters`
  // was intentionally left empty (fetch everything) and the real
  // narrowing happens here, in memory, via the same recursive evaluator
  // `lib/views/resolve-view.ts` uses.
  const filteredTasks = nonTrivialFilterGroup
    ? filterTasksByGroup(rawFilteredTasks, nonTrivialFilterGroup)
    : rawFilteredTasks;

  // Follow-up (manual view membership): a view's effective task list is
  // filter-matched UNION manually-added (lib/views/apply-view.ts's
  // mergeManualTaskIds) -- fetched only when a view is actually applied,
  // since an unfiltered/no-view page has no manual-membership concept.
  let tasks = filteredTasks;
  if (appliedViewId) {
    const manualIdsResult = await listViewTaskIds(appliedViewId);
    const manualIds = manualIdsResult.ok ? manualIdsResult.data : [];
    const missingIds = manualIds.filter(
      (id) => !filteredTasks.some((task) => task.id === id),
    );
    const manualExtraTasks =
      missingIds.length > 0
        ? await getProjectListTasks(projectId, { taskIds: missingIds })
        : [];
    tasks = mergeManualTaskIds(
      filteredTasks,
      manualIds
        .map((id) => manualExtraTasks.find((task) => task.id === id))
        .filter((task): task is (typeof manualExtraTasks)[number] => Boolean(task)),
    );
  }

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
    statusNote: member.statusNote,
    statusNoteUntil: member.statusNoteUntil,
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
        statusNote: member.statusNote,
        statusNoteUntil: member.statusNoteUntil,
      },
    ]),
  );

  return (
    <ViewDropContext>
    <div className="flex flex-col gap-4">
      {/* F401 ("views as tabs"): shared list views as a clickable tab row
          — the SAME `?viewId=` navigation/resolution ViewSwitcher's
          dropdown already uses below, just more visible. Renders nothing
          when the project has no shared list views yet. */}
      <ViewTabs views={savedViews} activeViewId={appliedViewId} />
      {/* Task-creation fix: a user might land on List first (e.g. via a
          bookmarked/shared filtered URL), so it needs its own "New Task"
          entry point rather than relying on the Board view's. */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <ViewSwitcher
            views={savedViews}
            activeViewId={appliedViewId}
            filterFieldOptions={[
              {
                field: "status",
                label: "Status",
                values: statusOptions.map((option) => ({
                  value: option.value as string,
                  label: option.label,
                })),
              },
              {
                field: "priority",
                label: "Priority",
                values: Array.from(VALID_PRIORITIES).map((value) => ({
                  value,
                  label: value.charAt(0).toUpperCase() + value.slice(1),
                })),
              },
              {
                field: "assigneeId",
                label: "Assignee",
                values: assigneeOptions.map((option) => ({
                  value: option.id,
                  label: option.label,
                })),
              },
            ]}
          />
          {workspace && (
            <SaveViewDialog workspaceId={workspace.id} projectId={projectId} />
          )}
          <ListFilters
          assigneeOptions={assigneeOptions}
          statusOptions={statusOptions}
          taskTypeOptions={taskTypes.map((type) => ({
            value: type.id,
            label: type.name,
            color: type.color,
          }))}
        />
        </div>
        {/* UX fix (list page audit, Nalaz 1): the quick-add row above the
            table (task-list-table.tsx's "+ Add task") is now the ONE
            primary create-task entry point for this page — it's faster
            and covers the common case. The full dialog still has genuine
            extra value this quick-add row can't cover (description,
            priority, phase, task type, and multiple assignees set up
            front, plus "New from template"), so it's kept rather than
            removed, but demoted to a small, secondary "Advanced..."
            trigger instead of a second equally-weighted "+ New Task" CTA
            competing with quick-add for the same action. */}
        <div className="flex items-center gap-2">
          <NewFromTemplateButton projectId={projectId} templates={templates} />
          <NewTaskDialog
            projectId={projectId}
            assigneeOptions={assigneeOptions}
            variant="outline"
            size="sm"
            triggerLabel="Advanced..."
          />
        </div>
      </div>
      {/* AS-433: non-blocking notice — the view's tasks still render below
          even when some of its filters no longer apply. */}
      {appliedViewId && droppedFilterCount > 0 && (
        <p className="text-sm text-muted-foreground">
          {droppedFilterCount === 1
            ? "1 filter from this view no longer applies and was skipped."
            : `${droppedFilterCount} filters from this view no longer apply and were skipped.`}
        </p>
      )}
      <TaskListTable
        tasks={tasks}
        assignees={assignees}
        sort={sort}
        hasActiveFilters={hasActiveFilters}
        clearFiltersHref={clearFiltersHref}
        members={detailSheetMembers}
        timezone={timezone}
        statusOptions={statusOptions}
        projectId={projectId}
        taskTypeOptions={taskTypes}
        savedViews={savedViews.map((view) => ({ id: view.id, name: view.name }))}
      />
    </div>
    </ViewDropContext>
  );
}
