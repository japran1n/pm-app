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
// AS-034 (open task count): the `tasks` table does not exist yet (lands in
// M4, F033+ — confirmed via `find supabase/migrations -iname "*task*"`
// returning no results). A LEFT JOIN/count against a nonexistent table
// cannot be executed today, so the count is intentionally omitted here
// rather than hardcoded to a fake number. `openTaskCount` is typed
// `number | null` so the UI can render an explicit "pending" state, and the
// TODO below marks exactly where to wire in the real count once the tasks
// table exists.

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
  // TODO(F033+): replace with a real count once the tasks table exists —
  // e.g. `projects.select("*, tasks!inner(count)")` filtered to
  // non-completed, non-deleted tasks, or a dedicated RPC/view. Until then
  // this is always null (never a fake 0) so the UI can distinguish
  // "not yet supported" from "genuinely zero open tasks".
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

  return (data ?? []).map((project) => ({
    id: project.id,
    name: project.name,
    description: project.description,
    startDate: project.start_date,
    endDate: project.end_date,
    createdAt: project.created_at,
    key: project.key ?? null,
    openTaskCount: null,
  }));
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
export async function getProjectById(
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
}

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
    console.error(
      "getArchivedWorkspaceProjects: task count query failed:",
      taskError,
    );
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
