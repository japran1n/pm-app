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
import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { isClient } from "@/lib/auth/permissions";
import { addComment } from "@/lib/actions/comments";
import { assertNotPreview } from "@/lib/auth/assert-not-preview";
import { createNotification } from "@/lib/notifications/create-notification";
import { getPortalEventRecipients } from "@/lib/notifications/portal-recipients";

type PortalApprovalResult =
  | { ok: true; data: { taskId: string } }
  | { ok: false; error: string };

// F009d: `assert_portal_task_actionable_by_client` (20260925010000,
// hardened by 20261021010000) raises the shared, deliberately generic
// 'task not found' oracle for five of its six rejection branches, but
// names the sixth ("caller owns no decision type on this project") on
// its own -- see that migration's own header for why revealing only that
// one branch is safe. Recognise that one specific, caller-safe string
// and forward it so the client is told what actually happened (a
// configuration gap, not a crash) instead of the same generic error a
// real failure would show. Every other RPC error (including the shared
// 'task not found' oracle) still collapses to the generic message below,
// unchanged -- this is a narrow allow-list of ONE known-safe string, not
// a general "forward whatever the RPC said".
const NO_DECISION_OWNER_MESSAGE =
  "assert_portal_task_actionable_by_client: no one is assigned to decide this yet";
// Matches approval-card.tsx's own text for the identical situation on
// the Approvals view, so the two surfaces agree.
const NO_DECISION_OWNER_FRIENDLY_MESSAGE = "No one is assigned to decide this yet.";

function friendlyPortalTaskActionError(message: string | undefined): string {
  if (message === NO_DECISION_OWNER_MESSAGE) {
    return NO_DECISION_OWNER_FRIENDLY_MESSAGE;
  }
  return "Something went wrong. Please try again in a moment.";
}

async function resolvePendingClientTask(
  taskId: string,
): Promise<
  | { ok: true; workspaceId: string; projectId: string }
  | { ok: false; error: string }
> {
  const admin = createAdminClient();

  const { data: taskRow, error: taskError } = await admin
    .from("tasks")
    .select(
      "id, project_id, client_visible, pending_client_approval, projects!inner(workspace_id)",
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

  if (!workspaceId || !taskRow.project_id) {
    return { ok: false, error: "Task not found." };
  }

  // A client cannot act on a task that isn't shared with them (whether it
  // exists internally is not their business — same generic message as
  // addComment's equivalent check), nor on one nobody asked them about.
  if (!taskRow.client_visible || !taskRow.pending_client_approval) {
    return { ok: false, error: "Task not found." };
  }

  return { ok: true, workspaceId, projectId: taskRow.project_id };
}

// F084: fan out an in-app notification to the project's decision owners
// and the task's own assignee -- the team's only signal today that a
// client acted at all is remembering to open the right queue. Entirely
// best-effort/non-fatal (same convention as the trail comment above and
// every other post-write side effect in this file): the client's own
// action has already succeeded by the time this runs, and a failure to
// notify must never be reported back to the client as their action
// having failed.
async function notifyPortalTaskDecision(params: {
  taskId: string;
  projectId: string;
  workspaceId: string;
  actorId: string;
  decision: "approved" | "changes_requested";
}) {
  try {
    const admin = createAdminClient();
    const recipients = await getPortalEventRecipients(admin, {
      projectId: params.projectId,
      taskId: params.taskId,
      excludeUserId: params.actorId,
    });

    const supabase = await createClient();
    for (const userId of recipients) {
      await createNotification(
        supabase,
        {
          userId,
          workspaceId: params.workspaceId,
          kind: "portal_task_decided",
          taskId: params.taskId,
          payload: { decision: params.decision, taskId: params.taskId },
        },
        "notifyPortalTaskDecision",
      );
    }
  } catch (notifyError) {
    logger.error("notifyPortalTaskDecision: failed (non-fatal)", { error: notifyError });
  }
}

async function requireClientCaller(workspaceId: string) {
  const { user } = await getCurrentUser();

  if (!user) {
    return { ok: false as const, error: "You must be signed in." };
  }

  const admin = createAdminClient();
  const membership = await requireActiveMembership(admin, workspaceId, user.id);

  if (!membership.ok || !isClient({ role: membership.role })) {
    return { ok: false as const, error: "Task not found." };
  }

  return { ok: true as const, userId: user.id };
}

export async function approvePortalTask(
  taskId: string,
): Promise<PortalApprovalResult> {
  // F024b (AS-052): default-deny -- a previewing admin's session is a
  // real client session, so without this the RPC below would happily
  // record the admin's approval as the client's own decision.
  const preview = await assertNotPreview();
  if (!preview.ok) return preview;

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
      error: friendlyPortalTaskActionError(updateError.message),
    };
  }

  // Best-effort: the approval itself already succeeded above, so a
  // failure to also post the trail comment is logged, not surfaced as a
  // failure of the approval the client just performed.
  const commentResult = await addComment(taskId, "✅ Approved.");
  if (!commentResult.ok) {
    logger.error("approvePortalTask: trail comment failed", { error: commentResult.error });
  }

  // F084 (AS-2): the team currently has zero signal that a client
  // approved a task other than remembering to reopen it. Best-effort --
  // see notifyPortalTaskDecision's own doc comment.
  await notifyPortalTaskDecision({
    taskId,
    projectId: resolved.projectId,
    workspaceId: resolved.workspaceId,
    actorId: caller.userId,
    decision: "approved",
  });

  revalidatePath("/portal", "layout");
  revalidatePath("/w", "layout");

  return { ok: true, data: { taskId } };
}

export async function requestPortalTaskChanges(
  taskId: string,
  message: string,
): Promise<PortalApprovalResult> {
  // F024b (AS-052): see approvePortalTask's identical guard above.
  const preview = await assertNotPreview();
  if (!preview.ok) return preview;

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
      error: friendlyPortalTaskActionError(updateError.message),
    };
  }

  // F084 (AS-2): mirror of approvePortalTask's notification above, so a
  // rejection is at least as visible to the team as an approval -- the
  // defect this feature fixes is specifically that "request changes"
  // notified no one while carrying the exact same "silently swallowed"
  // failure mode as the byte-identical RPC it called.
  await notifyPortalTaskDecision({
    taskId: parsed.data.taskId,
    projectId: resolved.projectId,
    workspaceId: resolved.workspaceId,
    actorId: caller.userId,
    decision: "changes_requested",
  });

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
  // F024b (AS-052): this action had NO application-level authorisation at
  // all before this fix -- `decide_approval_atomic`'s own `auth.uid()`
  // decision-owner check was the only gate, and a preview session's
  // `auth.uid()` IS the client, so it passed. This is the required guard.
  const preview = await assertNotPreview();
  if (!preview.ok) return preview;

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

export type NudgeApprovalOwnerResult =
  | { ok: true }
  | { ok: false; error: string };

const nudgeApprovalOwnerSchema = z.object({
  requestId: z.string().uuid("Invalid approval request."),
});

// F090 item 3: replaces approval-card.tsx's `mailto:` link (F085's own
// stopgap -- lib/notifications/** was locked by a concurrent agent at the
// time, see that feature's header comment) with a real in-app
// notification to the named decision owner, now that F084 has landed
// `lib/notifications/portal-recipients.ts` and the `create_notification`
// plumbing this action needs.
//
// Deliberately narrower than `getPortalEventRecipients` (F084's helper
// notifies EVERY decision owner plus the task's assignee for a decision
// event): this is a client explicitly naming ONE person to look at ONE
// still-open approval, not a fan-out. The owner is looked up server-side
// from `project_decision_owners` for this exact request's own
// `decision_type` -- never trusted from the client, even though
// approval-card.tsx already has an `ownerId`/`ownerName` prop pair, the
// same "the RPC/action re-derives the truth, the prop is presentation
// only" convention AS-022's own doc comment on that prop establishes.
export async function nudgeApprovalOwner(
  requestId: string,
): Promise<NudgeApprovalOwnerResult> {
  const preview = await assertNotPreview();
  if (!preview.ok) return preview;

  const parsed = nudgeApprovalOwnerSchema.safeParse({ requestId });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  const { supabase, user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  // RLS-respecting select: `approval_requests_select_client`
  // (20260916010000) already scopes this to a request on a project the
  // caller's workspace membership can see, so a client can never probe
  // for another project's approval id via this action.
  const { data: request, error: requestError } = await supabase
    .from("approval_requests")
    .select("id, project_id, decision_type, title, state")
    .eq("id", parsed.data.requestId)
    .maybeSingle();

  if (requestError || !request) {
    return { ok: false, error: "Approval request not found." };
  }

  const { data: project } = await supabase
    .from("projects")
    .select("workspace_id")
    .eq("id", request.project_id)
    .maybeSingle();

  if (!project?.workspace_id) {
    return { ok: false, error: "Approval request not found." };
  }

  const caller = await requireClientCaller(project.workspace_id);
  if (!caller.ok) return caller;

  // Same RLS policy family (`project_decision_owners_select_client`) --
  // whoever currently owns THIS request's decision type, re-derived here
  // rather than trusted from the client's `ownerId` prop.
  const { data: owner } = await supabase
    .from("project_decision_owners")
    .select("user_id")
    .eq("project_id", request.project_id)
    .eq("decision_type", request.decision_type)
    .maybeSingle();

  if (!owner?.user_id) {
    return { ok: false, error: "No one is assigned to decide this yet." };
  }

  if (owner.user_id === caller.userId) {
    // Defensive -- approval-card.tsx never renders this action for the
    // owner themselves (it is only shown in the `!isOwner` branch), but
    // the RPC-equivalent re-check convention this file uses everywhere
    // else (see decideApproval's own comment) applies here too.
    return { ok: false, error: "You are the decision owner for this request." };
  }

  const notified = await createNotification(
    supabase,
    {
      userId: owner.user_id,
      workspaceId: project.workspace_id,
      kind: "approval_owner_nudge",
      payload: { approvalRequestId: request.id, title: request.title },
    },
    "nudgeApprovalOwner",
  );

  if (!notified.ok) {
    return { ok: false, error: "Something went wrong. Please try again in a moment." };
  }

  return { ok: true };
}
