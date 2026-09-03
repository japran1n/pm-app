"use server";

// F013 (missions/20260903-portal): team-side CRUD + review actions for
// `client_deliverables` (AS-028, AS-032). Mirrors lib/actions/phases.ts's
// shape exactly — same withAuthz pipeline, same default `canWrite` gate
// (a viewer/client is rejected the same way a phase mutation rejects
// them; see that file's own header comment for why `canWrite` — not a
// narrower predicate — is the correct fit here too), same `ctx.admin`
// write path with RLS as the backstop
// (`client_deliverables_insert_team` / `_update_team` / `_delete_team`,
// 20260926010000, all gated on `is_project_workspace_writer`, which
// itself excludes viewer and client).
//
// The review decision (accept/return) does NOT go through this file's
// own update path — it calls `accept_deliverable_atomic`
// (20260927010000_f013_deliverables_review_and_blocking_sweep.sql)
// via `ctx.supabase` (the session-bound, RLS-respecting client), the
// same "atomic RPC re-checks its own authorization independent of this
// action's gate" pattern lib/actions/tasks.ts's approval actions already
// use for decide_approval_atomic — the RPC is SECURITY DEFINER and
// bypasses RLS as its owner, so the actual enforcement point lives
// inside its own body (see that migration's comment), not here; this
// action's own withAuthz gate is defense in depth on top of it, not the
// only check.

import { revalidatePath } from "next/cache";

import { logger } from "@/lib/observability/logger";
import { withAuthz } from "@/lib/actions/authz";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/activity/audit";
import {
  createDeliverableSchema,
  updateDeliverableSchema,
  reorderDeliverableSchema,
  deleteDeliverableSchema,
  decideDeliverableSchema,
} from "@/lib/validation/deliverables";
import type { ProjectVisibility } from "@/lib/actions/project-visibility";
import type { ClientDeliverable, DeliverableKind, DeliverableState } from "@/lib/queries/deliverables";

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";

type AdminClient = ReturnType<typeof createAdminClient>;

export type DeliverableActionResult =
  | { ok: true; data: ClientDeliverable }
  | { ok: false; error: string };

function toDeliverableActionData(row: {
  id: string;
  project_id: string;
  phase_id: string | null;
  task_id: string | null;
  title: string;
  description: string | null;
  kind: string;
  owner_name: string;
  due_at: string | null;
  blocking: boolean;
  state: string;
  delivered_at: string | null;
  accepted_at: string | null;
  accepted_by: string | null;
  review_note: string | null;
  position: number;
}): ClientDeliverable {
  return {
    id: row.id,
    projectId: row.project_id,
    phaseId: row.phase_id,
    taskId: row.task_id,
    title: row.title,
    description: row.description,
    kind: row.kind as DeliverableKind,
    ownerName: row.owner_name,
    dueAt: row.due_at,
    blocking: row.blocking,
    state: row.state as DeliverableState,
    deliveredAt: row.delivered_at,
    acceptedAt: row.accepted_at,
    acceptedBy: row.accepted_by,
    reviewNote: row.review_note,
    position: row.position,
  };
}

const DELIVERABLE_COLUMNS =
  "id, project_id, phase_id, task_id, title, description, kind, owner_name, due_at, blocking, state, delivered_at, accepted_at, accepted_by, review_note, position";

// F016c (M3-scrutiny.md B1): the database now refuses a cross-project
// task_id/phase_id via a composite FK (20260930020000), but that check
// fires as a raw constraint violation on the service-role insert/update
// below — not a place a caller can be told anything useful. This
// re-checks the same invariant first, so a stray cross-project id from a
// directly-called Server Action (the picker only OFFERS same-project
// options; it does not enforce anything) is caught here, where it can be
// explained, rather than surfacing as a generic DB error.
async function validateSameProjectLinks(
  admin: AdminClient,
  projectId: string,
  taskId: string | null | undefined,
  phaseId: string | null | undefined,
): Promise<string | null> {
  if (taskId) {
    const { data: task } = await admin
      .from("tasks")
      .select("id")
      .eq("id", taskId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (!task) {
      return "That task doesn't belong to this project.";
    }
  }

  if (phaseId) {
    const { data: phase } = await admin
      .from("project_phases")
      .select("id")
      .eq("id", phaseId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (!phase) {
      return "That phase doesn't belong to this project.";
    }
  }

  return null;
}

async function revalidateDeliverableSettings(workspaceSlug: string, projectId: string) {
  try {
    revalidatePath(`/w/${workspaceSlug}/projects/${projectId}/settings/deliverables`, "page");
  } catch (revalidateError) {
    logger.error("deliverables: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }
}

type ProjectExtra = {
  projectId: string;
  workspaceSlug: string;
};

async function loadProjectExtra(
  admin: AdminClient,
  projectId: string,
): Promise<
  | {
      ok: true;
      workspaceId: string;
      projectId: string;
      visibility: ProjectVisibility;
      extra: ProjectExtra;
    }
  | { ok: false; error: string }
> {
  const { data, error } = await admin
    .from("projects")
    .select("id, workspace_id, visibility, deleted_at, workspaces(slug)")
    .eq("id", projectId)
    .maybeSingle();

  if (error || !data || data.deleted_at) {
    return { ok: false, error: "Project not found." };
  }

  const workspace = data.workspaces as { slug: string } | { slug: string }[] | null;
  const workspaceSlug = Array.isArray(workspace) ? workspace[0]?.slug : workspace?.slug;

  if (!workspaceSlug) {
    return { ok: false, error: "Project not found." };
  }

  return {
    ok: true,
    workspaceId: data.workspace_id,
    projectId: data.id,
    visibility: data.visibility === "private" ? "private" : "workspace",
    extra: { projectId: data.id, workspaceSlug },
  };
}

type DeliverableExtra = ProjectExtra & {
  deliverableTitle: string;
};

async function loadDeliverableExtra(
  admin: AdminClient,
  deliverableId: string,
): Promise<
  | {
      ok: true;
      workspaceId: string;
      projectId: string;
      visibility: ProjectVisibility;
      extra: DeliverableExtra;
    }
  | { ok: false; error: string }
> {
  const { data, error } = await admin
    .from("client_deliverables")
    .select(
      "id, project_id, title, projects!inner(id, workspace_id, visibility, deleted_at, workspaces(slug))",
    )
    .eq("id", deliverableId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: "Deliverable not found." };
  }

  const project = Array.isArray(data.projects) ? data.projects[0] : data.projects;
  if (!project?.workspace_id || project.deleted_at) {
    return { ok: false, error: "Deliverable not found." };
  }

  const workspace = project.workspaces as { slug: string } | { slug: string }[] | null;
  const workspaceSlug = Array.isArray(workspace) ? workspace[0]?.slug : workspace?.slug;
  if (!workspaceSlug) {
    return { ok: false, error: "Deliverable not found." };
  }

  return {
    ok: true,
    workspaceId: project.workspace_id,
    projectId: project.id,
    visibility: project.visibility === "private" ? "private" : "workspace",
    extra: { projectId: project.id, workspaceSlug, deliverableTitle: data.title },
  };
}

// ---------------------------------------------------------------------
// createDeliverable
// ---------------------------------------------------------------------

const createDeliverableImpl = withAuthz(
  createDeliverableSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to manage this project's deliverables.",
    writeError: "Viewers don't have permission to manage deliverables.",
    requireVisibility: true,
    visibilityError: "You don't have permission to manage this project's deliverables.",
    resolveWorkspace: (input, admin) => loadProjectExtra(admin, input.projectId),
  },
  async (input, ctx): Promise<DeliverableActionResult> => {
    const scopeError = await validateSameProjectLinks(
      ctx.admin,
      ctx.projectId,
      input.taskId,
      input.phaseId,
    );
    if (scopeError) {
      return { ok: false, error: scopeError };
    }

    const deliverables = ctx.admin.from("client_deliverables");

    const { data: lastDeliverable } = await deliverables
      .select("position")
      .eq("project_id", ctx.projectId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();

    const newPosition = ((lastDeliverable as { position: number } | null)?.position ?? 0) + 1;

    const { data: inserted, error: insertError } = await ctx.admin
      .from("client_deliverables")
      .insert({
        project_id: ctx.projectId,
        phase_id: input.phaseId ?? null,
        task_id: input.taskId ?? null,
        title: input.title,
        description: input.description ?? null,
        kind: input.kind,
        owner_name: input.ownerName,
        due_at: input.dueAt ?? null,
        blocking: input.blocking ?? false,
        position: newPosition,
      })
      .select(DELIVERABLE_COLUMNS)
      .single();

    if (insertError || !inserted) {
      logger.error("createDeliverable: insert failed", { error: insertError });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "client_deliverable.created",
      targetType: "client_deliverable",
      targetId: inserted.id,
      metadata: { projectId: ctx.projectId, title: inserted.title },
    });

    await revalidateDeliverableSettings(ctx.workspaceSlug, ctx.projectId);

    return { ok: true, data: toDeliverableActionData(inserted) };
  },
);

export async function createDeliverable(input: {
  projectId: string;
  title: string;
  description?: string | null;
  kind: DeliverableKind;
  ownerName: string;
  dueAt?: string | null;
  blocking?: boolean;
  taskId?: string | null;
  phaseId?: string | null;
}): Promise<DeliverableActionResult> {
  return createDeliverableImpl(input);
}

// ---------------------------------------------------------------------
// updateDeliverable
// ---------------------------------------------------------------------

const updateDeliverableImpl = withAuthz(
  updateDeliverableSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to manage this project's deliverables.",
    writeError: "Viewers don't have permission to manage deliverables.",
    requireVisibility: true,
    visibilityError: "You don't have permission to manage this project's deliverables.",
    resolveWorkspace: (input, admin) => loadDeliverableExtra(admin, input.deliverableId),
  },
  async (input, ctx): Promise<DeliverableActionResult> => {
    const scopeError = await validateSameProjectLinks(
      ctx.admin,
      ctx.projectId,
      input.taskId,
      input.phaseId,
    );
    if (scopeError) {
      return { ok: false, error: scopeError };
    }

    const { data: updated, error: updateError } = await ctx.admin
      .from("client_deliverables")
      .update({
        title: input.title,
        description: input.description,
        kind: input.kind,
        owner_name: input.ownerName,
        due_at: input.dueAt,
        blocking: input.blocking,
        task_id: input.taskId,
        phase_id: input.phaseId,
      })
      .eq("id", input.deliverableId)
      .select(DELIVERABLE_COLUMNS)
      .single();

    if (updateError || !updated) {
      logger.error("updateDeliverable: update failed", { error: updateError });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "client_deliverable.updated",
      targetType: "client_deliverable",
      targetId: updated.id,
      metadata: {
        projectId: ctx.projectId,
        previousTitle: ctx.deliverableTitle,
        title: updated.title,
      },
    });

    await revalidateDeliverableSettings(ctx.workspaceSlug, ctx.projectId);

    return { ok: true, data: toDeliverableActionData(updated) };
  },
);

export async function updateDeliverable(input: {
  deliverableId: string;
  title: string;
  description: string | null;
  kind: DeliverableKind;
  ownerName: string;
  dueAt: string | null;
  blocking: boolean;
  taskId: string | null;
  phaseId: string | null;
}): Promise<DeliverableActionResult> {
  return updateDeliverableImpl(input);
}

// ---------------------------------------------------------------------
// deleteDeliverable
// ---------------------------------------------------------------------

export type DeleteDeliverableResult =
  | { ok: true; data: { id: string } }
  | { ok: false; error: string };

const deleteDeliverableImpl = withAuthz(
  deleteDeliverableSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to manage this project's deliverables.",
    writeError: "Viewers don't have permission to manage deliverables.",
    requireVisibility: true,
    visibilityError: "You don't have permission to manage this project's deliverables.",
    resolveWorkspace: (input, admin) => loadDeliverableExtra(admin, input.deliverableId),
  },
  async (input, ctx): Promise<DeleteDeliverableResult> => {
    const { error: deleteError } = await ctx.admin
      .from("client_deliverables")
      .delete()
      .eq("id", input.deliverableId);

    if (deleteError) {
      logger.error("deleteDeliverable: delete failed", { error: deleteError });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "client_deliverable.deleted",
      targetType: "client_deliverable",
      targetId: input.deliverableId,
      metadata: { projectId: ctx.projectId, title: ctx.deliverableTitle },
    });

    await revalidateDeliverableSettings(ctx.workspaceSlug, ctx.projectId);

    return { ok: true, data: { id: input.deliverableId } };
  },
);

export async function deleteDeliverable(deliverableId: string): Promise<DeleteDeliverableResult> {
  return deleteDeliverableImpl({ deliverableId });
}

// ---------------------------------------------------------------------
// reorderDeliverables
// ---------------------------------------------------------------------

export type ReorderDeliverableResult =
  | {
      ok: true;
      data: {
        moved: { id: string; position: number };
        swappedWith: { id: string; position: number } | null;
      };
    }
  | { ok: false; error: string };

const reorderDeliverableImpl = withAuthz(
  reorderDeliverableSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to manage this project's deliverables.",
    writeError: "Viewers don't have permission to manage deliverables.",
    requireVisibility: true,
    visibilityError: "You don't have permission to manage this project's deliverables.",
    resolveWorkspace: (input, admin) => loadDeliverableExtra(admin, input.deliverableId),
  },
  async (input, ctx): Promise<ReorderDeliverableResult> => {
    const { data, error: siblingsError } = await ctx.admin
      .from("client_deliverables")
      .select("id, position")
      .eq("project_id", ctx.projectId)
      .order("position", { ascending: true });

    const siblings = data as { id: string; position: number }[] | null;

    if (siblingsError || !siblings) {
      logger.error("reorderDeliverables: failed to load siblings", { error: siblingsError });
      return { ok: false, error: GENERIC_ERROR };
    }

    const index = siblings.findIndex((deliverable) => deliverable.id === input.deliverableId);
    if (index === -1) {
      return { ok: false, error: "Deliverable not found." };
    }

    const neighborIndex = input.direction === "up" ? index - 1 : index + 1;
    if (neighborIndex < 0 || neighborIndex >= siblings.length) {
      return {
        ok: true,
        data: { moved: siblings[index], swappedWith: null },
      };
    }

    const moved = siblings[index];
    const neighbor = siblings[neighborIndex];

    const [{ error: movedError }, { error: neighborError }] = await Promise.all([
      ctx.admin
        .from("client_deliverables")
        .update({ position: neighbor.position })
        .eq("id", moved.id),
      ctx.admin
        .from("client_deliverables")
        .update({ position: moved.position })
        .eq("id", neighbor.id),
    ]);

    if (movedError || neighborError) {
      logger.error("reorderDeliverables: swap failed", {
        error: movedError ?? neighborError,
      });
      return { ok: false, error: GENERIC_ERROR };
    }

    await revalidateDeliverableSettings(ctx.workspaceSlug, ctx.projectId);

    return {
      ok: true,
      data: {
        moved: { id: moved.id, position: neighbor.position },
        swappedWith: { id: neighbor.id, position: moved.position },
      },
    };
  },
);

export async function reorderDeliverables(
  deliverableId: string,
  direction: "up" | "down",
): Promise<ReorderDeliverableResult> {
  return reorderDeliverableImpl({ deliverableId, direction });
}

// ---------------------------------------------------------------------
// decideDeliverable — AS-032: accept or return, via
// accept_deliverable_atomic.
// ---------------------------------------------------------------------

export type DecideDeliverableResult =
  | { ok: true; data: { id: string; state: DeliverableState } }
  | { ok: false; error: string };

const decideDeliverableImpl = withAuthz(
  decideDeliverableSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to review this project's deliverables.",
    writeError: "Viewers don't have permission to review deliverables.",
    requireVisibility: true,
    visibilityError: "You don't have permission to review this project's deliverables.",
    resolveWorkspace: (input, admin) => loadDeliverableExtra(admin, input.deliverableId),
  },
  async (input, ctx): Promise<DecideDeliverableResult> => {
    // The session-bound client, not ctx.admin: accept_deliverable_atomic
    // is SECURITY DEFINER and does its own authorization + note-required
    // check internally via auth.uid() — see that migration's own header
    // comment. This action's withAuthz gate above is defense in depth on
    // top of it, matching lib/actions/phases.ts's seedDefaultPhases
    // client-choice rule (RPCs that re-check auth.uid() internally must
    // go through the session-bound client, never the admin client, or
    // that internal check silently sees no caller at all).
    const { data, error } = await ctx.supabase.rpc("accept_deliverable_atomic", {
      p_deliverable_id: input.deliverableId,
      p_decision: input.decision,
      p_note: input.note ?? null,
    });

    if (error || !data) {
      logger.error("decideDeliverable: rpc failed", { error });
      return {
        ok: false,
        error:
          input.decision === "returned" && !input.note?.trim()
            ? "A note is required when returning a deliverable."
            : GENERIC_ERROR,
      };
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      logger.error("decideDeliverable: rpc returned no row");
      return { ok: false, error: GENERIC_ERROR };
    }

    await revalidateDeliverableSettings(ctx.workspaceSlug, ctx.projectId);

    return {
      ok: true,
      data: { id: input.deliverableId, state: row.state as DeliverableState },
    };
  },
);

export async function decideDeliverable(input: {
  deliverableId: string;
  decision: "accepted" | "returned";
  note?: string | null;
}): Promise<DecideDeliverableResult> {
  return decideDeliverableImpl(input);
}
