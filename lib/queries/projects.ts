import { cache } from "react";
import { logger } from "@/lib/observability/logger";

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

export type ProjectListItem = {
  id: string;
  name: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  // F145 (AS-257): the short project key (e.g. "PM") assigned at creation
  // time by a BEFORE INSERT trigger — nullable only for defensiveness
  // against any pre-F145 row that predates the column (none exist in
  // practice; the trigger backfills every insert going forward).
  key: string | null;
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

  const { data, error } = await supabase
    .from("projects")
    .select("id, name, description, start_date, end_date, created_at, key")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

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
    createdAt: project.created_at,
    key: project.key ?? null,
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
  const supabase = await createClient();

  let userId = preloadedUserId;
  if (!userId) {
    const { data: { user } } = await supabase.auth.getUser();
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
      "id, workspace_id, name, description, start_date, end_date, created_at, deleted_at",
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
