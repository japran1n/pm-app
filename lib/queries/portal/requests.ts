import { logger } from "@/lib/observability/logger";
import { getRequestClient } from "@/lib/auth/current-user";

// --- Client requests (C5) ---------------------------------------------------

export type PortalRequest = {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  body: string | null;
  desiredBy: string | null;
  status: "submitted" | "in_review" | "accepted" | "declined";
  declineReason: string | null;
  convertedTaskId: string | null;
  convertedTaskTitle: string | null;
  convertedTaskStatus: string | null;
  createdAt: string;
};

// Every client request on this workspace's portal-enabled projects, not
// just the ones this caller filed. F016e (missions/20260903-portal,
// M3-scrutiny defect 2, AS-048): `client_requests_select_author_or_team`
// used to scope a client caller to `created_by = auth.uid()` — two people
// from the same client company each saw only the half of their own
// project's requests they personally authored. The policy is now
// project-scoped, the same shape every other client-facing SELECT policy
// in this file already uses, so no `created_by` filter is repeated here
// either.
//
// F006b (missions/20260903-portal, AS-007): the `projects` read below
// filters on `portal_enabled` explicitly, the same load-bearing reason
// `getPortalProjects` states on its own identical filter — RLS does not
// gate an ordinary `projects` SELECT by `portal_enabled` (that column has
// no bearing on ordinary project visibility), so this is the actual gate
// for this function's `projectNames` map AND, because it narrows the
// `project_id in (...)` list the `client_requests` query below is scoped
// to, for the requests themselves too. `client_requests_select_author_or_
// team` (20260913010000) now folds the same `portal_enabled` check into
// the author's own branch as a second, database-level gate — this filter
// stays as belt-and-braces so a caller of this function never has to
// reason about a portal-disabled project's id reaching either query.
export async function getPortalRequests(
  workspaceId: string,
): Promise<PortalRequest[]> {
  const supabase = await getRequestClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .eq("portal_enabled", true);

  const projectNames = new Map(
    (projects ?? []).map((p) => [p.id as string, p.name as string]),
  );

  if (projectNames.size === 0) return [];

  const { data, error } = await supabase
    .from("client_requests")
    .select(
      "id, project_id, title, body, desired_by, status, decline_reason, converted_task_id, created_at, tasks(title, status)",
    )
    .in("project_id", [...projectNames.keys()])
    .order("created_at", { ascending: false });

  if (error) {
    logger.error("getPortalRequests failed", { error: error });
    return [];
  }

  return (data ?? []).map((row) => {
    // The embedded task is only readable when it is shared with the client
    // — which `acceptClientRequest` guarantees for anything it converts.
    // A null here therefore means "accepted, then later un-shared by the
    // team", which the UI renders as accepted without a link rather than
    // pretending the task does not exist.
    const task = Array.isArray(row.tasks) ? row.tasks[0] : row.tasks;

    return {
      id: row.id,
      projectId: row.project_id,
      projectName: projectNames.get(row.project_id) ?? "",
      title: row.title,
      body: row.body,
      desiredBy: row.desired_by,
      status: row.status as PortalRequest["status"],
      declineReason: row.decline_reason,
      convertedTaskId: row.converted_task_id,
      convertedTaskTitle: task?.title ?? null,
      convertedTaskStatus: task?.status ?? null,
      createdAt: row.created_at,
    };
  });
}
