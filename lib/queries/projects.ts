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

export type ProjectListItem = {
  id: string;
  name: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  // TODO(F033+): replace with a real count once the tasks table exists —
  // e.g. `projects.select("*, tasks!inner(count)")` filtered to
  // non-completed, non-deleted tasks, or a dedicated RPC/view. Until then
  // this is always null (never a fake 0) so the UI can distinguish
  // "not yet supported" from "genuinely zero open tasks".
  openTaskCount: number | null;
};

export async function getWorkspaceProjects(
  workspaceId: string,
): Promise<ProjectListItem[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("projects")
    .select("id, name, description, start_date, end_date, created_at")
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
