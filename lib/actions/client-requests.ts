"use server";
import { logger } from "@/lib/observability/logger";


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
    logger.error("createClientRequest failed", { error: error });
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
    logger.error("withdrawClientRequest failed", { error: error });
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
    logger.error("declineClientRequest failed", { error: error });
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
//
// W7e hardening: the task insert and the client_requests link update are
// atomic (see the accept_client_request_atomic RPC call below) -- this
// replaced an earlier hand-rolled compensating-delete rollback.
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

  // W7e hardening (missions/20260828-hardening/w7-atomicity-triage.md): the
  // task insert and the client_requests link update now happen inside a
  // single SECURITY DEFINER function, `accept_client_request_atomic`
  // (supabase/migrations/20260905100000_accept_client_request_atomic.sql),
  // invoked as one RPC call through the caller's own session (same
  // rationale as the rest of this file -- the task is still subject to the
  // same `tasks` write policy as a task created by hand). A single function
  // body runs in one implicit transaction, so if the client_requests update
  // fails, Postgres rolls back the task insert too -- there is no manual
  // compensating delete step, and therefore no window where that rollback
  // step can itself fail and leave an orphan task with no request link.
  const { data: rpcRows, error: rpcError } = await supabase.rpc(
    "accept_client_request_atomic",
    { p_request_id: parsed.data.requestId },
  );

  if (rpcError) {
    logger.error("acceptClientRequest: accept_client_request_atomic RPC failed", { error: rpcError });
    return { ok: false, error: GENERIC_ERROR };
  }

  const rpcResult = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;

  if (!rpcResult?.task_id) {
    logger.error("acceptClientRequest: accept_client_request_atomic RPC returned no task_id");
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath("/w", "layout");
  revalidatePath("/portal", "layout");
  return {
    ok: true,
    data: { requestId: parsed.data.requestId, taskId: rpcResult.task_id },
  };
}
