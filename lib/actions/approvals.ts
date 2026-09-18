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
import { type ActionOutcome, type ActionResult, withAuthz, type AuthzExtra } from "@/lib/actions/authz";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ProjectVisibility } from "@/lib/actions/project-visibility";
import { writeAudit } from "@/lib/activity/audit";
import {
  requestApprovalSchema,
  withdrawApprovalSchema,
  setDecisionOwnerSchema,
  projectIdSchema,
  addProjectDecisionTypeSchema,
  removeProjectDecisionTypeSchema,
} from "@/lib/validation/approvals";
import {
  isTaskClientVisible,
  getDecisionOwners,
  getProjectClientMembers,
  getProjectDecisionTypes,
  type PortalDecisionOwner,
  type ApprovalDecisionType,
  type ProjectDecisionType,
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
  portalEnabled: boolean;
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
    .select("id, workspace_id, visibility, deleted_at, portal_enabled")
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
    extra: {
      projectId: data.id,
      workspaceId: data.workspace_id,
      portalEnabled: data.portal_enabled === true,
    },
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

export type RequestApprovalResult = ActionResult<RequestApprovalActionData>;

// Uploads a doc's current markdown body as the approval's immutable
// snapshot. Deliberately namespaced under `approval-requests/{request_id}/`
// rather than the bucket's usual `{task_id}/…` convention — a doc has no
// task id, and this namespace can never collide with a real task's UUID
// (not a valid uuid string), so it cannot be reached by either of the
// existing storage.objects policies (which key off the first path
// segment) — no storage.objects SELECT policy grants a client or a team
// member's own session read access to this path. F009c
// (getApprovalDocSnapshotUrl, below) closes that gap: it re-checks
// `approval_requests_select_client`/`_team` via the ordinary
// RLS-respecting client, then mints a short-lived signed URL through the
// admin client — never a direct client-session Storage read.
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
    // F009b (M2 remediation, F-2): a portal-disabled project's client can
    // never reach the Approvals view (`approval_requests_select_client`
    // requires `is_project_portal_enabled`, 20260916010000) or the
    // portal at all, so raising an approval here would be exactly the
    // "sent into a void" outcome this action already refuses for a
    // missing decision owner, immediately below. Same generic-ish,
    // specific error style as that check.
    if (!ctx.portalEnabled) {
      return {
        ok: false,
        error: "This project's client portal isn't turned on yet. Enable it in project settings before requesting a client approval.",
      };
    }

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
  decisionType: ApprovalDecisionType;
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

export type WithdrawApprovalResult = ActionResult<{ id: string }>;

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

export type GetDecisionOwnersResult = ActionResult<{ owners: PortalDecisionOwner[]; decisionTypes: ProjectDecisionType[] }>;

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
    const [ownersResult, decisionTypesResult] = await Promise.all([
      getDecisionOwners(ctx.projectId!),
      getProjectDecisionTypes(ctx.projectId!),
    ]);
    if (!ownersResult.ok) return { ok: false, error: ownersResult.error };
    if (!decisionTypesResult.ok) return { ok: false, error: decisionTypesResult.error };
    return { ok: true, data: { owners: ownersResult.data, decisionTypes: decisionTypesResult.data } };
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

export type SetDecisionOwnerResult = ActionResult<{ decisionType: ApprovalDecisionType; userId: string | null }>;

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
    // Deliberately NOT re-validated against `project_decision_types` here:
    // `project_decision_owners.decision_type` has no hard FK to that table
    // (see this feature's migration header comment for why), and
    // `requestApproval`'s own decision-owner lookup is the actual gate
    // that keeps an approval from being raised against a bogus decision
    // type in practice — a decision type with no `project_decision_owners`
    // row (bogus or removed) already can never be chosen there.
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

// ---------------------------------------------------------------------
// getApprovalDocSnapshotUrl
// ---------------------------------------------------------------------
// F009c (M2 remediation): joins uploadDocSnapshot's write (above) to an
// actual reader. Same convention as lib/actions/attachments.ts's
// getAttachmentSignedUrl / components/portal/file-list.tsx's click-to-
// open: the bucket is private, so no URL is ever persisted client-side —
// a click requests a fresh 1-hour signed URL and opens it.
//
// Authorization is the ordinary RLS-respecting server client selecting
// the `approval_requests` row itself: `approval_requests_select_client`
// / `approval_requests_select_team` (20260916010000_approval_requests.sql)
// are the actual boundary for "can this caller see this approval at
// all" — identical to every other read in lib/queries/approvals.ts. Only
// once that read succeeds does this action reach for the admin client,
// and only to mint the signed URL (the doc-snapshot object itself has no
// storage.objects SELECT policy for any role, per uploadDocSnapshot's own
// comment) — never to re-decide visibility.
const SNAPSHOT_SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour, matches attachments.ts

export type GetApprovalDocSnapshotUrlResult = ActionOutcome<{ signedUrl: string }>;

export async function getApprovalDocSnapshotUrl(
  approvalId: string,
): Promise<GetApprovalDocSnapshotUrlResult> {
  const { supabase, user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  const { data: approvalRow, error: approvalError } = await supabase
    .from("approval_requests")
    .select("id, subject_type, artifact_snapshot_path")
    .eq("id", approvalId)
    .maybeSingle();

  if (approvalError || !approvalRow) {
    return { ok: false, error: "Approval request not found." };
  }
  if (approvalRow.subject_type !== "doc" || !approvalRow.artifact_snapshot_path) {
    return { ok: false, error: "This approval has no document to open." };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();
  const { data: signedUrlData, error: signedUrlError } = await admin.storage
    .from(SNAPSHOT_BUCKET)
    .createSignedUrl(approvalRow.artifact_snapshot_path, SNAPSHOT_SIGNED_URL_TTL_SECONDS);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    logger.error("getApprovalDocSnapshotUrl: signed URL generation failed", { error: signedUrlError });
    return { ok: false, error: GENERIC_ERROR };
  }

  return { ok: true, signedUrl: signedUrlData.signedUrl };
}

export async function setDecisionOwner(
  projectId: string,
  decisionType: ApprovalDecisionType,
  userId: string | null,
): Promise<SetDecisionOwnerResult> {
  return setDecisionOwnerImpl({ projectId, decisionType, userId });
}

// ---------------------------------------------------------------------
// addProjectDecisionType / removeProjectDecisionType — F008 follow-up:
// customizable decision types (`project_decision_types`). Single-table
// writes, same "no RPC needed" reasoning requestApproval's own header
// comment gives for its own single-table insert.
// ---------------------------------------------------------------------

export type AddProjectDecisionTypeResult = ActionResult<ProjectDecisionType>;

const addProjectDecisionTypeImpl = withAuthz(
  addProjectDecisionTypeSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to manage this project's decision types.",
    writeError: "Viewers don't have permission to manage decision types.",
    requireVisibility: true,
    visibilityError: "You don't have permission to manage this project's decision types.",
    resolveWorkspace: (input, admin) => loadProjectExtra(admin, input.projectId),
  },
  async (input, ctx): Promise<AddProjectDecisionTypeResult> => {
    const { data: maxRow } = await ctx.admin
      .from("project_decision_types")
      .select("sort_order")
      .eq("project_id", ctx.projectId!)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextSortOrder = (maxRow?.sort_order ?? 0) + 1;

    const { data: inserted, error: insertError } = await ctx.admin
      .from("project_decision_types")
      .insert({
        project_id: ctx.projectId!,
        name: input.name,
        description: input.description || null,
        sort_order: nextSortOrder,
      })
      .select("id, name, description, sort_order")
      .single();

    if (insertError || !inserted) {
      // Unique violation (project_decision_types_project_name_unique).
      if (insertError?.code === "23505") {
        return { ok: false, error: "This project already has a decision type with that name." };
      }
      logger.error("addProjectDecisionType: insert failed", { error: insertError });
      return { ok: false, error: GENERIC_ERROR };
    }

    await revalidateApprovalSurfaces(ctx.projectId!);
    return {
      ok: true,
      data: {
        id: inserted.id,
        name: inserted.name,
        description: inserted.description,
        sortOrder: inserted.sort_order,
      },
    };
  },
);

export async function addProjectDecisionType(
  projectId: string,
  name: string,
  description?: string | null,
): Promise<AddProjectDecisionTypeResult> {
  return addProjectDecisionTypeImpl({ projectId, name, description });
}

export type RemoveProjectDecisionTypeResult = ActionResult<{ id: string }>;

const removeProjectDecisionTypeImpl = withAuthz(
  removeProjectDecisionTypeSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to manage this project's decision types.",
    writeError: "Viewers don't have permission to manage decision types.",
    requireVisibility: true,
    visibilityError: "You don't have permission to manage this project's decision types.",
    resolveWorkspace: (input, admin) => loadProjectExtra(admin, input.projectId),
  },
  async (input, ctx): Promise<RemoveProjectDecisionTypeResult> => {
    const { data: typeRow, error: typeError } = await ctx.admin
      .from("project_decision_types")
      .select("id, name")
      .eq("id", input.decisionTypeId)
      .eq("project_id", ctx.projectId!)
      .maybeSingle();
    if (typeError || !typeRow) {
      return { ok: false, error: "Decision type not found." };
    }

    // Refuse to remove a decision type that is still in use — existing
    // approval_requests/project_decision_owners rows referencing it must
    // not become orphaned/unreadable-by-name. Checked here (not a hard
    // FK, see this feature's migration header comment) so the error names
    // the reason rather than surfacing a raw constraint failure.
    const { count: ownerCount, error: ownerCountError } = await ctx.admin
      .from("project_decision_owners")
      .select("id", { count: "exact", head: true })
      .eq("project_id", ctx.projectId!)
      .eq("decision_type", typeRow.name);
    if (ownerCountError) {
      logger.error("removeProjectDecisionType: owner count failed", { error: ownerCountError });
      return { ok: false, error: GENERIC_ERROR };
    }
    if ((ownerCount ?? 0) > 0) {
      return {
        ok: false,
        error: "Remove this decision type's owner first, then try again.",
      };
    }

    const { count: requestCount, error: requestCountError } = await ctx.admin
      .from("approval_requests")
      .select("id", { count: "exact", head: true })
      .eq("project_id", ctx.projectId!)
      .eq("decision_type", typeRow.name);
    if (requestCountError) {
      logger.error("removeProjectDecisionType: request count failed", { error: requestCountError });
      return { ok: false, error: GENERIC_ERROR };
    }
    if ((requestCount ?? 0) > 0) {
      return {
        ok: false,
        error: "This decision type has approval requests on it and can't be removed.",
      };
    }

    const { error: deleteError } = await ctx.admin
      .from("project_decision_types")
      .delete()
      .eq("id", input.decisionTypeId)
      .eq("project_id", ctx.projectId!);

    if (deleteError) {
      logger.error("removeProjectDecisionType: delete failed", { error: deleteError });
      return { ok: false, error: GENERIC_ERROR };
    }

    await revalidateApprovalSurfaces(ctx.projectId!);
    return { ok: true, data: { id: input.decisionTypeId } };
  },
);

export async function removeProjectDecisionType(
  projectId: string,
  decisionTypeId: string,
): Promise<RemoveProjectDecisionTypeResult> {
  return removeProjectDecisionTypeImpl({ projectId, decisionTypeId });
}
