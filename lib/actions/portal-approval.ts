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

  // Plain RLS-respecting UPDATE is not reachable here: `tasks_update_
  // active_members` (20260821194500) is the only UPDATE policy on `tasks`,
  // and `is_project_workspace_writer()` (20260902010000) explicitly
  // excludes `role = 'client'` -- a client is read-only on `tasks`
  // everywhere else in this schema. `approve_portal_task_atomic`
  // (20260905130000) is the one narrow, SECURITY DEFINER exception: it
  // re-verifies the caller is an active client member with this task
  // shared and pending before flipping exactly this one column.
  const supabase = await createClient();
  const { error: updateError } = await supabase.rpc(
    "approve_portal_task_atomic",
    { p_task_id: taskId },
  );

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

  // Unlike Approve's fixed trail comment (best-effort, posted *after* the
  // flag flips, because the approval itself is the payload there), the
  // client's own message here IS the payload -- "request changes" without
  // the note is meaningless to the team. So the ordering is deliberately
  // the opposite of approvePortalTask: post the comment FIRST, and only
  // flip `pending_client_approval` once it has landed. If addComment
  // fails, we return before touching the RPC, so the row is still pending
  // and `assert_portal_task_actionable_by_client`'s `v_pending` check will
  // let the client retry with the same message instead of being told
  // "task not found" forever.
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

  // Same reasoning as approvePortalTask above: a plain RLS-respecting
  // UPDATE is not reachable for a `client` role, so this routes through
  // `request_portal_task_changes_atomic` (20260906010000), the sibling of
  // `approve_portal_task_atomic` that shares the same caller/visibility/
  // pending re-verification via `assert_portal_task_actionable_by_client`.
  //
  // If this RPC call fails after the comment above already landed, the
  // client's note is not lost (it's already a comment on the task) and the
  // row is still pending, so a retry is safe -- at worst it re-posts an
  // identical "Requested changes: ..." comment, which is an acceptable
  // trade-off against silently discarding the client's writing.
  const supabase = await createClient();
  const { error: updateError } = await supabase.rpc(
    "request_portal_task_changes_atomic",
    { p_task_id: parsed.data.taskId },
  );

  if (updateError) {
    logger.error("requestPortalTaskChanges: update failed", { error: updateError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  revalidatePath("/portal", "layout");
  revalidatePath("/w", "layout");

  return { ok: true, data: { taskId: parsed.data.taskId } };
}

// --- F009 (missions/20260903-portal, AS-021/AS-022/AS-023/AS-026) -------
//
// The client's decision on a first-class `approval_requests` row (raised
// by F008's dialog, distinct from the task-boolean flow above). The RPC
// (`decide_approval_atomic`, 20260916010000, hardened by 20260920010000)
// is the actual control -- AS-022 -- re-checking `auth.uid()` against
// `project_decision_owners` itself, independent of anything this action
// or its caller's UI does. This action's own job is: validate shape,
// call the RPC through the ordinary RLS-respecting session client (never
// the admin client -- the RPC needs `auth.uid()` to be the real signed-in
// caller, exactly like `approvePortalTask` above), and translate its
// (already caller-safe, no-schema-leaking) error text into this file's
// `{ ok: false, error }` shape.
const decideApprovalSchema = z
  .object({
    requestId: z.string().uuid("Invalid approval request."),
    decision: z.enum(["approved", "changes_requested"]),
    note: z.string().trim().max(4000, "Note must be 4000 characters or fewer.").nullable().optional(),
  })
  .superRefine((value, ctx) => {
    // Mirrors the RPC's own `p_decision = 'changes_requested'` guard
    // (20260916010000) -- checked here too so the client gets this exact
    // message from the form itself, never a round trip just to learn it.
    if (value.decision === "changes_requested" && !value.note?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["note"],
        message: "Describe what needs to change.",
      });
    }
  });

export type DecideApprovalResult =
  | {
      ok: true;
      data: {
        requestId: string;
        state: string;
        decidedAt: string;
        // F011 (AS-025): set when this decision was `changes_requested`
        // and created a task — never client_visible by default (see the
        // RPC's own migration comment), so this id exists to let the
        // portal card SAY the work was created without ever forming a
        // link to it (approval-card.tsx never renders it as a link).
        resultingTaskId: string | null;
      };
    }
  | { ok: false; error: string };

function friendlyDecideApprovalError(message: string): string {
  // The RPC's own exception text (20260916010000/20260920010000) is
  // already written to be caller-safe -- no column/table names, no
  // internals -- so it is shown directly, minus its `decide_approval_
  // atomic: ` function-name prefix, rather than collapsed to one generic
  // string that would hide "you are not the decision owner" and "this
  // request has already been decided" behind the same unhelpful text.
  const withoutPrefix = message.replace(/^decide_approval_atomic:\s*/, "");
  return withoutPrefix || "Something went wrong. Please try again in a moment.";
}

export async function decideApproval(
  requestId: string,
  decision: "approved" | "changes_requested",
  note?: string | null,
): Promise<DecideApprovalResult> {
  const parsed = decideApprovalSchema.safeParse({ requestId, decision, note: note ?? null });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid request.",
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("decide_approval_atomic", {
    p_request_id: parsed.data.requestId,
    p_decision: parsed.data.decision,
    p_note: parsed.data.note ?? null,
  });

  if (error) {
    logger.error("decideApproval: rpc failed", { error });
    return { ok: false, error: friendlyDecideApprovalError(error.message) };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    logger.error("decideApproval: rpc returned no row", { requestId: parsed.data.requestId });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  revalidatePath("/portal", "layout");
  revalidatePath("/w", "layout");

  return {
    ok: true,
    data: {
      requestId: row.request_id as string,
      state: row.state as string,
      decidedAt: row.decided_at as string,
      resultingTaskId: (row.resulting_task_id as string | null) ?? null,
    },
  };
}
