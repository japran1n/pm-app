"use server";

// F008 (missions/20260903-portal, M2 — Approvals): "Request client
// approval" from a task, a document, or standalone with an external
// artifact URL (AS-019). Rejects a non-client-visible task subject at
// creation time with an explicit error (AS-020) — not only in the dialog.
//
// Authorization goes through `withAuthz` (lib/actions/authz.ts, W11),
// default `canWrite` gate, matching lib/actions/phases.ts's own precedent
// exactly (`lib/actions/phases.ts:182-241`, createPhaseImpl): membership +
// canWrite + project visibility resolved once, writes via `ctx.admin`,
// `writeAudit(ctx.supabase, ...)` called as a SEPARATE step after the
// insert succeeds (not wrapped in one RPC with it) — this feature's own
// write is a single-table insert (plus, for a doc subject only, one
// Storage write), not the "multiple tables whose invariants must hold
// together" shape design constraint #6 reserves for an RPC (that shape is
// `decide_approval_atomic`, F007's own RPC, which this feature never
// calls).
//
// AS-020 is enforced HERE, re-using `isTaskClientVisible()`
// (lib/queries/approvals.ts, built by F007 specifically for this call
// site — see that feature's handoff "Out-of-scope work needed") as the
// single source of truth for the check, not a re-derived boolean. The
// database's own `approval_requests_insert_team` policy
// (supabase/migrations/20260916010000_approval_requests.sql) enforces the
// identical rule a second time as a backstop for a raw PostgREST insert —
// this action's check exists to produce a good, specific error message
// before that round trip, exactly as F007's handoff anticipated.
//
// Decision-owner check: the spec's dialog is required to block submission
// when the chosen decision type has no `project_decision_owners` row for
// this project ("an approval sent into a void is the failure this
// prevents"). That check is re-run here too, not left to the dialog alone
// — same "a gate applied in one query and forgotten in the next" concern
// this mission's own migrations repeatedly flag (see F007's migration
// header comment) applied to a raw call bypassing the dialog.
//
// Snapshot (spec section 3): approval_requests.title/description have no
// live FK/trigger binding back to the subject task or doc, so writing the
// dialog's (subject-prefilled, team-editable) title/message into those
// columns AT INSERT TIME is already an immutable snapshot by construction
// — nothing ever re-syncs them from the live task/doc afterwards. A doc's
// full body cannot fit that same shape (it can be arbitrarily large, and a
// client should see the document as it was, not a truncated echo in a
// text column), so only the doc case gets an out-of-band Storage
// snapshot, written via the admin/service-role client to the existing
// `task-attachments` bucket (see uploadDocSnapshot's own comment below for
// why the path convention and RLS story diverge from that bucket's
// original task-scoped shape). An artifact subject stores only the URL
// the team typed and `requested_at` (already a column) — never fetched
// server-side (SSRF footgun, and it would not work against Figma anyway).

import { revalidatePath } from "next/cache";

import { logger } from "@/lib/observability/logger";
import { withAuthz, type AuthzExtra } from "@/lib/actions/authz";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ProjectVisibility } from "@/lib/actions/project-visibility";
import { writeAudit } from "@/lib/activity/audit";
import {
  requestApprovalSchema,
  withdrawApprovalSchema,
  setDecisionOwnerSchema,
  projectIdSchema,
} from "@/lib/validation/approvals";
import {
  isTaskClientVisible,
  getDecisionOwners,
  getProjectClientMembers,
  type PortalDecisionOwner,
  type ApprovalDecisionType,
} from "@/lib/queries/approvals";

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";

// The existing private Storage bucket F064 created
// (supabase/migrations/20260818050100_create_attachments.sql) — reused per
// this feature's own instruction ("Reuse the existing attachments storage
// bucket and its policies"). Its RLS policies are keyed to a `{task_id}/…`
// path joined against the `attachments` table, which does not describe a
// doc-body snapshot at all; only the BUCKET (and the "writes go through
// the privileged admin client, which bypasses Storage RLS the same way it
// bypasses table RLS everywhere else in this codebase" convention) is
// actually reused here — see uploadDocSnapshot's own comment and this
// feature's handoff for the read-back gap this leaves for F009.
const SNAPSHOT_BUCKET = "task-attachments";

type AdminClient = ReturnType<typeof createAdminClient>;

type ProjectExtra = {
  projectId: string;
  workspaceId: string;
};

async function loadProjectExtra(
  admin: AdminClient,
  projectId: string,
): Promise<
  | { ok: true; workspaceId: string; projectId: string; visibility: ProjectVisibility; extra: ProjectExtra }
  | { ok: false; error: string }
> {
  const { data, error } = await admin
    .from("projects")
    .select("id, workspace_id, visibility, deleted_at")
    .eq("id", projectId)
    .maybeSingle();

  if (error || !data || data.deleted_at) {
    return { ok: false, error: "Project not found." };
  }

  return {
    ok: true,
    workspaceId: data.workspace_id,
    projectId: data.id,
    visibility: data.visibility === "private" ? "private" : "workspace",
    extra: { projectId: data.id, workspaceId: data.workspace_id },
  };
}

async function revalidateApprovalSurfaces(projectId: string) {
  try {
    revalidatePath("/w", "layout");
    revalidatePath("/portal", "layout");
    void projectId;
  } catch (revalidateError) {
    // Non-fatal, same convention as lib/actions/phases.ts's
    // revalidatePhaseSettings.
    logger.error("approvals: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }
}

// ---------------------------------------------------------------------
// requestApproval
// ---------------------------------------------------------------------

export type RequestApprovalActionData = {
  id: string;
  subjectType: "task" | "doc" | "artifact";
  /** F011 (spec section 2, "Rounds"): the round this newly-created
   * request landed at. 1 for a subject's first approval; the caller
   * (RequestApprovalDialog) uses `round >= 3` to *suggest* — never
   * decide — that this may be a change request rather than more
   * feedback. */
  round: number;
};

export type RequestApprovalResult =
  | { ok: true; data: RequestApprovalActionData }
  | { ok: false; error: string };

// Uploads a doc's current markdown body as the approval's immutable
// snapshot. Deliberately namespaced under `approval-requests/{request_id}/`
// rather than the bucket's usual `{task_id}/…` convention — a doc has no
// task id, and this namespace can never collide with a real task's UUID
// (not a valid uuid string), so it cannot be reached by either of the
// existing storage.objects policies (which key off the first path
// segment). That is also this call's limitation, spelled out for the next
// worker: only the admin/service-role client (used here) can read this
// object back today — no storage.objects SELECT policy grants a client or
// a team member's own session read access to this path. F009 (Portal:
// Approvals view) needs to either add one (scoped through
// approval_requests' own existing SELECT policies, the same join shape
// task-attachments' original policy used) or read it via a server-side
// signed-URL action using the admin client, gated by the same
// authorization approval_requests_select_client/_team already encode.
async function uploadDocSnapshot(
  admin: AdminClient,
  requestId: string,
  content: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const path = `approval-requests/${requestId}/doc-snapshot.md`;
  const { error } = await admin.storage.from(SNAPSHOT_BUCKET).upload(path, content, {
    contentType: "text/markdown",
    upsert: true,
  });
  if (error) {
    logger.error("requestApproval: doc snapshot upload failed", { error });
    return { ok: false, error: GENERIC_ERROR };
  }
  return { ok: true, path };
}

const requestApprovalImpl = withAuthz(
  requestApprovalSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to request a client approval on this project.",
    writeError: "Viewers don't have permission to request a client approval.",
    requireVisibility: true,
    visibilityError: "You don't have permission to request a client approval on this project.",
    resolveWorkspace: (input, admin) => loadProjectExtra(admin, input.projectId),
  },
  async (input, ctx): Promise<RequestApprovalResult> => {
    // Decision-owner gate: "an approval sent into a void is the failure
    // this prevents" — re-checked here, not left to the dialog alone.
    const { data: ownerRow, error: ownerError } = await ctx.admin
      .from("project_decision_owners")
      .select("user_id")
      .eq("project_id", ctx.projectId)
      .eq("decision_type", input.decisionType)
      .maybeSingle();

    if (ownerError) {
      logger.error("requestApproval: decision-owner lookup failed", { error: ownerError });
      return { ok: false, error: GENERIC_ERROR };
    }
    if (!ownerRow) {
      return {
        ok: false,
        error: `No one is set up to approve ${input.decisionType} decisions on this project yet. Set an owner in project settings first.`,
      };
    }

    let subjectId: string | null = null;
    let artifactUrl: string | null = null;
    let docContentForSnapshot: string | null = null;

    if (input.subjectType === "task") {
      const { data: taskRow, error: taskError } = await ctx.admin
        .from("tasks")
        .select("id, project_id, deleted_at")
        .eq("id", input.subjectId!)
        .maybeSingle();

      if (taskError || !taskRow || taskRow.deleted_at || taskRow.project_id !== ctx.projectId) {
        return { ok: false, error: "Task not found." };
      }

      // AS-020: rejected at creation time with an explicit error naming
      // the reason — the team's task stays exactly as it was; this action
      // never silently flips it visible.
      const clientVisible = await isTaskClientVisible(input.subjectId!);
      if (!clientVisible) {
        return {
          ok: false,
          error:
            "This task isn't shared with the client yet. Turn on \"Share with client\" for this task before requesting an approval on it.",
        };
      }

      subjectId = taskRow.id;
    } else if (input.subjectType === "doc") {
      const { data: docRow, error: docError } = await ctx.admin
        .from("docs")
        .select("id, project_id, content")
        .eq("id", input.subjectId!)
        .maybeSingle();

      if (docError || !docRow || docRow.project_id !== ctx.projectId) {
        return { ok: false, error: "Document not found." };
      }

      subjectId = docRow.id;
      docContentForSnapshot = docRow.content;
    } else {
      artifactUrl = input.artifactUrl!;
    }

    // F011 (spec section 2, "Rounds"): the next approval raised for the
    // SAME subject continues the same round sequence, so the portal's
    // history reads as "round 2", "round 3", ... rather than every raise
    // silently restarting at round 1. Matched on (project, subject_type,
    // subject_id) for task/doc/phase subjects, or (project, subject_type,
    // artifact_url) for an artifact (which carries no subject_id) — the
    // same two shapes the CHECK constraint at 20260916010000 already
    // treats as this row's identity. Ordered by round desc (not
    // created_at) so a chain that itself branched (unlikely, but no
    // invariant forbids two 'pending' rows on the same subject at once)
    // still continues from the highest round seen, not an arbitrary one.
    let previousRound = 0;
    let supersedesId: string | null = null;
    {
      let previousQuery = ctx.admin
        .from("approval_requests")
        .select("id, round")
        .eq("project_id", ctx.projectId)
        .eq("subject_type", input.subjectType)
        .order("round", { ascending: false })
        .limit(1);

      previousQuery = subjectId
        ? previousQuery.eq("subject_id", subjectId)
        : previousQuery.eq("artifact_url", artifactUrl!);

      const { data: previousRow, error: previousError } = await previousQuery.maybeSingle();
      if (previousError) {
        logger.error("requestApproval: previous-round lookup failed", { error: previousError });
        return { ok: false, error: GENERIC_ERROR };
      }
      if (previousRow) {
        previousRound = previousRow.round;
        supersedesId = previousRow.id;
      }
    }

    const { data: inserted, error: insertError } = await ctx.admin
      .from("approval_requests")
      .insert({
        project_id: ctx.projectId,
        subject_type: input.subjectType,
        subject_id: subjectId,
        artifact_url: artifactUrl,
        title: input.title,
        description: input.message || null,
        decision_type: input.decisionType,
        due_at: input.dueAt || null,
        requested_by: ctx.user.id,
        round: previousRound + 1,
        supersedes_id: supersedesId,
      })
      .select("id, round")
      .single();

    if (insertError || !inserted) {
      logger.error("requestApproval: insert failed", { error: insertError });
      return { ok: false, error: GENERIC_ERROR };
    }

    if (input.subjectType === "doc" && docContentForSnapshot !== null) {
      const snapshotResult = await uploadDocSnapshot(ctx.admin, inserted.id, docContentForSnapshot);
      if (!snapshotResult.ok) {
        // Roll back the row rather than leave an approval whose snapshot
        // never got written — the admin client can delete even though no
        // DELETE policy exists for any role (service-role bypasses RLS by
        // design, same as every other admin-client write in this
        // codebase).
        await ctx.admin.from("approval_requests").delete().eq("id", inserted.id);
        return snapshotResult;
      }

      const { error: updateError } = await ctx.admin
        .from("approval_requests")
        .update({ artifact_snapshot_path: snapshotResult.path })
        .eq("id", inserted.id);
      if (updateError) {
        logger.error("requestApproval: snapshot path update failed", { error: updateError });
        // The row and the Storage object both exist; only the pointer
        // between them failed to save. Not worth rolling back a
        // successfully-created approval over — logged for follow-up.
      }
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "approval_request.created",
      targetType: "approval_request",
      targetId: inserted.id,
      metadata: {
        projectId: ctx.projectId,
        subjectType: input.subjectType,
        decisionType: input.decisionType,
      },
    });

    await revalidateApprovalSurfaces(ctx.projectId);

    return { ok: true, data: { id: inserted.id, subjectType: input.subjectType, round: inserted.round } };
  },
);

export async function requestApproval(input: {
  projectId: string;
  subjectType: "task" | "doc" | "artifact";
  subjectId?: string | null;
  artifactUrl?: string | null;
  title: string;
  message?: string | null;
  decisionType: "content" | "brand" | "technical" | "commercial";
  dueAt?: string | null;
}): Promise<RequestApprovalResult> {
  return requestApprovalImpl(input);
}

// ---------------------------------------------------------------------
// withdrawApproval
// ---------------------------------------------------------------------
// F008's own "Files (approximate)" list names this action alongside
// requestApproval; F010 (Team UI: approvals queue) is the feature that
// wires a "withdraw" button to it (its own handoff notes this action did
// not exist yet). Only a still-pending request can be withdrawn — the
// `prevent_approval_request_settled_update` trigger
// (20260916010000_approval_requests.sql) rejects any update once
// OLD.state has left 'pending', for every caller including the
// service-role admin client this action writes through (triggers are not
// an RLS mechanism and are never bypassed by the privileged key).

type WithdrawExtra = AuthzExtra & { workspaceId: string; projectId: string };

async function loadRequestExtra(
  admin: AdminClient,
  requestId: string,
): Promise<
  | { ok: true; workspaceId: string; projectId: string; visibility: ProjectVisibility; extra: WithdrawExtra }
  | { ok: false; error: string }
> {
  const { data, error } = await admin
    .from("approval_requests")
    .select("id, project_id, state, projects!inner(id, workspace_id, visibility, deleted_at)")
    .eq("id", requestId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: "Approval request not found." };
  }

  const project = Array.isArray(data.projects) ? data.projects[0] : data.projects;
  if (!project?.workspace_id || project.deleted_at) {
    return { ok: false, error: "Approval request not found." };
  }

  return {
    ok: true,
    workspaceId: project.workspace_id,
    projectId: project.id,
    visibility: project.visibility === "private" ? "private" : "workspace",
    extra: {
      workspaceId: project.workspace_id,
      projectId: project.id,
    },
  };
}

export type WithdrawApprovalResult =
  | { ok: true; data: { id: string } }
  | { ok: false; error: string };

const withdrawApprovalImpl = withAuthz(
  withdrawApprovalSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to withdraw this approval request.",
    writeError: "Viewers don't have permission to withdraw an approval request.",
    requireVisibility: true,
    visibilityError: "You don't have permission to withdraw this approval request.",
    resolveWorkspace: (input, admin) => loadRequestExtra(admin, input.requestId),
  },
  async (input, ctx): Promise<WithdrawApprovalResult> => {
    const { data: updated, error: updateError } = await ctx.admin
      .from("approval_requests")
      .update({ state: "withdrawn" })
      .eq("id", input.requestId)
      .eq("state", "pending")
      .select("id")
      .maybeSingle();

    if (updateError) {
      logger.error("withdrawApproval: update failed", { error: updateError });
      return { ok: false, error: GENERIC_ERROR };
    }
    if (!updated) {
      return { ok: false, error: "This request has already been decided or withdrawn." };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "approval_request.withdrawn",
      targetType: "approval_request",
      targetId: input.requestId,
      metadata: { projectId: ctx.projectId },
    });

    await revalidateApprovalSurfaces(ctx.projectId);

    return { ok: true, data: { id: input.requestId } };
  },
);

export async function withdrawApproval(requestId: string): Promise<WithdrawApprovalResult> {
  return withdrawApprovalImpl({ requestId });
}

// ---------------------------------------------------------------------
// getDecisionOwnersForDialog — read path for the "who will be asked"
// section of RequestApprovalDialog (components/approvals/
// request-approval-dialog.tsx). A Server Action so the Client Component
// can fetch it on demand without every one of the dialog's many callers
// (task detail sheet, doc editor, project settings) threading a new prop
// through — same pattern as getProjectPhaseOptions
// (lib/actions/phases.ts).
// ---------------------------------------------------------------------

export type GetDecisionOwnersResult =
  | { ok: true; data: { owners: PortalDecisionOwner[] } }
  | { ok: false; error: string };

const getDecisionOwnersImpl = withAuthz(
  projectIdSchema,
  {
    // Read-only: any active member (including a viewer) may see who will
    // be asked, same "no requireWrite" convention as
    // getProjectPhaseOptionsImpl.
    requireVisibility: true,
    resolveWorkspace: (input, admin) => loadProjectExtra(admin, input.projectId),
  },
  async (_input, ctx): Promise<GetDecisionOwnersResult> => {
    const owners = await getDecisionOwners(ctx.projectId!);
    return { ok: true, data: { owners } };
  },
);

export async function getDecisionOwnersForDialog(
  projectId: string,
): Promise<GetDecisionOwnersResult> {
  return getDecisionOwnersImpl({ projectId });
}

// ---------------------------------------------------------------------
// setDecisionOwner — F008 section 4: "Who approves what" project settings
// row. Upserts (or, when userId is null, deletes) the
// project_decision_owners row for one (project, decisionType) pair.
// ---------------------------------------------------------------------

export type SetDecisionOwnerResult =
  | { ok: true; data: { decisionType: ApprovalDecisionType; userId: string | null } }
  | { ok: false; error: string };

const setDecisionOwnerImpl = withAuthz(
  setDecisionOwnerSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to manage this project's decision owners.",
    writeError: "Viewers don't have permission to manage decision owners.",
    requireVisibility: true,
    visibilityError: "You don't have permission to manage this project's decision owners.",
    resolveWorkspace: (input, admin) => loadProjectExtra(admin, input.projectId),
  },
  async (input, ctx): Promise<SetDecisionOwnerResult> => {
    if (input.userId === null) {
      const { error: deleteError } = await ctx.admin
        .from("project_decision_owners")
        .delete()
        .eq("project_id", ctx.projectId!)
        .eq("decision_type", input.decisionType);

      if (deleteError) {
        logger.error("setDecisionOwner: delete failed", { error: deleteError });
        return { ok: false, error: GENERIC_ERROR };
      }

      await revalidateApprovalSurfaces(ctx.projectId!);
      return { ok: true, data: { decisionType: input.decisionType, userId: null } };
    }

    // Confirm the chosen user is actually an active client member of this
    // project's workspace — mirrors setTaskPhase's cross-project sanity
    // check (lib/actions/phases.ts), applied here to "is this a client at
    // all" rather than "does this phase belong to this project".
    const clientMembers = await getProjectClientMembers(ctx.workspaceId);
    if (!clientMembers.some((member) => member.userId === input.userId)) {
      return { ok: false, error: "That person isn't an active client on this project's workspace." };
    }

    const { error: upsertError } = await ctx.admin
      .from("project_decision_owners")
      .upsert(
        { project_id: ctx.projectId!, decision_type: input.decisionType, user_id: input.userId },
        { onConflict: "project_id,decision_type" },
      );

    if (upsertError) {
      logger.error("setDecisionOwner: upsert failed", { error: upsertError });
      return { ok: false, error: GENERIC_ERROR };
    }

    await revalidateApprovalSurfaces(ctx.projectId!);
    return { ok: true, data: { decisionType: input.decisionType, userId: input.userId } };
  },
);

export async function setDecisionOwner(
  projectId: string,
  decisionType: "content" | "brand" | "technical" | "commercial",
  userId: string | null,
): Promise<SetDecisionOwnerResult> {
  return setDecisionOwnerImpl({ projectId, decisionType, userId });
}
