"use server";

// C5 + C6 (docs/client-portal-plan.md): the client-request lifecycle.
//
// A client files a request; the team accepts it (which creates a real task
// and shares that task back with them) or declines it with a reason. The
// client never writes to `tasks` — see 20260902030000's own header for why
// this is a separate table.
//
// Writes go through the caller's own session, not the admin client, so the
// RLS policies are the enforcement and these actions are the second line:
// each one re-checks membership and permission itself (this codebase's
// AS-143 convention) but neither could grant access RLS denies.

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { canWrite, isClient } from "@/lib/auth/permissions";
import {
  acceptClientRequestSchema,
  createClientRequestSchema,
  declineClientRequestSchema,
  withdrawClientRequestSchema,
} from "@/lib/validation/client-requests";

export type ClientRequestResult<T = { requestId: string }> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";

// Resolves the workspace a request's project belongs to, plus the caller's
// role in it. Uses the admin client deliberately: this is the independent
// re-check, so it must be able to answer "what is this caller's real role"
// without relying on the same policies it exists to back up.
async function resolveRequestContext(
  requestId: string,
  userId: string,
): Promise<
  | {
      ok: true;
      projectId: string;
      workspaceId: string;
      role: string;
      status: string;
      title: string;
      body: string | null;
      desiredBy: string | null;
      createdBy: string;
    }
  | { ok: false; error: string }
> {
  const admin = createAdminClient();

  const { data: row, error } = await admin
    .from("client_requests")
    .select(
      "id, project_id, status, title, body, desired_by, created_by, projects!inner(workspace_id)",
    )
    .eq("id", requestId)
    .maybeSingle();

  if (error || !row) {
    return { ok: false, error: "Request not found." };
  }

  const project = row.projects as
    | { workspace_id: string }
    | { workspace_id: string }[]
    | null;
  const workspaceId = Array.isArray(project)
    ? project[0]?.workspace_id
    : project?.workspace_id;

  if (!workspaceId) {
    return { ok: false, error: "Request not found." };
  }

  const membership = await requireActiveMembership(admin, workspaceId, userId);
  if (!membership.ok) {
    // Same message as a genuinely missing row: a non-member must not be
    // able to tell the difference.
    return { ok: false, error: "Request not found." };
  }

  return {
    ok: true,
    projectId: row.project_id,
    workspaceId,
    role: membership.role,
    status: row.status,
    title: row.title,
    body: row.body,
    desiredBy: row.desired_by,
    createdBy: row.created_by,
  };
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

// --- Client side ------------------------------------------------------------

export async function createClientRequest(
  _prevState: ClientRequestResult | null,
  formData: FormData,
): Promise<ClientRequestResult> {
  const parsed = createClientRequestSchema.safeParse({
    projectId: formData.get("projectId"),
    title: formData.get("title"),
    body: formData.get("body") ?? "",
    desiredBy: formData.get("desiredBy") ?? "",
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check your request and try again.",
    };
  }

  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "You must be signed in." };

  const { data, error } = await supabase
    .from("client_requests")
    .insert({
      project_id: parsed.data.projectId,
      created_by: user.id,
      title: parsed.data.title,
      body: parsed.data.body ? parsed.data.body : null,
      desired_by: parsed.data.desiredBy ? parsed.data.desiredBy : null,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("createClientRequest failed:", error);
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath("/portal", "layout");
  return { ok: true, data: { requestId: data.id } };
}

// Withdraw: only the author, only while untouched. Enforced by the DELETE
// policy; re-checked here so the action returns a useful message rather
// than a silent zero-row delete.
export async function withdrawClientRequest(
  requestId: string,
): Promise<ClientRequestResult> {
  const parsed = withdrawClientRequestSchema.safeParse({ requestId });
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "You must be signed in." };

  const context = await resolveRequestContext(parsed.data.requestId, user.id);
  if (!context.ok) return context;

  if (context.createdBy !== user.id) {
    return { ok: false, error: "Request not found." };
  }
  if (context.status !== "submitted") {
    return {
      ok: false,
      error: "This request has already been reviewed, so it can't be withdrawn.",
    };
  }

  const { error } = await supabase
    .from("client_requests")
    .delete()
    .eq("id", parsed.data.requestId);

  if (error) {
    console.error("withdrawClientRequest failed:", error);
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath("/portal", "layout");
  return { ok: true, data: { requestId: parsed.data.requestId } };
}

// --- Team side --------------------------------------------------------------

function teamCanTriage(role: string): boolean {
  const ctx = { role: role as never };
  return canWrite(ctx) && !isClient(ctx);
}

export async function declineClientRequest(
  requestId: string,
  reason: string,
): Promise<ClientRequestResult> {
  const parsed = declineClientRequestSchema.safeParse({ requestId, reason });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid request.",
    };
  }

  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "You must be signed in." };

  const context = await resolveRequestContext(parsed.data.requestId, user.id);
  if (!context.ok) return context;

  if (!teamCanTriage(context.role)) {
    return { ok: false, error: "You don't have permission to review requests." };
  }

  const { error } = await supabase
    .from("client_requests")
    .update({
      status: "declined",
      decline_reason: parsed.data.reason,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.requestId);

  if (error) {
    console.error("declineClientRequest failed:", error);
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath("/w", "layout");
  revalidatePath("/portal", "layout");
  return { ok: true, data: { requestId: parsed.data.requestId } };
}

// C6: accept — create the real task and hand it back to the client.
//
// The task is created already shared (`client_visible: true`). Accepting a
// request the client can then not see would be a strange thing to do: they
// asked for it, and the acceptance is the promise that it is now on the
// board.
export async function acceptClientRequest(
  requestId: string,
): Promise<ClientRequestResult<{ requestId: string; taskId: string }>> {
  const parsed = acceptClientRequestSchema.safeParse({ requestId });
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "You must be signed in." };

  const context = await resolveRequestContext(parsed.data.requestId, user.id);
  if (!context.ok) return context;

  if (!teamCanTriage(context.role)) {
    return { ok: false, error: "You don't have permission to review requests." };
  }

  if (context.status === "accepted") {
    return { ok: false, error: "This request has already been accepted." };
  }

  // The task is created through the caller's own session, so it is subject
  // to the same `tasks` write policy as a task created by hand — accepting
  // a request is not a privileged back door into the board.
  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .insert({
      project_id: context.projectId,
      title: context.title,
      description: context.body,
      status: "todo",
      author_id: user.id,
      due_date: context.desiredBy,
      client_visible: true,
    })
    .select("id")
    .single();

  if (taskError || !task) {
    console.error("acceptClientRequest: task insert failed:", taskError);
    return { ok: false, error: GENERIC_ERROR };
  }

  const { error: updateError } = await supabase
    .from("client_requests")
    .update({
      status: "accepted",
      decline_reason: null,
      converted_task_id: task.id,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.requestId);

  if (updateError) {
    // The task exists but the link does not. Roll the task back rather than
    // leaving an orphan the client cannot see the origin of — the team can
    // retry cleanly, which is better than a board slowly filling with
    // duplicates from failed retries.
    console.error("acceptClientRequest: link update failed:", updateError);
    await supabase.from("tasks").delete().eq("id", task.id);
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath("/w", "layout");
  revalidatePath("/portal", "layout");
  return {
    ok: true,
    data: { requestId: parsed.data.requestId, taskId: task.id },
  };
}
