import { getRequestClient } from "@/lib/auth/current-user";

// --- Files (F3, docs/client-dashboard-features-plan.md) -------------------
//
// One list of every attachment on a task the client can see, instead of
// making them open each task to find one. RLS-scoped exactly like this
// file's other queries: attachments join back to tasks, and a client's own
// SELECT on `tasks` already only returns client_visible rows (20260902010000),
// so filtering here on client_visible again is belt-and-suspenders, not the
// real boundary.
//
// missions/20260914-portal-simplify: scoped to a single `projectId` (not
// every project in the workspace) — the Files nav item lives under a
// project's own portal shell, same "per-project, not per-workspace" scope
// every other portal query in this project-scoped family uses. Also
// excludes a project with `portal_enabled = false`, same convention as
// this file's siblings.

export type PortalFile = {
  id: string;
  fileName: string;
  createdAt: string;
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string;
};

export async function getPortalFiles(
  workspaceId: string,
  projectId: string,
): Promise<PortalFile[]> {
  const supabase = await getRequestClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .eq("id", projectId)
    .is("deleted_at", null)
    .eq("portal_enabled", true);

  const projectIds = (projects ?? []).map((p) => p.id);
  const projectNames = new Map((projects ?? []).map((p) => [p.id, p.name]));

  if (projectIds.length === 0) return [];

  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, title, project_id")
    .in("project_id", projectIds)
    .eq("client_visible", true)
    .is("deleted_at", null);

  const taskIds = (tasks ?? []).map((t) => t.id);
  if (taskIds.length === 0) return [];

  const taskById = new Map((tasks ?? []).map((t) => [t.id, t]));

  const { data: attachments } = await supabase
    .from("attachments")
    .select("id, file_name, created_at, task_id")
    .in("task_id", taskIds)
    .order("created_at", { ascending: false });

  return (attachments ?? []).flatMap((attachment) => {
    const task = taskById.get(attachment.task_id);
    if (!task) return [];
    return [
      {
        id: attachment.id,
        fileName: attachment.file_name,
        createdAt: attachment.created_at,
        taskId: task.id,
        taskTitle: task.title,
        projectId: task.project_id,
        projectName: projectNames.get(task.project_id) ?? "",
      },
    ];
  });
}
