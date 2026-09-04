"use server";

// F018 (missions/20260903-portal): team-side CRUD for `project_budgets`
// (AS-033). Mirrors lib/actions/deliverables.ts's shape exactly — same
// withAuthz pipeline, same default `canWrite` gate (a viewer/client is
// rejected the same way a deliverable mutation rejects them — this
// feature's own Definition of done failure test), same `ctx.admin` write
// path with RLS as the backstop (`project_budgets_insert_team` /
// `_update_team` / `_delete_team`, 20261010010000, all gated on
// `is_project_workspace_writer`, which itself excludes viewer and
// client).

import { revalidatePath } from "next/cache";

import { logger } from "@/lib/observability/logger";
import { canWrite } from "@/lib/auth/permissions";
import { withAuthz } from "@/lib/actions/authz";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/activity/audit";
import {
  createProjectBudgetSchema,
  updateProjectBudgetSchema,
  deleteProjectBudgetSchema,
  previewProjectBudgetSpentSchema,
} from "@/lib/validation/project-budgets";
import type { ProjectVisibility } from "@/lib/actions/project-visibility";
import type { ProjectBudget, BudgetRollover } from "@/lib/queries/project-budgets";

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";

type AdminClient = ReturnType<typeof createAdminClient>;

export type ProjectBudgetActionResult =
  | { ok: true; data: ProjectBudget }
  | { ok: false; error: string };

function toBudgetActionData(row: {
  id: string;
  project_id: string;
  period_start: string;
  period_end: string;
  sold_minutes: number;
  currency: string | null;
  rate_amount: number | null;
  rollover: string;
  note: string | null;
}): ProjectBudget {
  return {
    id: row.id,
    projectId: row.project_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    soldMinutes: row.sold_minutes,
    currency: row.currency,
    rateAmount: row.rate_amount,
    rollover: row.rollover as BudgetRollover,
    note: row.note,
  };
}

const BUDGET_COLUMNS =
  "id, project_id, period_start, period_end, sold_minutes, currency, rate_amount, rollover, note";

async function revalidateBudgetSettings(workspaceSlug: string, projectId: string) {
  try {
    revalidatePath(`/w/${workspaceSlug}/projects/${projectId}/settings/budget`, "page");
  } catch (revalidateError) {
    logger.error("project-budgets: revalidatePath failed (non-fatal)", {
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

type BudgetExtra = ProjectExtra;

async function loadBudgetExtra(
  admin: AdminClient,
  budgetId: string,
): Promise<
  | {
      ok: true;
      workspaceId: string;
      projectId: string;
      visibility: ProjectVisibility;
      extra: BudgetExtra;
    }
  | { ok: false; error: string }
> {
  const { data, error } = await admin
    .from("project_budgets")
    .select(
      "id, project_id, projects!inner(id, workspace_id, visibility, deleted_at, workspaces(slug))",
    )
    .eq("id", budgetId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: "Budget not found." };
  }

  const project = Array.isArray(data.projects) ? data.projects[0] : data.projects;
  if (!project?.workspace_id || project.deleted_at) {
    return { ok: false, error: "Budget not found." };
  }

  const workspace = project.workspaces as { slug: string } | { slug: string }[] | null;
  const workspaceSlug = Array.isArray(workspace) ? workspace[0]?.slug : workspace?.slug;
  if (!workspaceSlug) {
    return { ok: false, error: "Budget not found." };
  }

  return {
    ok: true,
    workspaceId: project.workspace_id,
    projectId: project.id,
    visibility: project.visibility === "private" ? "private" : "workspace",
    extra: { projectId: project.id, workspaceSlug },
  };
}

// ---------------------------------------------------------------------
// createProjectBudget
// ---------------------------------------------------------------------

const createProjectBudgetImpl = withAuthz(
  createProjectBudgetSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to manage this project's budget.",
    writeError: "Viewers and clients don't have permission to manage the budget.",
    requireVisibility: true,
    visibilityError: "You don't have permission to manage this project's budget.",
    resolveWorkspace: (input, admin) => loadProjectExtra(admin, input.projectId),
  },
  async (input, ctx): Promise<ProjectBudgetActionResult> => {
    const { data: inserted, error: insertError } = await ctx.admin
      .from("project_budgets")
      .insert({
        project_id: ctx.projectId,
        period_start: input.periodStart,
        period_end: input.periodEnd,
        sold_minutes: input.soldMinutes,
        currency: input.currency ?? null,
        rate_amount: input.rateAmount ?? null,
        rollover: input.rollover ?? "none",
        note: input.note ?? null,
      })
      .select(BUDGET_COLUMNS)
      .single();

    if (insertError || !inserted) {
      logger.error("createProjectBudget: insert failed", { error: insertError });
      // The exclusion constraint (project_budgets_no_overlap) is the real
      // enforcement boundary for "no two overlapping periods"; surfaced
      // here as a specific message (not GENERIC_ERROR) so a PM adding a
      // second budget for a period that already has one gets an
      // explanation, not a silent failure.
      if (insertError?.code === "23P01") {
        return {
          ok: false,
          error: "This period overlaps an existing budget for this project.",
        };
      }
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project_budget.created",
      targetType: "project_budget",
      targetId: inserted.id,
      metadata: { projectId: ctx.projectId, soldMinutes: inserted.sold_minutes },
    });

    await revalidateBudgetSettings(ctx.workspaceSlug, ctx.projectId);

    return { ok: true, data: toBudgetActionData(inserted) };
  },
);

export async function createProjectBudget(input: {
  projectId: string;
  periodStart: string;
  periodEnd: string;
  soldMinutes: number;
  currency?: string | null;
  rateAmount?: number | null;
  rollover?: BudgetRollover;
  note?: string | null;
}): Promise<ProjectBudgetActionResult> {
  return createProjectBudgetImpl(input);
}

// ---------------------------------------------------------------------
// updateProjectBudget
// ---------------------------------------------------------------------

const updateProjectBudgetImpl = withAuthz(
  updateProjectBudgetSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to manage this project's budget.",
    writeError: "Viewers and clients don't have permission to manage the budget.",
    requireVisibility: true,
    visibilityError: "You don't have permission to manage this project's budget.",
    resolveWorkspace: (input, admin) => loadBudgetExtra(admin, input.budgetId),
  },
  async (input, ctx): Promise<ProjectBudgetActionResult> => {
    const { data: updated, error: updateError } = await ctx.admin
      .from("project_budgets")
      .update({
        period_start: input.periodStart,
        period_end: input.periodEnd,
        sold_minutes: input.soldMinutes,
        currency: input.currency,
        rate_amount: input.rateAmount,
        rollover: input.rollover,
        note: input.note,
      })
      .eq("id", input.budgetId)
      .select(BUDGET_COLUMNS)
      .single();

    if (updateError || !updated) {
      logger.error("updateProjectBudget: update failed", { error: updateError });
      if (updateError?.code === "23P01") {
        return {
          ok: false,
          error: "This period overlaps an existing budget for this project.",
        };
      }
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project_budget.updated",
      targetType: "project_budget",
      targetId: updated.id,
      metadata: { projectId: ctx.projectId, soldMinutes: updated.sold_minutes },
    });

    await revalidateBudgetSettings(ctx.workspaceSlug, ctx.projectId);

    return { ok: true, data: toBudgetActionData(updated) };
  },
);

export async function updateProjectBudget(input: {
  budgetId: string;
  periodStart: string;
  periodEnd: string;
  soldMinutes: number;
  currency: string | null;
  rateAmount: number | null;
  rollover: BudgetRollover;
  note: string | null;
}): Promise<ProjectBudgetActionResult> {
  return updateProjectBudgetImpl(input);
}

// ---------------------------------------------------------------------
// deleteProjectBudget
// ---------------------------------------------------------------------

export type DeleteProjectBudgetResult =
  | { ok: true; data: { id: string } }
  | { ok: false; error: string };

const deleteProjectBudgetImpl = withAuthz(
  deleteProjectBudgetSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to manage this project's budget.",
    writeError: "Viewers and clients don't have permission to manage the budget.",
    requireVisibility: true,
    visibilityError: "You don't have permission to manage this project's budget.",
    resolveWorkspace: (input, admin) => loadBudgetExtra(admin, input.budgetId),
  },
  async (input, ctx): Promise<DeleteProjectBudgetResult> => {
    const { error: deleteError } = await ctx.admin
      .from("project_budgets")
      .delete()
      .eq("id", input.budgetId);

    if (deleteError) {
      logger.error("deleteProjectBudget: delete failed", { error: deleteError });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project_budget.deleted",
      targetType: "project_budget",
      targetId: input.budgetId,
      metadata: { projectId: ctx.projectId },
    });

    await revalidateBudgetSettings(ctx.workspaceSlug, ctx.projectId);

    return { ok: true, data: { id: input.budgetId } };
  },
);

export async function deleteProjectBudget(
  budgetId: string,
): Promise<DeleteProjectBudgetResult> {
  return deleteProjectBudgetImpl({ budgetId });
}

// ---------------------------------------------------------------------
// previewProjectBudgetSpent
// ---------------------------------------------------------------------
// Read-only: how many billable minutes are already logged in a given
// [periodStart, periodEnd] range, so the create/edit form can show it
// beside the sold-hours field per this feature's own spec ("Show what is
// already spent in the current period beside the field, so the number is
// entered with context rather than blind"). requireWrite is NOT set here
// (a read, not a mutation) but requireVisibility still is — only a team
// member who can see the project may preview its spend.
export type PreviewProjectBudgetSpentResult =
  | { ok: true; data: { minutes: number } }
  | { ok: false; error: string };

const previewProjectBudgetSpentImpl = withAuthz(
  previewProjectBudgetSpentSchema,
  {
    membershipError: "You don't have permission to view this project's hours.",
    requireVisibility: true,
    visibilityError: "You don't have permission to view this project's hours.",
    resolveWorkspace: (input, admin) => loadProjectExtra(admin, input.projectId),
  },
  async (input, ctx): Promise<PreviewProjectBudgetSpentResult> => {
    // "Team, not client": client callers are already denied above by
    // isProjectVisibleToCaller/requireActiveMembership only ruling on
    // membership+visibility, not role — so the same explicit "team, not
    // client" re-check project_hours_team's own RPC body uses is applied
    // here too, via a plain role check (canWrite already denies client,
    // reused instead of a redundant is_project_client roundtrip).
    if (!canWrite({ role: ctx.role })) {
      return {
        ok: false,
        error: "You don't have permission to view this project's hours.",
      };
    }

    const { data: taskRows } = await ctx.admin
      .from("tasks")
      .select("id")
      .eq("project_id", ctx.projectId)
      .is("deleted_at", null);

    const taskIds = (taskRows ?? []).map((row) => row.id);
    if (taskIds.length === 0) {
      return { ok: true, data: { minutes: 0 } };
    }

    const { data: entryRows, error: entryError } = await ctx.admin
      .from("time_entries")
      .select("minutes")
      .in("task_id", taskIds)
      .eq("billable", true)
      .gte("entry_date", input.periodStart)
      .lte("entry_date", input.periodEnd);

    if (entryError) {
      logger.error("previewProjectBudgetSpent: query failed", { error: entryError });
      return { ok: false, error: GENERIC_ERROR };
    }

    const minutes = (entryRows ?? []).reduce((sum, row) => sum + row.minutes, 0);
    return { ok: true, data: { minutes } };
  },
);

export async function previewProjectBudgetSpent(
  projectId: string,
  periodStart: string,
  periodEnd: string,
): Promise<PreviewProjectBudgetSpentResult> {
  return previewProjectBudgetSpentImpl({ projectId, periodStart, periodEnd });
}
