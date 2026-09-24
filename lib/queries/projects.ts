import { cache } from "react";
import { logger } from "@/lib/observability/logger";
import type { UserAvatarPerson } from "@/components/user-avatar";

// Data-fetching for the project list page (F027, AS-027, AS-034, AS-042).
//
// Uses the normal RLS-respecting client — `projects_select_active_members`
// (supabase/migrations/20260818004709_rls_projects.sql) already scopes rows
// to non-deleted projects in workspaces the caller is an active member of,
// so this query is both workspace-scoped (AS-042) and RLS-backed (AS-028)
// for free. An explicit `deleted_at is null` filter is still applied here
// per tech-decisions.md's soft-delete convention ("all SELECTs used by the
// app ... filter deleted_at IS NULL"), even though RLS already enforces it,
// so this query is correct even if a future policy change ever loosens it.
//
// AS-034 (open task count): batched below in getWorkspaceProjects via one
// extra query across every returned project id (never per-project — this
// function also backs the sidebar's project list, F262). "Open" means the
// task's board-column CATEGORY isn't "done" (project_statuses.category),
// not the literal status TEXT — a project can rename/replace its columns
// (F218+), and this must keep counting correctly against whatever the
// project's columns are named today. Falls back to the legacy `status !=
// 'done'` text check only for a task whose `status_id` hasn't been
// backfilled (same fallback lib/queries/portal.ts's getPortalProjects
// already uses, kept identical rather than inventing a second one).

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolvePeople } from "@/lib/queries/people";
import { getCurrentUser, getRequestClient } from "@/lib/auth/current-user";
import { buildStatusBucketMaps } from "@/lib/portal/status-bucket";
import type { StatusRowWithBucket } from "@/lib/queries/portal/shared";
import { countProjectHealthTasks, type ProjectHealthTask } from "@/lib/projects/compute-health";

export type ProjectListItem = {
  id: string;
  name: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  targetLaunchDate?: string | null;
  createdAt: string;
  // F145 (AS-257): the short project key (e.g. "PM") assigned at creation
  // time by a BEFORE INSERT trigger — nullable only for defensiveness
  // against any pre-F145 row that predates the column (none exist in
  // practice; the trigger backfills every insert going forward).
  key: string | null;
  // Feature request "Project ikonica/emoji": nullable single-emoji icon
  // (see supabase/migrations/20261113010000_project_icon.sql). `null`
  // means every caller falls back to its own existing
  // first-letter-of-name treatment.
  icon: string | null;
  // Sidebar drag-and-drop reorder: the project's manually-set position
  // within its workspace's sidebar list (0-based, global per workspace —
  // not per-member). `null` for a project that has never been dragged
  // (renders after every positioned project, per this list's `order`
  // clause below).
  sidebarPosition: number | null;
  // AS-034: count of this project's non-deleted, not-"done"-category
  // tasks. `null` only if the batched count query itself failed (fails
  // open to "not yet supported" rather than a fake 0); otherwise always a
  // real number, including 0 for a project with no open tasks.
  openTaskCount: number | null;
};

// F262 (AS-509, AS-511, AS-512, AS-513): the sidebar's own project list
// call reuses this exact function — the same RLS-backed `createClient()`
// query the projects page (F027) already uses, so guest scoping (F134) and
// private-project visibility (F132) apply identically in the sidebar
// without a second copy of that rule. Callers that don't need `key`
// (e.g. the projects page) simply ignore the extra field.
export async function getWorkspaceProjects(
  workspaceId: string,
): Promise<ProjectListItem[]> {
  const supabase = await createClient();

  // Sidebar drag-and-drop reorder: ordered by `sidebar_position` first
  // (nulls last, via `nullsFirst: false`) so a row with an explicit
  // manual position always wins, falling back to the original
  // `created_at desc` order for anything not yet positioned -- same
  // "never visibly reorders anyone's existing sidebar" backfill guarantee
  // the migration's own comment documents.
  const { data, error } = await supabase
    .from("projects")
    // `sidebar_position` selected via `returns<>` below rather than a
    // typed column reference — see the same not-yet-regenerated
    // `Database` type note in lib/actions/projects.ts's
    // `ProjectsRowWithSidebarPosition`.
    .select("id, name, description, start_date, end_date, target_launch_date, created_at, key, icon, sidebar_position")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .order("sidebar_position", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .returns<
      Array<{
        id: string;
        name: string;
        description: string | null;
        start_date: string | null;
        end_date: string | null;
        target_launch_date?: string | null;
        created_at: string;
        key: string | null;
        icon: string | null;
        sidebar_position: number | null;
      }>
    >();

  if (error) {
    throw error;
  }

  const projects = data ?? [];
  const openCountByProject = await getOpenTaskCounts(
    supabase,
    projects.map((project) => project.id),
  );

  return projects.map((project) => ({
    id: project.id,
    name: project.name,
    description: project.description,
    startDate: project.start_date,
    endDate: project.end_date,
    targetLaunchDate: project.target_launch_date ?? null,
    createdAt: project.created_at,
    key: project.key ?? null,
    icon: project.icon ?? null,
    sidebarPosition: project.sidebar_position ?? null,
    // `null` (the count query itself failed) is passed through as-is —
    // NOT coalesced to 0 — so the UI's existing "pending" state stays
    // truthful. A failed count must never look identical to a genuinely
    // empty project.
    openTaskCount: openCountByProject === null ? null : (openCountByProject.get(project.id) ?? 0),
  }));
}

// AS-034: one batched query for every project id passed in, never one
// query per project (this function backs both the Projects page and the
// sidebar's project list, F262 — an N+1 here would run on every workspace
// page load). Uses a server-side RPC (get_open_task_counts) that returns
// one row per project instead of all task rows — eliminates unbounded
// row transfer for large workspaces. Returns `null` (not an empty map) on
// a query failure, so the caller can render its "count unavailable" state
// rather than a fake 0 indistinguishable from a real empty project.
async function getOpenTaskCounts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectIds: string[],
): Promise<Map<string, number> | null> {
  const counts = new Map<string, number>();
  if (projectIds.length === 0) return counts;

  const { data, error } = await supabase.rpc("get_open_task_counts", {
    project_ids: projectIds,
  });

  if (error) {
    logger.error("getOpenTaskCounts: RPC failed", { error: error });
    return null;
  }

  for (const row of data ?? []) {
    counts.set(row.project_id, Number(row.open_count));
  }

  return counts;
}

// F263 (AS-510): the signed-in caller's own favourited project ids, scoped
// to the given workspace's VISIBLE projects only. `project_favorites`'
// own RLS is deliberately own-row-only (no project-visibility predicate --
// see that migration's header comment), so this read query is what
// actually prevents an orphaned favourite (e.g. for a project the caller
// was since removed from, or that was archived) from ever being pinned in
// the sidebar: it joins against the exact same
// `projects_select_active_members`-scoped `id` select the rest of this
// file already uses, via an `in (...)` filter against the ids
// `getWorkspaceProjects` would itself return, rather than re-deriving
// visibility a second way. Non-fatal to the caller on error -- fails open
// to "no favourites" so a transient read error never breaks the whole
// sidebar/project-list render (same convention getNotificationsForWorkspace
// and getTourStatus already follow for this layout).
export async function getFavoriteProjectIds(
  workspaceId: string,
  preloadedUserId?: string,
): Promise<Set<string>> {
  const supabase = await getRequestClient();

  let userId = preloadedUserId;
  if (!userId) {
    const { user } = await getCurrentUser();
    if (!user) return new Set();
    userId = user.id;
  }

  // Own-row favourites read (RLS: project_favorites_select_own already
  // scopes this to the caller's own rows).
  const { data: favoriteRows, error: favoriteError } = await supabase
    .from("project_favorites")
    .select("project_id")
    .eq("user_id", userId);

  if (favoriteError) {
    logger.error("getFavoriteProjectIds: failed to load favourite rows", { error: favoriteError });
    return new Set();
  }

  const favoriteProjectIds = (favoriteRows ?? []).map((row) => row.project_id);
  if (favoriteProjectIds.length === 0) return new Set();

  // Re-derive visibility the SAME way `getWorkspaceProjects` does (RLS-
  // backed `createClient()`, `deleted_at is null`, scoped to this
  // workspace) rather than trusting every favourite row is still visible
  // -- this is the filter that keeps an orphaned favourite from ever
  // rendering as pinned (see this function's header comment).
  const { data: visibleRows, error: visibleError } = await supabase
    .from("projects")
    .select("id")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .in("id", favoriteProjectIds);

  if (visibleError) {
    logger.error("getFavoriteProjectIds: failed to re-check project visibility", { error: visibleError });
    return new Set();
  }

  return new Set((visibleRows ?? []).map((row) => row.id));
}

export type ProjectDetail = {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  deletedAt: string | null;
  // F013 (TT-030): project key + billing model for the layout header
  // badges. Same query as the rest of this row, no second round trip.
  key: string | null;
  billingModel: "hourly" | "fixed_price";
};

// F030 (AS-038): fetches a single project by id, scoped to the current
// workspace, for the project detail layout's header/tabs. Deliberately
// uses the admin client rather than the RLS-backed client: the
// `projects_select_active_members` policy (supabase/migrations/
// 20260818004709_rls_projects.sql) filters `deleted_at IS NULL`, which
// would 404 an archived project. AS-032 (F029) already established that an
// archived project's row must remain fully readable — "works for both
// active and archived projects per F029" in this feature's own spec means
// this query cannot rely on the RLS SELECT policy alone.
//
// Callers MUST independently verify the caller is an active member of
// `workspaceId` before calling this (the admin client bypasses RLS
// entirely) — the workspace layout guard (F010/F023) already does this for
// every route under /w/[workspaceSlug], and the `.eq("workspace_id", ...)`
// filter below additionally prevents a projectId from one workspace being
// read while impersonating a different workspaceId.
export const getProjectById = cache(async function getProjectById(
  workspaceId: string,
  projectId: string,
): Promise<ProjectDetail | null> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("projects")
    .select(
      "id, workspace_id, name, description, start_date, end_date, created_at, deleted_at, key, billing_model",
    )
    .eq("id", projectId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    workspaceId: data.workspace_id,
    name: data.name,
    description: data.description,
    startDate: data.start_date,
    endDate: data.end_date,
    createdAt: data.created_at,
    deletedAt: data.deleted_at,
    key: data.key ?? null,
    billingModel:
      (data.billing_model as "hourly" | "fixed_price" | null) ??
      "fixed_price",
  };
});

// F142 (AS-250, AS-251, AS-256): data for the archive view
// (`/w/[workspaceSlug]/archive`).
//
// AS-250 ("archived projects leave the active project list") is already
// satisfied by `getWorkspaceProjects` above's pre-existing
// `.is("deleted_at", null)` filter — verified, not re-fixed here (see
// `tests/unit/archived-projects-excluded.test.ts`). This function is the
// mirror-image query: everything `getWorkspaceProjects` excludes.
//
// Uses the admin client, same justification as `getProjectById` just
// above: `projects_select_active_members` filters `deleted_at IS NULL`,
// which would hide every row this query needs. Callers MUST independently
// verify the caller is an active member of `workspaceId` before calling
// this (the page does, via the layout guard + its own membership lookup,
// same pattern `getProjectById`'s callers already follow).
export type ArchivedProjectListItem = {
  id: string;
  name: string;
  description: string | null;
  archivedAt: string;
  archivedByName: string | null;
  taskCount: number;
};

export async function getArchivedWorkspaceProjects(
  workspaceId: string,
): Promise<ArchivedProjectListItem[]> {
  const admin = createAdminClient();

  // Feature-detect `archived_by` (F142's migration,
  // supabase/migrations/20260822000000_projects_archived_by.sql): this
  // worker's sandbox could not confirm the migration was applied to the
  // linked project (`supabase db push`/`migration list` both hung —
  // documented in this feature's handoff), so the column may not exist
  // live yet. Selecting it explicitly and falling back to a
  // column-free select on a "column does not exist" error (Postgres
  // code 42703) means the archive view still renders (AS-250, AS-256)
  // even before the migration lands, and picks up "by whom" automatically
  // (no code change needed) the moment it does.
  let rows: { id: string; name: string; description: string | null; deleted_at: string | null; archived_by?: string | null }[] = [];

  const withArchivedBy = await admin
    .from("projects")
    // `archived_by` isn't in the generated `Database` type yet (same
    // reason as `archiveProject`'s write side, lib/actions/projects.ts) —
    // `.returns<T>()` overrides the compile-time result shape for this
    // one query without an unsafe cast on the whole call.
    .select("id, name, description, deleted_at, archived_by")
    .eq("workspace_id", workspaceId)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false })
    .returns<
      {
        id: string;
        name: string;
        description: string | null;
        deleted_at: string | null;
        archived_by: string | null;
      }[]
    >();

  if (withArchivedBy.error) {
    if (
      withArchivedBy.error.code === "42703" ||
      withArchivedBy.error.code === "PGRST204"
    ) {
      const withoutArchivedBy = await admin
        .from("projects")
        .select("id, name, description, deleted_at")
        .eq("workspace_id", workspaceId)
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false });

      if (withoutArchivedBy.error) {
        throw withoutArchivedBy.error;
      }
      rows = withoutArchivedBy.data ?? [];
    } else {
      throw withArchivedBy.error;
    }
  } else {
    rows = withArchivedBy.data ?? [];
  }

  if (rows.length === 0) return [];

  const projectIds = rows.map((row) => row.id);

  // Task counts: one batched query for every archived project's tasks
  // (no per-row/N+1 network call), same performance budget
  // `getWorkspaceProjects`'s own header comment follows. Non-deleted tasks
  // only, matching this codebase's soft-delete convention.
  const { data: taskRows, error: taskError } = await admin
    .from("tasks")
    .select("project_id")
    .in("project_id", projectIds)
    .is("deleted_at", null);

  if (taskError) {
    logger.error("getArchivedWorkspaceProjects: task count query failed", { error: taskError });
  }

  const taskCountByProject = new Map<string, number>();
  for (const task of taskRows ?? []) {
    taskCountByProject.set(
      task.project_id,
      (taskCountByProject.get(task.project_id) ?? 0) + 1,
    );
  }

  // "By whom" (AS-251): resolve archiver display names in one batched
  // call, same `resolvePeople` used by the audit log page
  // (app/(workspace)/w/[workspaceSlug]/settings/audit/page.tsx) — not a
  // new name-resolution path.
  const archiverIds = Array.from(
    new Set(
      rows
        .map((row) => row.archived_by)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const archiverNames =
    archiverIds.length > 0
      ? await resolvePeople(archiverIds)
      : new Map<string, { name: string | null; email: string | null; avatarUrl: string | null }>();

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    archivedAt: row.deleted_at as string,
    archivedByName: row.archived_by
      ? (archiverNames.get(row.archived_by)?.name ??
        archiverNames.get(row.archived_by)?.email ??
        null)
      : null,
    taskCount: taskCountByProject.get(row.id) ?? 0,
  }));
}

// Feature request "Project health badge": batched per-project inputs to
// `computeProjectHealth` (lib/projects/compute-health.ts) for every
// project id passed in — one query for overdue/total task counts and one
// for each project's current `active` phase, never a per-project N+1,
// same performance convention as `getOpenTaskCounts` above.
export type ProjectHealthQueryInput = {
  overdueTaskCount: number;
  totalTaskCount: number;
  // Derived from the same `taskRows` fetch as `totalTaskCount`, so the two
  // are always consistent. "Done" is the column category, the same
  // definition `get_open_task_counts` uses.
  doneTaskCount: number;
  currentPhase: {
    name: string | null;
    state: "not_started" | "active" | "blocked" | "done";
    plannedStart: string | null;
    plannedEnd: string | null;
  } | null;
};

export async function getProjectHealthInputs(
  projectIds: string[],
): Promise<Map<string, ProjectHealthQueryInput>> {
  const result = new Map<string, ProjectHealthQueryInput>();
  if (projectIds.length === 0) return result;

  const supabase = await createClient();
  const todayIso = new Date().toISOString().slice(0, 10);

  // One batched select of every project's non-deleted tasks with their
  // column category, reduced per project in JS.
  const { data: taskRows, error: taskError } = await supabase
    .from("tasks")
    .select("project_id, due_date, status, project_statuses(category)")
    .in("project_id", projectIds)
    .is("deleted_at", null);

  if (taskError) {
    logger.error("getProjectHealthInputs: task query failed", { error: taskError });
  }

  const tasksByProject = new Map<string, ProjectHealthTask[]>();
  for (const task of taskRows ?? []) {
    const joined = task.project_statuses as
      | { category: string | null }
      | { category: string | null }[]
      | null;
    const category = Array.isArray(joined) ? (joined[0]?.category ?? null) : (joined?.category ?? null);
    const list = tasksByProject.get(task.project_id) ?? [];
    list.push({ status: task.status, category, dueDate: task.due_date });
    tasksByProject.set(task.project_id, list);
  }

  // One query for every project's phases -- the "current" phase is the
  // first `active` phase by position; a project with no active phase
  // (everything not_started/blocked/done, or no phases at all) has no
  // current phase to evaluate, which computeProjectHealth already treats
  // as "nothing to be at risk of from a phase".
  const { data: phaseRows, error: phaseError } = await supabase
    .from("project_phases")
    .select("project_id, name, state, planned_start, planned_end, position")
    .in("project_id", projectIds)
    .eq("state", "active")
    .order("position", { ascending: true });

  if (phaseError) {
    logger.error("getProjectHealthInputs: phase query failed", { error: phaseError });
  }

  const currentPhaseByProject = new Map<
    string,
    { name: string | null; state: "not_started" | "active" | "blocked" | "done"; plannedStart: string | null; plannedEnd: string | null }
  >();
  for (const phase of phaseRows ?? []) {
    if (currentPhaseByProject.has(phase.project_id)) continue;
    currentPhaseByProject.set(phase.project_id, {
      name: phase.name ?? null,
      state: phase.state as "not_started" | "active" | "blocked" | "done",
      plannedStart: phase.planned_start,
      plannedEnd: phase.planned_end,
    });
  }

  for (const projectId of projectIds) {
    const counts = countProjectHealthTasks(tasksByProject.get(projectId) ?? [], todayIso);
    result.set(projectId, {
      overdueTaskCount: counts.overdueTaskCount,
      totalTaskCount: counts.totalTaskCount,
      doneTaskCount: counts.doneTaskCount,
      currentPhase: currentPhaseByProject.get(projectId) ?? null,
    });
  }

  return result;
}

// F004 (AS-050, AS-051, AS-052): the workspace home "My projects" card's
// per-project progress data — scoped to projects the CALLING user is
// actually a `project_members` row on (AS-052), not every project in the
// workspace (that's `getWorkspaceProjects` above).
//
// `doneCount`/`overdueCount` reuse the same status_id → category
// resolution (with the same "status_id not yet backfilled" name-match
// fallback) that `getPortalProjects` already established via
// `buildStatusBucketMaps` — a project can rename/replace its board
// columns (F218+), so "done" must mean the column's CATEGORY, never a
// literal status string. `overdueCount` counts non-done tasks whose
// `due_date` is strictly before today (UTC calendar date, matching this
// codebase's other date-only comparisons like `getPortalProjects`'s
// `today < task.due_date` check — no per-caller timezone was specified in
// this feature's clarified spec, unlike the RPC-based dashboard tiles in
// lib/queries/dashboard.ts that do take one).
//
// `nextMilestoneName`/`nextMilestoneDate` are always `null`: this
// feature's own clarified "Logic" section never describes how to derive a
// milestone (no `project_phases`/milestone table read is specified), only
// the three counts. AUTONOMOUS_DECISION: kept the two fields in the type
// (as clarified) but left them unpopulated rather than guessing an
// unspec'd milestone source — no assertion (AS-050/051/052) exercises
// them. See handoff "Out-of-scope work needed" for wiring them up.
export type MyProjectProgress = {
  projectId: string;
  projectName: string;
  projectKey: string;
  doneCount: number;
  totalCount: number;
  overdueCount: number;
  nextMilestoneName: string | null;
  nextMilestoneDate: string | null; // ISO date
};

export async function getMyProjectsProgress(
  workspaceId: string,
  userId: string,
): Promise<MyProjectProgress[]> {
  const supabase = await createClient();

  // Step 1: project ids where `userId` is a project_member, joined to
  // `projects` and scoped to this workspace + not soft-deleted (archived
  // projects are soft-deleted via `deleted_at`, same convention as
  // `getWorkspaceProjects`).
  const { data: memberRows, error: memberError } = await supabase
    .from("project_members")
    .select("project_id, projects!inner(id, name, key, workspace_id, deleted_at)")
    .eq("user_id", userId)
    .eq("projects.workspace_id", workspaceId)
    .is("projects.deleted_at", null);

  if (memberError) {
    logger.error("getMyProjectsProgress: failed to load member projects", { error: memberError });
    return [];
  }

  type MemberRow = {
    project_id: string;
    projects: { id: string; name: string; key: string | null; workspace_id: string; deleted_at: string | null } | null;
  };

  const projects = ((memberRows ?? []) as unknown as MemberRow[])
    .map((row) => row.projects)
    .filter((p): p is NonNullable<MemberRow["projects"]> => p !== null);

  if (projects.length === 0) return [];

  const projectIds = projects.map((p) => p.id);

  // Step 2: tasks + statuses for every member project, one batched query
  // each (never per-project), same convention as getPortalProjects.
  const [{ data: taskRows, error: taskError }, { data: statusRows, error: statusError }] =
    await Promise.all([
      supabase
        .from("tasks")
        .select("id, project_id, status, status_id, due_date")
        .in("project_id", projectIds)
        .is("deleted_at", null),
      supabase
        .from("project_statuses")
        .select("id, project_id, name, category, client_bucket")
        .in("project_id", projectIds),
    ]);

  if (taskError) {
    logger.error("getMyProjectsProgress: failed to load tasks", { error: taskError });
  }
  if (statusError) {
    logger.error("getMyProjectsProgress: failed to load statuses", { error: statusError });
  }

  const { categoryByStatusId, categoryByProjectAndName } = buildStatusBucketMaps(
    (statusRows ?? []) as StatusRowWithBucket[],
  );

  const todayIso = new Date().toISOString().slice(0, 10);

  const totalByProject = new Map<string, number>();
  const doneByProject = new Map<string, number>();
  const overdueByProject = new Map<string, number>();

  for (const task of taskRows ?? []) {
    totalByProject.set(task.project_id, (totalByProject.get(task.project_id) ?? 0) + 1);

    const category =
      (task.status_id ? categoryByStatusId.get(task.status_id) : undefined) ??
      categoryByProjectAndName.get(`${task.project_id}:${task.status}`) ??
      "not_started";

    const isDone = category === "done";
    if (isDone) {
      doneByProject.set(task.project_id, (doneByProject.get(task.project_id) ?? 0) + 1);
    }

    if (!isDone && typeof task.due_date === "string" && task.due_date < todayIso) {
      overdueByProject.set(task.project_id, (overdueByProject.get(task.project_id) ?? 0) + 1);
    }
  }

  // Step 4: overdueCount desc, then projectName asc.
  return projects
    .map((project) => ({
      projectId: project.id,
      projectName: project.name,
      projectKey: project.key ?? "",
      doneCount: doneByProject.get(project.id) ?? 0,
      totalCount: totalByProject.get(project.id) ?? 0,
      overdueCount: overdueByProject.get(project.id) ?? 0,
      nextMilestoneName: null,
      nextMilestoneDate: null,
    }))
    .sort((a, b) => {
      if (b.overdueCount !== a.overdueCount) return b.overdueCount - a.overdueCount;
      return a.projectName.localeCompare(b.projectName);
    });
}

export type ProjectTeamPreview = {
  people: UserAvatarPerson[];
  total: number;
};

// PL-011..PL-013: one batched task_assignees query (inner-joined to open,
// non-deleted tasks) plus one batched profile lookup, regardless of project
// count. Up to 4 distinct assignees per project, plus the distinct total.
export async function getProjectTeamPreview(
  projectIds: string[],
): Promise<Map<string, ProjectTeamPreview>> {
  const result = new Map<string, ProjectTeamPreview>();
  if (projectIds.length === 0) return result;

  const supabase = await createClient();
  const [{ data, error }, { data: statusRows, error: statusError }] = await Promise.all([
    supabase
      .from("task_assignees")
      .select("user_id, tasks!inner(project_id, status, status_id, deleted_at)")
      .in("tasks.project_id", projectIds)
      .is("tasks.deleted_at", null),
    supabase
      .from("project_statuses")
      .select("id, project_id, name, category, client_bucket")
      .in("project_id", projectIds),
  ]);
  if (error) throw error;
  if (statusError) throw statusError;

  // PL-013: "done" must mean the task's board-column CATEGORY
  // (project_statuses.category), not the literal status text — a project
  // can rename/replace its columns (F218+). Same category resolution (with
  // the same "status_id not yet backfilled" name-match fallback) as
  // getMyProjectsProgress above and getPortalProjects.
  const { categoryByStatusId, categoryByProjectAndName } = buildStatusBucketMaps(
    (statusRows ?? []) as StatusRowWithBucket[],
  );

  const byProject = new Map<string, string[]>();
  for (const row of (data ?? []) as unknown as Array<{
    user_id: string;
    tasks:
      | { project_id: string; status: string; status_id: string | null }
      | { project_id: string; status: string; status_id: string | null }[];
  }>) {
    const t = Array.isArray(row.tasks) ? row.tasks[0] : row.tasks;
    if (!t) continue;
    const category =
      (t.status_id ? categoryByStatusId.get(t.status_id) : undefined) ??
      categoryByProjectAndName.get(`${t.project_id}:${t.status}`) ??
      "not_started";
    if (category === "done") continue;
    const list = byProject.get(t.project_id) ?? [];
    if (!list.includes(row.user_id)) list.push(row.user_id);
    byProject.set(t.project_id, list);
  }

  const shown = new Set<string>();
  for (const ids of byProject.values()) for (const id of ids.slice(0, 4)) shown.add(id);
  const profiles = await resolvePeople([...shown]);

  for (const [projectId, ids] of byProject) {
    result.set(projectId, {
      total: ids.length,
      people: ids.slice(0, 4).map((id) => ({
        id,
        name: profiles.get(id)?.name ?? null,
        email: profiles.get(id)?.email ?? null,
        avatarUrl: profiles.get(id)?.avatarUrl ?? null,
      })),
    });
  }
  return result;
}
