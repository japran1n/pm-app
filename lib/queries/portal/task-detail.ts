import { getRequestClient } from "@/lib/auth/current-user";
import type { StatusCategory } from "./shared";
import type { PortalTask } from "./projects";

// --- Task detail + conversation (C7) ---------------------------------------

export type PortalComment = {
  id: string;
  text: string;
  createdAt: string;
  authorId: string;
  authorName: string | null;
  isMine: boolean;
};

export type PortalTaskDetail = PortalTask & {
  projectId: string;
  projectName: string;
  description: string | null;
  comments: PortalComment[];
  // F4 (docs/client-dashboard-features-plan.md): drives the
  // Approve/Request changes controls on this page.
  pendingClientApproval: boolean;
};

// One shared task, with the part of its conversation the client is allowed
// to see. RLS decides both halves: a task that is not shared returns no
// row, and an internal comment returns no row — so `null` here means
// "nothing to show", never "hidden but present".
export async function getPortalTaskDetail(
  workspaceId: string,
  taskId: string,
  currentUserId: string,
): Promise<PortalTaskDetail | null> {
  const supabase = await getRequestClient();

  const { data: task, error } = await supabase
    .from("tasks")
    .select(
      "id, title, status, status_id, due_date, description, project_id, pending_client_approval",
    )
    .eq("id", taskId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !task) return null;

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, workspace_id")
    .eq("id", task.project_id)
    .maybeSingle();

  // Guards against a task id from another workspace being rendered inside
  // this workspace's portal chrome.
  if (!project || project.workspace_id !== workspaceId) return null;

  const { data: statuses } = await supabase
    .from("project_statuses")
    .select("id, name, category, client_bucket")
    .eq("project_id", task.project_id);

  const matchedStatus =
    (statuses ?? []).find((s) => s.id === task.status_id) ??
    (statuses ?? []).find((s) => s.name === task.status) ??
    null;
  const category = matchedStatus?.category ?? "not_started";
  const clientBucket = matchedStatus?.client_bucket ?? null;

  const { data: comments } = await supabase
    .from("comments")
    .select("id, text, created_at, user_id")
    .eq("task_id", taskId)
    .is("deleted_at", null)
    .order("created_at");

  const authorIds = [...new Set((comments ?? []).map((c) => c.user_id))];
  const names = new Map<string, string | null>();

  if (authorIds.length > 0) {
    // A client cannot read the team's profiles (20260902020000), so this
    // returns their own name and nothing else. Rather than render blanks,
    // the UI falls back to the workspace name for anyone it cannot
    // resolve — from the client's side "someone at the agency said this"
    // is the honest and sufficient attribution.
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", authorIds);
    for (const profile of profiles ?? []) {
      names.set(profile.id, profile.display_name);
    }
  }

  return {
    id: task.id,
    title: task.title,
    status: task.status,
    statusId: task.status_id,
    dueDate: task.due_date,
    category: category as StatusCategory,
    clientBucket,
    projectId: project.id,
    projectName: project.name,
    description: task.description,
    comments: (comments ?? []).map((comment) => ({
      id: comment.id,
      text: comment.text,
      createdAt: comment.created_at,
      authorId: comment.user_id,
      authorName: names.get(comment.user_id) ?? null,
      isMine: comment.user_id === currentUserId,
    })),
    pendingClientApproval: task.pending_client_approval ?? false,
  };
}
