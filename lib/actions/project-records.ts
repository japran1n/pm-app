"use server";

// F015 (missions/20260903-portal): team-side CRUD for F012's
// `project_scope_items`, `project_decisions`, `project_assumptions`
// (AS-043, AS-044, AS-046), plus `createDecisionFromComment` — the "Turn
// into decision" affordance in components/task/comment-list.tsx.
//
// Same shape as lib/actions/deliverables.ts throughout: withAuthz's
// default `canWrite` gate (a viewer/client is rejected), ctx.admin for
// the actual write with RLS as the backstop (every INSERT/UPDATE/DELETE
// policy on these three tables is gated on `is_project_workspace_writer`,
// 20260926010000), writeAudit for the audit trail.
//
// No `flagAssumption` action here — the client-facing "Not correct" call
// is lib/actions/portal-project-records.ts's job (a different caller,
// a different authorization shape: RLS has no client UPDATE policy on
// `project_assumptions` at all, only `flag_assumption_atomic` itself,
// SECURITY DEFINER, bypasses RLS as its own enforcement point).

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { logger } from "@/lib/observability/logger";
import { type ActionResult, withAuthz } from "@/lib/actions/authz";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/activity/audit";
import {
  createScopeItemSchema,
  updateScopeItemSchema,
  deleteScopeItemSchema,
  createDecisionSchema,
  updateDecisionSchema,
  deleteDecisionSchema,
  createDecisionFromCommentSchema,
  createAssumptionSchema,
  updateAssumptionSchema,
  deleteAssumptionSchema,
} from "@/lib/validation/project-records";
import type { ProjectVisibility } from "@/lib/actions/project-visibility";
import type {
  ProjectScopeItem,
  ProjectDecision,
  ProjectAssumption,
  ScopeItemSource,
  DecisionType,
  AssumptionState,
} from "@/lib/queries/project-records";

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";

type AdminClient = ReturnType<typeof createAdminClient>;

type ProjectExtra = { projectId: string; workspaceSlug: string };

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

async function revalidateRecordSettings(workspaceSlug: string, projectId: string) {
  try {
    revalidatePath(`/w/${workspaceSlug}/projects/${projectId}/settings/record`, "page");
  } catch (revalidateError) {
    logger.error("project-records: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }
}

const AUTHZ_ERRORS = {
  membershipError: "You don't have permission to manage this project's record.",
  writeError: "Viewers don't have permission to manage this project's record.",
  visibilityError: "You don't have permission to manage this project's record.",
};

// ---------------------------------------------------------------------
// Scope items
// ---------------------------------------------------------------------

export type ScopeItemActionResult = ActionResult<ProjectScopeItem>;

function toScopeItem(row: {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  included: boolean;
  source: string;
  change_request_id: string | null;
  position: number;
}): ProjectScopeItem {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    included: row.included,
    source: row.source as ScopeItemSource,
    changeRequestId: row.change_request_id,
    // Team-side CRUD never needs the linked change request's title (the
    // Record panel shows the change_request_id's mere presence via
    // `source`); only the portal read (getProjectScopeItems) resolves it.
    changeRequestTitle: null,
    position: row.position,
  };
}

const SCOPE_ITEM_COLUMNS =
  "id, project_id, title, description, included, source, change_request_id, position";

const createScopeItemImpl = withAuthz(
  createScopeItemSchema,
  {
    requireWrite: true,
    requireVisibility: true,
    ...AUTHZ_ERRORS,
    resolveWorkspace: (input, admin) => loadProjectExtra(admin, input.projectId),
  },
  async (input, ctx): Promise<ScopeItemActionResult> => {
    const { data: last } = await ctx.admin
      .from("project_scope_items")
      .select("position")
      .eq("project_id", ctx.projectId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();

    const newPosition = ((last as { position: number } | null)?.position ?? 0) + 1;

    const { data: inserted, error } = await ctx.admin
      .from("project_scope_items")
      .insert({
        project_id: ctx.projectId,
        title: input.title,
        description: input.description ?? null,
        included: input.included,
        source: input.source,
        position: newPosition,
      })
      .select(SCOPE_ITEM_COLUMNS)
      .single();

    if (error || !inserted) {
      logger.error("createScopeItem: insert failed", { error });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project_scope_item.created",
      targetType: "project_scope_item",
      targetId: inserted.id,
      metadata: { projectId: ctx.projectId, title: inserted.title },
    });

    await revalidateRecordSettings(ctx.workspaceSlug, ctx.projectId);
    return { ok: true, data: toScopeItem(inserted) };
  },
);

export async function createScopeItem(input: {
  projectId: string;
  title: string;
  description?: string | null;
  included: boolean;
  source: "proposal" | "change_request";
}): Promise<ScopeItemActionResult> {
  return createScopeItemImpl(input);
}

type ScopeItemExtra = ProjectExtra & { scopeItemTitle: string };

async function loadScopeItemExtra(
  admin: AdminClient,
  scopeItemId: string,
): Promise<
  | {
      ok: true;
      workspaceId: string;
      projectId: string;
      visibility: ProjectVisibility;
      extra: ScopeItemExtra;
    }
  | { ok: false; error: string }
> {
  const { data, error } = await admin
    .from("project_scope_items")
    .select(
      "id, project_id, title, projects!inner(id, workspace_id, visibility, deleted_at, workspaces(slug))",
    )
    .eq("id", scopeItemId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: "Scope item not found." };
  }

  const project = Array.isArray(data.projects) ? data.projects[0] : data.projects;
  if (!project?.workspace_id || project.deleted_at) {
    return { ok: false, error: "Scope item not found." };
  }

  const workspace = project.workspaces as { slug: string } | { slug: string }[] | null;
  const workspaceSlug = Array.isArray(workspace) ? workspace[0]?.slug : workspace?.slug;
  if (!workspaceSlug) {
    return { ok: false, error: "Scope item not found." };
  }

  return {
    ok: true,
    workspaceId: project.workspace_id,
    projectId: project.id,
    visibility: project.visibility === "private" ? "private" : "workspace",
    extra: { projectId: project.id, workspaceSlug, scopeItemTitle: data.title },
  };
}

const updateScopeItemImpl = withAuthz(
  updateScopeItemSchema,
  {
    requireWrite: true,
    requireVisibility: true,
    ...AUTHZ_ERRORS,
    resolveWorkspace: (input, admin) => loadScopeItemExtra(admin, input.scopeItemId),
  },
  async (input, ctx): Promise<ScopeItemActionResult> => {
    const { data: updated, error } = await ctx.admin
      .from("project_scope_items")
      .update({
        title: input.title,
        description: input.description,
        included: input.included,
        source: input.source,
      })
      .eq("id", input.scopeItemId)
      .select(SCOPE_ITEM_COLUMNS)
      .single();

    if (error || !updated) {
      logger.error("updateScopeItem: update failed", { error });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project_scope_item.updated",
      targetType: "project_scope_item",
      targetId: updated.id,
      metadata: { projectId: ctx.projectId, title: updated.title },
    });

    await revalidateRecordSettings(ctx.workspaceSlug, ctx.projectId);
    return { ok: true, data: toScopeItem(updated) };
  },
);

export async function updateScopeItem(input: {
  scopeItemId: string;
  title: string;
  description: string | null;
  included: boolean;
  source: "proposal" | "change_request";
}): Promise<ScopeItemActionResult> {
  return updateScopeItemImpl(input);
}

export type DeleteScopeItemResult =
  // F090 item 5: `restore` is the pre-delete row, verbatim -- see
  // deliverables.ts's deleteDeliverableImpl for why (hard `.delete()`,
  // no `deleted_at`/Trash entry).
  | { ok: true; data: { id: string; restore: ProjectScopeItem } }
  | { ok: false; error: string };

const deleteScopeItemImpl = withAuthz(
  deleteScopeItemSchema,
  {
    requireWrite: true,
    requireVisibility: true,
    ...AUTHZ_ERRORS,
    resolveWorkspace: (input, admin) => loadScopeItemExtra(admin, input.scopeItemId),
  },
  async (input, ctx): Promise<DeleteScopeItemResult> => {
    const { data: existing, error: readError } = await ctx.admin
      .from("project_scope_items")
      .select(SCOPE_ITEM_COLUMNS)
      .eq("id", input.scopeItemId)
      .maybeSingle();

    if (readError || !existing) {
      logger.error("deleteScopeItem: pre-delete read failed", { error: readError });
      return { ok: false, error: GENERIC_ERROR };
    }

    const { error } = await ctx.admin
      .from("project_scope_items")
      .delete()
      .eq("id", input.scopeItemId);

    if (error) {
      logger.error("deleteScopeItem: delete failed", { error });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project_scope_item.deleted",
      targetType: "project_scope_item",
      targetId: input.scopeItemId,
      metadata: { projectId: ctx.projectId, title: ctx.scopeItemTitle },
    });

    await revalidateRecordSettings(ctx.workspaceSlug, ctx.projectId);
    return { ok: true, data: { id: input.scopeItemId, restore: toScopeItem(existing) } };
  },
);

export async function deleteScopeItem(scopeItemId: string): Promise<DeleteScopeItemResult> {
  return deleteScopeItemImpl({ scopeItemId });
}

// F090 item 5: restoreScopeItem — undo for the hard delete above. Note:
// `change_request_id` is deliberately NOT accepted here even though
// `toScopeItem` reads it off the row -- a scope item created FROM a
// change request (`source: "change_request"`) is re-inserted with a null
// `change_request_id` link, same as every other field this schema
// re-validates rather than blindly trusting the client-held snapshot,
// since the linked change request itself may have moved on in the
// interim. The item's own text/inclusion/source are restored exactly;
// only the cross-table link is dropped.
const restoreScopeItemSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
  id: z.string().uuid("Invalid scope item."),
  title: z.string().min(1).max(200),
  description: z.string().nullable(),
  included: z.boolean(),
  source: z.enum(["proposal", "change_request"]),
  position: z.number(),
});

const restoreScopeItemImpl = withAuthz(
  restoreScopeItemSchema,
  {
    requireWrite: true,
    requireVisibility: true,
    ...AUTHZ_ERRORS,
    resolveWorkspace: (input, admin) => loadProjectExtra(admin, input.projectId),
  },
  async (input, ctx): Promise<ScopeItemActionResult> => {
    const { data, error } = await ctx.admin
      .from("project_scope_items")
      .insert({
        id: input.id,
        project_id: ctx.projectId,
        title: input.title,
        description: input.description,
        included: input.included,
        source: input.source,
        position: input.position,
      })
      .select(SCOPE_ITEM_COLUMNS)
      .single();

    if (error || !data) {
      logger.error("restoreScopeItem: insert failed", { error });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project_scope_item.restored",
      targetType: "project_scope_item",
      targetId: input.id,
      metadata: { projectId: ctx.projectId, title: input.title },
    });

    await revalidateRecordSettings(ctx.workspaceSlug, ctx.projectId);
    return { ok: true, data: toScopeItem(data) };
  },
);

export async function restoreScopeItem(input: {
  projectId: string;
  id: string;
  title: string;
  description: string | null;
  included: boolean;
  source: ScopeItemSource;
  position: number;
}): Promise<ScopeItemActionResult> {
  return restoreScopeItemImpl(input);
}

// ---------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------

export type DecisionActionResult = ActionResult<ProjectDecision>;

function toDecision(row: {
  id: string;
  project_id: string;
  phase_id: string | null;
  title: string;
  rationale: string | null;
  decision_type: string;
  decided_on: string;
  decided_by_name: string | null;
  client_visible: boolean;
  created_by: string;
}): ProjectDecision {
  return {
    id: row.id,
    projectId: row.project_id,
    phaseId: row.phase_id,
    title: row.title,
    rationale: row.rationale,
    decisionType: row.decision_type as DecisionType,
    decidedOn: row.decided_on,
    decidedByName: row.decided_by_name,
    clientVisible: row.client_visible,
    createdBy: row.created_by,
  };
}

const DECISION_COLUMNS =
  "id, project_id, phase_id, title, rationale, decision_type, decided_on, decided_by_name, client_visible, created_by";

const createDecisionImpl = withAuthz(
  createDecisionSchema,
  {
    requireWrite: true,
    requireVisibility: true,
    ...AUTHZ_ERRORS,
    resolveWorkspace: (input, admin) => loadProjectExtra(admin, input.projectId),
  },
  async (input, ctx): Promise<DecisionActionResult> => {
    const { data: inserted, error } = await ctx.admin
      .from("project_decisions")
      .insert({
        project_id: ctx.projectId,
        phase_id: input.phaseId ?? null,
        title: input.title,
        rationale: input.rationale ?? null,
        decision_type: input.decisionType,
        decided_on: input.decidedOn,
        decided_by_name: input.decidedByName ?? null,
        client_visible: input.clientVisible ?? true,
        created_by: ctx.user.id,
      })
      .select(DECISION_COLUMNS)
      .single();

    if (error || !inserted) {
      logger.error("createDecision: insert failed", { error });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project_decision.created",
      targetType: "project_decision",
      targetId: inserted.id,
      metadata: { projectId: ctx.projectId, title: inserted.title },
    });

    await revalidateRecordSettings(ctx.workspaceSlug, ctx.projectId);
    return { ok: true, data: toDecision(inserted) };
  },
);

export async function createDecision(input: {
  projectId: string;
  phaseId?: string | null;
  title: string;
  rationale?: string | null;
  decisionType: DecisionType;
  decidedOn?: string;
  decidedByName?: string | null;
  clientVisible?: boolean;
}): Promise<DecisionActionResult> {
  return createDecisionImpl(input);
}

type DecisionExtra = ProjectExtra & { decisionTitle: string };

async function loadDecisionExtra(
  admin: AdminClient,
  decisionId: string,
): Promise<
  | {
      ok: true;
      workspaceId: string;
      projectId: string;
      visibility: ProjectVisibility;
      extra: DecisionExtra;
    }
  | { ok: false; error: string }
> {
  const { data, error } = await admin
    .from("project_decisions")
    .select(
      "id, project_id, title, projects!inner(id, workspace_id, visibility, deleted_at, workspaces(slug))",
    )
    .eq("id", decisionId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: "Decision not found." };
  }

  const project = Array.isArray(data.projects) ? data.projects[0] : data.projects;
  if (!project?.workspace_id || project.deleted_at) {
    return { ok: false, error: "Decision not found." };
  }

  const workspace = project.workspaces as { slug: string } | { slug: string }[] | null;
  const workspaceSlug = Array.isArray(workspace) ? workspace[0]?.slug : workspace?.slug;
  if (!workspaceSlug) {
    return { ok: false, error: "Decision not found." };
  }

  return {
    ok: true,
    workspaceId: project.workspace_id,
    projectId: project.id,
    visibility: project.visibility === "private" ? "private" : "workspace",
    extra: { projectId: project.id, workspaceSlug, decisionTitle: data.title },
  };
}

const updateDecisionImpl = withAuthz(
  updateDecisionSchema,
  {
    requireWrite: true,
    requireVisibility: true,
    ...AUTHZ_ERRORS,
    resolveWorkspace: (input, admin) => loadDecisionExtra(admin, input.decisionId),
  },
  async (input, ctx): Promise<DecisionActionResult> => {
    const { data: updated, error } = await ctx.admin
      .from("project_decisions")
      .update({
        phase_id: input.phaseId,
        title: input.title,
        rationale: input.rationale,
        decision_type: input.decisionType,
        decided_on: input.decidedOn,
        decided_by_name: input.decidedByName,
        client_visible: input.clientVisible,
      })
      .eq("id", input.decisionId)
      .select(DECISION_COLUMNS)
      .single();

    if (error || !updated) {
      logger.error("updateDecision: update failed", { error });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project_decision.updated",
      targetType: "project_decision",
      targetId: updated.id,
      metadata: {
        projectId: ctx.projectId,
        title: updated.title,
        clientVisible: updated.client_visible,
      },
    });

    await revalidateRecordSettings(ctx.workspaceSlug, ctx.projectId);
    return { ok: true, data: toDecision(updated) };
  },
);

export async function updateDecision(input: {
  decisionId: string;
  phaseId: string | null;
  title: string;
  rationale: string | null;
  decisionType: DecisionType;
  decidedOn: string;
  decidedByName: string | null;
  clientVisible: boolean;
}): Promise<DecisionActionResult> {
  return updateDecisionImpl(input);
}

export type DeleteDecisionResult =
  // F090 item 5: `restore` is the pre-delete row -- see this file's
  // scope-item restore above for the same shape/rationale. NOTE
  // (F090's own instruction): a decision record is one of this audit's
  // own named candidates for real soft-delete (a frozen decision is an
  // audit-trail item, not a scratch note) -- this reinsert-on-undo is
  // the pragmatic fix for the immediate "one click, no confirmation
  // asymmetry, gone forever" defect, not a replacement for that larger
  // migration. See this feature's handoff for the explicit call-out.
  | { ok: true; data: { id: string; restore: ProjectDecision } }
  | { ok: false; error: string };

const deleteDecisionImpl = withAuthz(
  deleteDecisionSchema,
  {
    requireWrite: true,
    requireVisibility: true,
    ...AUTHZ_ERRORS,
    resolveWorkspace: (input, admin) => loadDecisionExtra(admin, input.decisionId),
  },
  async (input, ctx): Promise<DeleteDecisionResult> => {
    const { data: existing, error: readError } = await ctx.admin
      .from("project_decisions")
      .select(DECISION_COLUMNS)
      .eq("id", input.decisionId)
      .maybeSingle();

    if (readError || !existing) {
      logger.error("deleteDecision: pre-delete read failed", { error: readError });
      return { ok: false, error: GENERIC_ERROR };
    }

    const { error } = await ctx.admin
      .from("project_decisions")
      .delete()
      .eq("id", input.decisionId);

    if (error) {
      logger.error("deleteDecision: delete failed", { error });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project_decision.deleted",
      targetType: "project_decision",
      targetId: input.decisionId,
      metadata: { projectId: ctx.projectId, title: ctx.decisionTitle },
    });

    await revalidateRecordSettings(ctx.workspaceSlug, ctx.projectId);
    return { ok: true, data: { id: input.decisionId, restore: toDecision(existing) } };
  },
);

export async function deleteDecision(decisionId: string): Promise<DeleteDecisionResult> {
  return deleteDecisionImpl({ decisionId });
}

// F090 item 5: restoreDecision — undo for the hard delete above.
// `phaseId`/`createdBy` are re-validated (uuid or null) but not
// re-checked for cross-project/still-active membership -- same trust
// level createDecision already gives its own caller-supplied
// `phaseId`/`decidedByName` (see createDecisionImpl below).
const restoreDecisionSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
  id: z.string().uuid("Invalid decision."),
  phaseId: z.string().uuid().nullable(),
  title: z.string().min(1).max(200),
  rationale: z.string().nullable(),
  decisionType: z.string(),
  decidedOn: z.string(),
  decidedByName: z.string().nullable(),
  clientVisible: z.boolean(),
  createdBy: z.string().uuid(),
});

const restoreDecisionImpl = withAuthz(
  restoreDecisionSchema,
  {
    requireWrite: true,
    requireVisibility: true,
    ...AUTHZ_ERRORS,
    resolveWorkspace: (input, admin) => loadProjectExtra(admin, input.projectId),
  },
  async (input, ctx): Promise<DecisionActionResult> => {
    const { data, error } = await ctx.admin
      .from("project_decisions")
      .insert({
        id: input.id,
        project_id: ctx.projectId,
        phase_id: input.phaseId,
        title: input.title,
        rationale: input.rationale,
        decision_type: input.decisionType,
        decided_on: input.decidedOn,
        decided_by_name: input.decidedByName,
        client_visible: input.clientVisible,
        created_by: input.createdBy,
      })
      .select(DECISION_COLUMNS)
      .single();

    if (error || !data) {
      logger.error("restoreDecision: insert failed", { error });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project_decision.restored",
      targetType: "project_decision",
      targetId: input.id,
      metadata: { projectId: ctx.projectId, title: input.title },
    });

    await revalidateRecordSettings(ctx.workspaceSlug, ctx.projectId);
    return { ok: true, data: toDecision(data) };
  },
);

export async function restoreDecision(input: {
  projectId: string;
  id: string;
  phaseId: string | null;
  title: string;
  rationale: string | null;
  decisionType: DecisionType;
  decidedOn: string;
  decidedByName: string | null;
  clientVisible: boolean;
  createdBy: string;
}): Promise<DecisionActionResult> {
  return restoreDecisionImpl(input);
}

// "Turn into decision" — components/task/comment-list.tsx's comment menu
// item. Carries the comment's own text (as the decision's `rationale` —
// the full context, not truncated), a title derived from the first line
// of that text (never re-typed), the comment's author name (as
// `decided_by_name` — free text on this table, per F012's own schema, so
// no FK/lookup needed) and its `createdAt` (as `decided_on`, truncated to
// a date — this table's own column type), and the task's phase (resolved
// server-side from `taskId`, never trusted from the client, the same
// "look the task up yourself" rule `loadDeliverableExtra` etc. all
// follow).
//
// `decisionType` is NOT collected from the poster — fixed to 'content'
// (the most common bucket for something that started life as a comment:
// a content/copy call made in a discussion) and editable afterwards in
// the Record panel, same as every other field on a freshly created row.
// This keeps "Turn into decision" a single click with no dialog, per the
// spec's own instruction that a dialog here is the step where the
// practice dies.
const DEFAULT_DECISION_TYPE_FROM_COMMENT: DecisionType = "content";

function titleFromCommentText(text: string): string {
  const firstLine = text.split(/\r?\n/)[0]?.trim() ?? "";
  const collapsed = firstLine || text.trim();
  return collapsed.length > 140 ? `${collapsed.slice(0, 137)}...` : collapsed;
}

type TaskExtra = ProjectExtra & { phaseId: string | null };

async function loadTaskExtraForComment(
  admin: AdminClient,
  taskId: string,
): Promise<
  | {
      ok: true;
      workspaceId: string;
      projectId: string;
      visibility: ProjectVisibility;
      extra: TaskExtra;
    }
  | { ok: false; error: string }
> {
  const { data, error } = await admin
    .from("tasks")
    .select(
      "id, project_id, phase_id, deleted_at, projects!inner(id, workspace_id, visibility, deleted_at, workspaces(slug))",
    )
    .eq("id", taskId)
    .maybeSingle();

  if (error || !data || data.deleted_at) {
    return { ok: false, error: "Task not found." };
  }

  const project = Array.isArray(data.projects) ? data.projects[0] : data.projects;
  if (!project?.workspace_id || project.deleted_at) {
    return { ok: false, error: "Task not found." };
  }

  const workspace = project.workspaces as { slug: string } | { slug: string }[] | null;
  const workspaceSlug = Array.isArray(workspace) ? workspace[0]?.slug : workspace?.slug;
  if (!workspaceSlug) {
    return { ok: false, error: "Task not found." };
  }

  return {
    ok: true,
    workspaceId: project.workspace_id,
    projectId: project.id,
    visibility: project.visibility === "private" ? "private" : "workspace",
    extra: { projectId: project.id, workspaceSlug, phaseId: data.phase_id },
  };
}

const createDecisionFromCommentImpl = withAuthz(
  createDecisionFromCommentSchema,
  {
    requireWrite: true,
    requireVisibility: true,
    membershipError: "You don't have permission to record a decision on this project.",
    writeError: "Viewers don't have permission to record a decision.",
    visibilityError: "You don't have permission to record a decision on this project.",
    resolveWorkspace: (input, admin) => loadTaskExtraForComment(admin, input.taskId),
  },
  async (input, ctx): Promise<DecisionActionResult> => {
    const decidedOn = input.commentCreatedAt.slice(0, 10);

    const { data: inserted, error } = await ctx.admin
      .from("project_decisions")
      .insert({
        project_id: ctx.projectId,
        phase_id: ctx.phaseId,
        title: titleFromCommentText(input.commentText),
        rationale: input.commentText,
        decision_type: DEFAULT_DECISION_TYPE_FROM_COMMENT,
        decided_on: decidedOn,
        decided_by_name: input.commentAuthorName,
        client_visible: true,
        created_by: ctx.user.id,
      })
      .select(DECISION_COLUMNS)
      .single();

    if (error || !inserted) {
      logger.error("createDecisionFromComment: insert failed", { error });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project_decision.created_from_comment",
      targetType: "project_decision",
      targetId: inserted.id,
      metadata: {
        projectId: ctx.projectId,
        title: inserted.title,
        sourceCommentId: input.commentId,
        sourceTaskId: input.taskId,
      },
    });

    await revalidateRecordSettings(ctx.workspaceSlug, ctx.projectId);
    return { ok: true, data: toDecision(inserted) };
  },
);

export async function createDecisionFromComment(input: {
  taskId: string;
  commentId: string;
  commentText: string;
  commentAuthorName: string | null;
  commentCreatedAt: string;
}): Promise<DecisionActionResult> {
  return createDecisionFromCommentImpl(input);
}

// ---------------------------------------------------------------------
// Assumptions
// ---------------------------------------------------------------------

export type AssumptionActionResult = ActionResult<ProjectAssumption>;

function toAssumption(row: {
  id: string;
  project_id: string;
  text: string;
  state: string;
  confirmed_on: string | null;
  confirmed_by_name: string | null;
  client_visible: boolean;
  flagged_by_client_at: string | null;
  flagged_note: string | null;
}): ProjectAssumption {
  return {
    id: row.id,
    projectId: row.project_id,
    text: row.text,
    state: row.state as AssumptionState,
    confirmedOn: row.confirmed_on,
    confirmedByName: row.confirmed_by_name,
    clientVisible: row.client_visible,
    flaggedByClientAt: row.flagged_by_client_at,
    flaggedNote: row.flagged_note,
  };
}

const ASSUMPTION_COLUMNS =
  "id, project_id, text, state, confirmed_on, confirmed_by_name, client_visible, flagged_by_client_at, flagged_note";

const createAssumptionImpl = withAuthz(
  createAssumptionSchema,
  {
    requireWrite: true,
    requireVisibility: true,
    ...AUTHZ_ERRORS,
    resolveWorkspace: (input, admin) => loadProjectExtra(admin, input.projectId),
  },
  async (input, ctx): Promise<AssumptionActionResult> => {
    const { data: inserted, error } = await ctx.admin
      .from("project_assumptions")
      .insert({
        project_id: ctx.projectId,
        text: input.text,
        client_visible: input.clientVisible ?? true,
      })
      .select(ASSUMPTION_COLUMNS)
      .single();

    if (error || !inserted) {
      logger.error("createAssumption: insert failed", { error });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project_assumption.created",
      targetType: "project_assumption",
      targetId: inserted.id,
      metadata: { projectId: ctx.projectId },
    });

    await revalidateRecordSettings(ctx.workspaceSlug, ctx.projectId);
    return { ok: true, data: toAssumption(inserted) };
  },
);

export async function createAssumption(input: {
  projectId: string;
  text: string;
  clientVisible?: boolean;
}): Promise<AssumptionActionResult> {
  return createAssumptionImpl(input);
}

type AssumptionExtra = ProjectExtra & { assumptionText: string };

async function loadAssumptionExtra(
  admin: AdminClient,
  assumptionId: string,
): Promise<
  | {
      ok: true;
      workspaceId: string;
      projectId: string;
      visibility: ProjectVisibility;
      extra: AssumptionExtra;
    }
  | { ok: false; error: string }
> {
  const { data, error } = await admin
    .from("project_assumptions")
    .select(
      "id, project_id, text, projects!inner(id, workspace_id, visibility, deleted_at, workspaces(slug))",
    )
    .eq("id", assumptionId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: "Assumption not found." };
  }

  const project = Array.isArray(data.projects) ? data.projects[0] : data.projects;
  if (!project?.workspace_id || project.deleted_at) {
    return { ok: false, error: "Assumption not found." };
  }

  const workspace = project.workspaces as { slug: string } | { slug: string }[] | null;
  const workspaceSlug = Array.isArray(workspace) ? workspace[0]?.slug : workspace?.slug;
  if (!workspaceSlug) {
    return { ok: false, error: "Assumption not found." };
  }

  return {
    ok: true,
    workspaceId: project.workspace_id,
    projectId: project.id,
    visibility: project.visibility === "private" ? "private" : "workspace",
    extra: { projectId: project.id, workspaceSlug, assumptionText: data.text },
  };
}

const updateAssumptionImpl = withAuthz(
  updateAssumptionSchema,
  {
    requireWrite: true,
    requireVisibility: true,
    ...AUTHZ_ERRORS,
    resolveWorkspace: (input, admin) => loadAssumptionExtra(admin, input.assumptionId),
  },
  async (input, ctx): Promise<AssumptionActionResult> => {
    // Confirming or invalidating an assumption (leaving `state !==
    // 'assumed'`) stamps who/when, the same "who decided this" shape
    // `accept_deliverable_atomic` records for a review decision — and,
    // per this feature's own spec, is how the team acts on a client's
    // flag: they read `flagged_note`, then change `state` here
    // themselves (never automatically).
    const confirming = input.state !== "assumed";

    const { data: updated, error } = await ctx.admin
      .from("project_assumptions")
      .update({
        text: input.text,
        state: input.state,
        client_visible: input.clientVisible,
        confirmed_on: confirming ? new Date().toISOString().slice(0, 10) : null,
        confirmed_by_name: confirming ? (ctx.user.email ?? ctx.user.id) : null,
      })
      .eq("id", input.assumptionId)
      .select(ASSUMPTION_COLUMNS)
      .single();

    if (error || !updated) {
      logger.error("updateAssumption: update failed", { error });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project_assumption.updated",
      targetType: "project_assumption",
      targetId: updated.id,
      metadata: { projectId: ctx.projectId, state: updated.state },
    });

    await revalidateRecordSettings(ctx.workspaceSlug, ctx.projectId);
    return { ok: true, data: toAssumption(updated) };
  },
);

export async function updateAssumption(input: {
  assumptionId: string;
  text: string;
  state: AssumptionState;
  clientVisible: boolean;
}): Promise<AssumptionActionResult> {
  return updateAssumptionImpl(input);
}

export type DeleteAssumptionResult = ActionResult<{ id: string; restore: ProjectAssumption }>;

const deleteAssumptionImpl = withAuthz(
  deleteAssumptionSchema,
  {
    requireWrite: true,
    requireVisibility: true,
    ...AUTHZ_ERRORS,
    resolveWorkspace: (input, admin) => loadAssumptionExtra(admin, input.assumptionId),
  },
  async (input, ctx): Promise<DeleteAssumptionResult> => {
    const { data: existing, error: readError } = await ctx.admin
      .from("project_assumptions")
      .select(ASSUMPTION_COLUMNS)
      .eq("id", input.assumptionId)
      .maybeSingle();

    if (readError || !existing) {
      logger.error("deleteAssumption: pre-delete read failed", { error: readError });
      return { ok: false, error: GENERIC_ERROR };
    }

    const { error } = await ctx.admin
      .from("project_assumptions")
      .delete()
      .eq("id", input.assumptionId);

    if (error) {
      logger.error("deleteAssumption: delete failed", { error });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project_assumption.deleted",
      targetType: "project_assumption",
      targetId: input.assumptionId,
      metadata: { projectId: ctx.projectId, text: ctx.assumptionText },
    });

    await revalidateRecordSettings(ctx.workspaceSlug, ctx.projectId);
    return { ok: true, data: { id: input.assumptionId, restore: toAssumption(existing) } };
  },
);

export async function deleteAssumption(assumptionId: string): Promise<DeleteAssumptionResult> {
  return deleteAssumptionImpl({ assumptionId });
}

// F090 item 5: restoreAssumption — undo for the hard delete above.
const restoreAssumptionSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
  id: z.string().uuid("Invalid assumption."),
  text: z.string().min(1),
  state: z.string(),
  confirmedOn: z.string().nullable(),
  confirmedByName: z.string().nullable(),
  clientVisible: z.boolean(),
  flaggedByClientAt: z.string().nullable(),
  flaggedNote: z.string().nullable(),
});

const restoreAssumptionImpl = withAuthz(
  restoreAssumptionSchema,
  {
    requireWrite: true,
    requireVisibility: true,
    ...AUTHZ_ERRORS,
    resolveWorkspace: (input, admin) => loadProjectExtra(admin, input.projectId),
  },
  async (input, ctx): Promise<AssumptionActionResult> => {
    const { data, error } = await ctx.admin
      .from("project_assumptions")
      .insert({
        id: input.id,
        project_id: ctx.projectId,
        text: input.text,
        state: input.state,
        confirmed_on: input.confirmedOn,
        confirmed_by_name: input.confirmedByName,
        client_visible: input.clientVisible,
        flagged_by_client_at: input.flaggedByClientAt,
        flagged_note: input.flaggedNote,
      })
      .select(ASSUMPTION_COLUMNS)
      .single();

    if (error || !data) {
      logger.error("restoreAssumption: insert failed", { error });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project_assumption.restored",
      targetType: "project_assumption",
      targetId: input.id,
      metadata: { projectId: ctx.projectId, text: input.text },
    });

    await revalidateRecordSettings(ctx.workspaceSlug, ctx.projectId);
    return { ok: true, data: toAssumption(data) };
  },
);

export async function restoreAssumption(input: {
  projectId: string;
  id: string;
  text: string;
  state: AssumptionState;
  confirmedOn: string | null;
  confirmedByName: string | null;
  clientVisible: boolean;
  flaggedByClientAt: string | null;
  flaggedNote: string | null;
}): Promise<AssumptionActionResult> {
  return restoreAssumptionImpl(input);
}
