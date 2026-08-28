"use server";
import { logger } from "@/lib/observability/logger";


// F4 (docs/client-dashboard-features-plan.md): the client's half of the F1
// approval flag — Approve or Request changes, from the portal, on a task
// the team marked `pending_client_approval`.
//
// Unlike addComment (lib/actions/comments.ts), which serves both team and
// client callers, these two actions are client-only: a team member has no
// use for "approve my own request for approval". Both reuse addComment
// for the actual comment write rather than inserting into `comments`
// directly, so mention parsing, activity logging and notification fan-out
// all stay in the one place that already does that correctly — this file
// only adds the permission gate and the `pending_client_approval` flip
// around that call.
//
// Same shape as every other mutating action in this codebase: Zod-validated
// input, membership/role re-checked server-side, admin client for the
// lookup, RLS-respecting client for the actual update, generic user-facing
// errors with detail logged server-side only.

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { isClient } from "@/lib/auth/permissions";
import { addComment } from "@/lib/actions/comments";

type PortalApprovalResult =
  | { ok: true; data: { taskId: string } }
  | { ok: false; error: string };

async function resolvePendingClientTask(
  taskId: string,
): Promise<
  | { ok: true; workspaceId: string }
  | { ok: false; error: string }
> {
  const admin = createAdminClient();

  const { data: taskRow, error: taskError } = await admin
    .from("tasks")
    .select(
      "id, client_visible, pending_client_approval, projects!inner(workspace_id)",
    )
    .eq("id", taskId)
    .is("deleted_at", null)
    .maybeSingle();

  if (taskError || !taskRow) {
    return { ok: false, error: "Task not found." };
  }

  const project = taskRow.projects as
    | { workspace_id: string }
    | { workspace_id: string }[]
    | null;
  const workspaceId = Array.isArray(project)
    ? project[0]?.workspace_id
    : project?.workspace_id;

  if (!workspaceId) {
    return { ok: false, error: "Task not found." };
  }

  // A client cannot act on a task that isn't shared with them (whether it
  // exists internally is not their business — same generic message as
  // addComment's equivalent check), nor on one nobody asked them about.
  if (!taskRow.client_visible || !taskRow.pending_client_approval) {
    return { ok: false, error: "Task not found." };
  }

  return { ok: true, workspaceId };
}

async function requireClientCaller(workspaceId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false as const, error: "You must be signed in." };
  }

  const admin = createAdminClient();
  const membership = await requireActiveMembership(admin, workspaceId, user.id);

  if (!membership.ok || !isClient({ role: membership.role })) {
    return { ok: false as const, error: "Task not found." };
  }

  return { ok: true as const };
}

export async function approvePortalTask(
  taskId: string,
): Promise<PortalApprovalResult> {
  const parsed = z.string().uuid().safeParse(taskId);
  if (!parsed.success) {
    return { ok: false, error: "Invalid task." };
  }

  const resolved = await resolvePendingClientTask(taskId);
  if (!resolved.ok) return resolved;

  const caller = await requireClientCaller(resolved.workspaceId);
  if (!caller.ok) return caller;

  const supabase = await createClient();
  const { error: updateError } = await supabase
    .from("tasks")
    .update({ pending_client_approval: false })
    .eq("id", taskId);

  if (updateError) {
    logger.error("approvePortalTask: update failed", { error: updateError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  // Best-effort: the approval itself already succeeded above, so a
  // failure to also post the trail comment is logged, not surfaced as a
  // failure of the approval the client just performed.
  const commentResult = await addComment(taskId, "✅ Approved.");
  if (!commentResult.ok) {
    logger.error("approvePortalTask: trail comment failed", { error: commentResult.error });
  }

  revalidatePath("/portal", "layout");
  revalidatePath("/w", "layout");

  return { ok: true, data: { taskId } };
}

export async function requestPortalTaskChanges(
  taskId: string,
  message: string,
): Promise<PortalApprovalResult> {
  const parsed = z
    .object({
      taskId: z.string().uuid("Invalid task."),
      message: z.string().trim().min(1, "Describe what needs to change."),
    })
    .safeParse({ taskId, message });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid request.",
    };
  }

  const resolved = await resolvePendingClientTask(parsed.data.taskId);
  if (!resolved.ok) return resolved;

  const caller = await requireClientCaller(resolved.workspaceId);
  if (!caller.ok) return caller;

  const supabase = await createClient();
  const { error: updateError } = await supabase
    .from("tasks")
    .update({ pending_client_approval: false })
    .eq("id", parsed.data.taskId);

  if (updateError) {
    logger.error("requestPortalTaskChanges: update failed", { error: updateError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  // Unlike Approve's fixed trail comment, the client's own message IS the
  // comment — that's the whole point of "request changes" over a bare
  // reject: the team gets the actual note, not just a status flip.
  const commentResult = await addComment(
    parsed.data.taskId,
    `Requested changes: ${parsed.data.message}`,
  );

  if (!commentResult.ok) {
    logger.error("requestPortalTaskChanges: comment failed", { error: commentResult.error });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  revalidatePath("/portal", "layout");
  revalidatePath("/w", "layout");

  return { ok: true, data: { taskId: parsed.data.taskId } };
}
