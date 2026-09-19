"use server";

// Discipline estimate write actions for the Architecture board.
// Mission 20260918-architecture-enrichment, F12: lets a workspace member set,
// clear, or bulk-set per-discipline time estimates on a task (page/section/
// component). Follows the exact auth chain convention every other
// architecture action uses (see lib/actions/architecture/sections.ts):
// parse input -> resolve current user -> look up the task server-side to
// derive project_id/workspace_id (never trust these from the client) ->
// re-check active membership + write permission -> mutate -> revalidate.
import { revalidatePath } from "next/cache";

import { logger } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { canWrite } from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/activity/audit";
import {
  setDisciplineEstimateSchema,
  clearDisciplineEstimateSchema,
  setDisciplineEstimatesBulkSchema,
  parseEstimateInput,
} from "@/lib/validation/architecture";

import type { MutationResult } from "./shared";

// Shared task lookup: resolves project_id + workspace_id for a task id,
// server-side, so callers can never smuggle in a different project_id via
// function args. Excludes soft-deleted tasks.
async function loadTaskForEstimate(
  admin: ReturnType<typeof createAdminClient>,
  taskId: string,
) {
  const { data: taskRow, error: taskError } = await admin
    .from("tasks")
    .select("id, project_id, deleted_at, projects(workspace_id, workspaces(slug))")
    .eq("id", taskId)
    .single();

  if (taskError || !taskRow || taskRow.deleted_at !== null) {
    return null;
  }

  const projects = (
    taskRow as { projects?: { workspace_id?: string } | { workspace_id?: string }[] | null }
  ).projects;
  const projectRow = Array.isArray(projects) ? projects[0] : projects;
  const workspaceId = projectRow?.workspace_id;

  if (!workspaceId) {
    return null;
  }

  return { projectId: taskRow.project_id as string, workspaceId };
}

// NOTE (F023 / AS-082): `setDisciplineEstimatesBulk` is now the primary action
// used by the discipline-estimate popover for multi-discipline edits. These
// singular actions (`setDisciplineEstimate`, `clearDisciplineEstimate`) are
// NOT deprecated — they are kept intentionally as a supported single-discipline
// API surface for future callers (e.g. programmatic/API-driven updates or UI
// contexts that only ever touch one discipline at a time). Do not remove
// without re-checking for external callers first.
export async function setDisciplineEstimate(
  taskId: string,
  discipline: string,
  input: string,
  note?: string,
): Promise<MutationResult> {
  const parsed = setDisciplineEstimateSchema.safeParse({
    taskId,
    discipline,
    input,
    note,
  });

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid estimate.",
    };
  }

  const minutes = parseEstimateInput(parsed.data.input);

  if (minutes === null) {
    return {
      success: false,
      error: 'Invalid format. Use "2h 30m", "90m", or "1.5h".',
    };
  }

  const { user } = await getCurrentUser();

  if (!user) {
    return { success: false, error: "You must be signed in to set an estimate." };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  const taskInfo = await loadTaskForEstimate(admin, parsed.data.taskId);

  if (!taskInfo) {
    return { success: false, error: "Task not found." };
  }

  const membership = await requireActiveMembership(admin, taskInfo.workspaceId, user.id);

  if (!membership.ok) {
    return {
      success: false,
      error: "You don't have permission to set an estimate on this task.",
    };
  }

  if (!canWrite({ role: membership.role })) {
    return {
      success: false,
      error: "Viewers don't have permission to set estimates.",
    };
  }

  const { error: upsertError } = await admin
    .from("task_discipline_estimates")
    .upsert(
      {
        task_id: parsed.data.taskId,
        project_id: taskInfo.projectId,
        discipline: parsed.data.discipline,
        minutes,
        note: parsed.data.note ?? null,
        estimated_by: user.id,
      },
      { onConflict: "task_id,discipline" },
    );

  if (upsertError) {
    logger.error("setDisciplineEstimate: upsert failed", { error: upsertError });
    return {
      success: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  try {
    revalidatePath("/w", "layout");
  } catch (revalidateError) {
    logger.error("setDisciplineEstimate: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }

  return { success: true };
}

export async function clearDisciplineEstimate(
  taskId: string,
  discipline: string,
): Promise<MutationResult> {
  const parsed = clearDisciplineEstimateSchema.safeParse({ taskId, discipline });

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid estimate.",
    };
  }

  const { user } = await getCurrentUser();

  if (!user) {
    return { success: false, error: "You must be signed in to clear an estimate." };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  const taskInfo = await loadTaskForEstimate(admin, parsed.data.taskId);

  if (!taskInfo) {
    return { success: false, error: "Task not found." };
  }

  const membership = await requireActiveMembership(admin, taskInfo.workspaceId, user.id);

  if (!membership.ok) {
    return {
      success: false,
      error: "You don't have permission to clear an estimate on this task.",
    };
  }

  if (!canWrite({ role: membership.role })) {
    return {
      success: false,
      error: "Viewers don't have permission to clear estimates.",
    };
  }

  const { error: deleteError } = await admin
    .from("task_discipline_estimates")
    .delete()
    .eq("task_id", parsed.data.taskId)
    .eq("discipline", parsed.data.discipline);

  if (deleteError) {
    logger.error("clearDisciplineEstimate: delete failed", { error: deleteError });
    return {
      success: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  try {
    revalidatePath("/w", "layout");
  } catch (revalidateError) {
    logger.error("clearDisciplineEstimate: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }

  return { success: true };
}

export async function setDisciplineEstimatesBulk(
  taskId: string,
  entries: Array<{ discipline: string; input: string; note?: string }>,
): Promise<MutationResult> {
  const parsed = setDisciplineEstimatesBulkSchema.safeParse({ taskId, entries });

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid estimates.",
    };
  }

  // AS-083 / F073: every entry is validated up front -- both the "set"
  // entries (must parse to a positive number of minutes) and the "clear"
  // entries (empty input) -- before a single DB call is made. If any entry
  // is invalid, we return without touching the database at all.
  //
  // F073 (AS-080/081): "clear" entries are folded into the SAME row list as
  // "set" entries (minutes: null instead of a delete). This makes the whole
  // batch a single multi-row upsert() call -- one DB round trip, atomic by
  // Postgres's single-statement guarantee -- instead of a delete() followed
  // by a separate upsert() where a failure between the two could leave
  // permanently-lost data.
  const rows: Array<{ discipline: string; minutes: number | null; note: string | null }> = [];

  for (const entry of parsed.data.entries) {
    const trimmed = entry.input.trim();

    if (!trimmed) {
      rows.push({ discipline: entry.discipline, minutes: null, note: null });
      continue;
    }

    const minutes = parseEstimateInput(trimmed);

    if (minutes === null) {
      return {
        success: false,
        error: 'Invalid format. Use "2h 30m", "90m", or "1.5h".',
      };
    }

    rows.push({
      discipline: entry.discipline,
      minutes,
      note: entry.note ?? null,
    });
  }

  const { user, supabase } = await getCurrentUser();

  if (!user) {
    return { success: false, error: "You must be signed in to set estimates." };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  const taskInfo = await loadTaskForEstimate(admin, parsed.data.taskId);

  if (!taskInfo) {
    return { success: false, error: "Task not found." };
  }

  const membership = await requireActiveMembership(admin, taskInfo.workspaceId, user.id);

  if (!membership.ok) {
    return {
      success: false,
      error: "You don't have permission to set estimates on this task.",
    };
  }

  if (!canWrite({ role: membership.role })) {
    return {
      success: false,
      error: "Viewers don't have permission to set estimates.",
    };
  }

  // F073 (AS-080/081): a single multi-row upsert covering both "set" rows
  // (minutes: number) and "clear" rows (minutes: null). One DB round trip,
  // atomic by Postgres's single-statement INSERT ... ON CONFLICT guarantee
  // -- either every row in the batch lands or none do. Replaces the
  // previous delete() + upsert() pair, which could lose data if the upsert
  // failed after the delete had already succeeded.
  if (rows.length > 0) {
    const { error: upsertError } = await admin.from("task_discipline_estimates").upsert(
      rows.map((row) => ({
        task_id: parsed.data.taskId,
        project_id: taskInfo.projectId,
        discipline: row.discipline,
        minutes: row.minutes,
        note: row.note,
        estimated_by: user.id,
      })),
      { onConflict: "task_id,discipline" },
    );

    if (upsertError) {
      logger.error("setDisciplineEstimatesBulk: upsert failed", { error: upsertError });
      return {
        success: false,
        error: "Something went wrong. Please try again in a moment.",
      };
    }
  }

  // AS-083: one audit log entry for the whole batch, not one per discipline.
  await writeAudit(supabase, {
    workspaceId: taskInfo.workspaceId,
    action: "discipline_estimates.bulk_set",
    targetType: "task",
    targetId: parsed.data.taskId,
    metadata: { projectId: taskInfo.projectId, count: rows.length },
  });

  try {
    revalidatePath("/w", "layout");
  } catch (revalidateError) {
    logger.error("setDisciplineEstimatesBulk: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }

  return { success: true };
}
