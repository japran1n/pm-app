"use server";

// F002 (missions/20260903-portal): project-phase management actions
// (AS-008) and the task<->phase assignment writes (AS-013).
//
// Authorization goes through `withAuthz` (lib/actions/authz.ts, W11) —
// this feature's explicit instruction ("do not hand-roll a role check").
// Every action below uses the DEFAULT `canWrite` gate (role isn't
// `viewer` and isn't `client`) rather than `canManageColumns`
// (lib/auth/permissions.ts's board-column predicate, which would be the
// closest semantic sibling): `canManageColumns` needs `projectRole` to
// grant a project LEAD access beyond a plain "member", but
// `withAuthz`'s `writeCheck` is only ever invoked as
// `writeCheck({ role: membership.role })` (see authz.ts) — `projectRole`
// is never threaded into it. Passing `canManageColumns` as `writeCheck`
// here would silently deny every project lead who isn't also a
// workspace admin/owner, a real regression from what that predicate
// promises. `canWrite` needs only `role`, so it's the correct, exact-fit
// default for this framework — and it already satisfies this feature's
// own Definition of done ("a viewer and a client are rejected by every
// phase mutation action").
//
// project_phases' own RLS (project_phases_insert_team /
// _update_team / _delete_team, 20260909010000) is real defense in depth
// underneath this — `is_project_workspace_writer` excludes exactly
// `viewer` and `client` too, so the two enforcement layers agree.
//
// Writes use `ctx.admin` (the service-role client), matching this file's
// withAuthz-migrated sibling actions in lib/actions/tasks.ts
// (deleteTaskImpl, restoreTaskImpl, promoteSubtaskImpl) — `withAuthz`
// itself is the enforcement boundary, RLS is the backstop. The one
// exception is `seedDefaultPhases`: `seed_default_phases` (F001) is
// SECURITY DEFINER but re-checks the caller's role via `auth.uid()`
// INSIDE its own body, which only resolves through the session-bound
// client (`ctx.supabase`) — calling it via `ctx.admin` (no JWT, no
// `auth.uid()`) would make its own internal check fail. Same
// client-choice rule `writeAudit`'s doc comment documents.
//
// F002b (missions/20260903-portal): `lib/supabase/database.types.ts` has
// been regenerated and now includes `project_phases` and
// `tasks.phase_id`/`page_slug`/`page_order` (it was stale when this file
// was first written under F002 — see that feature's handoff). Every
// `.from("project_phases")`/`tasks.phase_id` access below goes straight
// through `ctx.admin`/`admin` (both `SupabaseClient<Database>`) with no
// cast; the `untyped()` escape hatch F002 added here has been removed.

import { revalidatePath } from "next/cache";

import { logger } from "@/lib/observability/logger";
import { withAuthz, type AuthzExtra } from "@/lib/actions/authz";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { canEditTask, type WorkspaceRole } from "@/lib/auth/permissions";
import type { ProjectVisibility } from "@/lib/actions/project-visibility";
import { writeAudit } from "@/lib/activity/audit";
import {
  createPhaseSchema,
  updatePhaseSchema,
  reorderPhaseSchema,
  deletePhaseSchema,
  seedDefaultPhasesSchema,
  setTaskPhaseSchema,
  bulkSetTaskPhaseSchema,
} from "@/lib/validation/phases";
import {
  getProjectPhaseOptionsForTeam,
  type ProjectPhaseOption,
  type ProjectPhaseState,
} from "@/lib/queries/phases";

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";

type AdminClient = ReturnType<typeof createAdminClient>;

export type PhaseActionData = {
  id: string;
  projectId: string;
  name: string;
  clientDescription: string | null;
  state: ProjectPhaseState;
  plannedStart: string | null;
  plannedEnd: string | null;
  clientVisible: boolean;
  position: number;
};

export type PhaseActionResult =
  | { ok: true; data: PhaseActionData }
  | { ok: false; error: string };

function toPhaseActionData(row: {
  id: string;
  project_id: string;
  name: string;
  client_description: string | null;
  state: string;
  planned_start: string | null;
  planned_end: string | null;
  client_visible: boolean;
  position: number;
}): PhaseActionData {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    clientDescription: row.client_description,
    state: row.state as ProjectPhaseState,
    plannedStart: row.planned_start,
    plannedEnd: row.planned_end,
    clientVisible: row.client_visible,
    position: row.position,
  };
}

async function revalidatePhaseSettings(workspaceSlug: string, projectId: string) {
  try {
    revalidatePath(`/w/${workspaceSlug}/projects/${projectId}/settings/phases`, "page");
    revalidatePath(`/w/${workspaceSlug}/projects/${projectId}/board`, "page");
    revalidatePath(`/w/${workspaceSlug}/projects/${projectId}/list`, "page");
  } catch (revalidateError) {
    // Non-fatal, same convention as lib/actions/statuses.ts's
    // revalidateProjectSettings.
    logger.error("phases: revalidatePath failed (non-fatal)", {
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
      // Top-level `projectId`/`visibility` (not just inside `extra`) are
      // required here: withAuthz's `requireVisibility` option reads
      // `resolved.projectId`/`resolved.visibility` directly off this
      // return value (see lib/actions/authz.ts), not off `extra`.
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

// ---------------------------------------------------------------------
// createPhase
// ---------------------------------------------------------------------

const createPhaseImpl = withAuthz(
  createPhaseSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to manage this project's phases.",
    writeError: "Viewers don't have permission to manage phases.",
    requireVisibility: true,
    visibilityError: "You don't have permission to manage this project's phases.",
    resolveWorkspace: (input, admin) => loadProjectExtra(admin, input.projectId),
  },
  async (input, ctx): Promise<PhaseActionResult> => {
    const phases = ctx.admin.from("project_phases");

    const { data: lastPhase } = await phases
      .select("position")
      .eq("project_id", ctx.projectId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Plain integer append, matching seed_default_phases' own 1..10
    // convention (F001 handoff: "a future phases-reorder feature (F002)
    // can renumber on write") — `project_phases.position` is `integer`,
    // not `double precision`, so there is no fractional-index spacing to
    // preserve here.
    const newPosition = ((lastPhase as { position: number } | null)?.position ?? 0) + 1;

    const { data: inserted, error: insertError } = await ctx.admin
      .from("project_phases")
      .insert({
        project_id: ctx.projectId,
        name: input.name,
        client_description: input.clientDescription ?? null,
        planned_start: input.plannedStart ?? null,
        planned_end: input.plannedEnd ?? null,
        position: newPosition,
      })
      .select(
        "id, project_id, name, client_description, state, planned_start, planned_end, client_visible, position",
      )
      .single();

    if (insertError || !inserted) {
      logger.error("createPhase: insert failed", { error: insertError });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project_phase.created",
      targetType: "project_phase",
      targetId: inserted.id,
      metadata: { projectId: ctx.projectId, name: inserted.name },
    });

    await revalidatePhaseSettings(ctx.workspaceSlug, ctx.projectId);

    return { ok: true, data: toPhaseActionData(inserted) };
  },
);

export async function createPhase(input: {
  projectId: string;
  name: string;
  clientDescription?: string | null;
  plannedStart?: string | null;
  plannedEnd?: string | null;
}): Promise<PhaseActionResult> {
  return createPhaseImpl(input);
}

// ---------------------------------------------------------------------
// updatePhase
// ---------------------------------------------------------------------

type PhaseExtra = ProjectExtra & {
  phaseName: string;
};

async function loadPhaseExtra(
  admin: AdminClient,
  phaseId: string,
): Promise<
  | {
      ok: true;
      workspaceId: string;
      // See loadProjectExtra's comment above: withAuthz's requireVisibility
      // reads this top-level field, not `extra`.
      projectId: string;
      visibility: ProjectVisibility;
      extra: PhaseExtra;
    }
  | { ok: false; error: string }
> {
  const { data, error } = await admin
    .from("project_phases")
    .select(
      "id, project_id, name, projects!inner(id, workspace_id, visibility, deleted_at, workspaces(slug))",
    )
    .eq("id", phaseId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: "Phase not found." };
  }

  const project = Array.isArray(data.projects) ? data.projects[0] : data.projects;
  if (!project?.workspace_id || project.deleted_at) {
    return { ok: false, error: "Phase not found." };
  }

  const workspace = project.workspaces as { slug: string } | { slug: string }[] | null;
  const workspaceSlug = Array.isArray(workspace) ? workspace[0]?.slug : workspace?.slug;
  if (!workspaceSlug) {
    return { ok: false, error: "Phase not found." };
  }

  return {
    ok: true,
    workspaceId: project.workspace_id,
    projectId: project.id,
    visibility: project.visibility === "private" ? "private" : "workspace",
    extra: { projectId: project.id, workspaceSlug, phaseName: data.name },
  };
}

const updatePhaseImpl = withAuthz(
  updatePhaseSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to manage this project's phases.",
    writeError: "Viewers don't have permission to manage phases.",
    requireVisibility: true,
    visibilityError: "You don't have permission to manage this project's phases.",
    resolveWorkspace: (input, admin) => loadPhaseExtra(admin, input.phaseId),
  },
  async (input, ctx): Promise<PhaseActionResult> => {
    const { data: updated, error: updateError } = await ctx.admin
      .from("project_phases")
      .update({
        name: input.name,
        client_description: input.clientDescription,
        state: input.state,
        planned_start: input.plannedStart,
        planned_end: input.plannedEnd,
        client_visible: input.clientVisible,
      })
      .eq("id", input.phaseId)
      .select(
        "id, project_id, name, client_description, state, planned_start, planned_end, client_visible, position",
      )
      .single();

    if (updateError || !updated) {
      logger.error("updatePhase: update failed", { error: updateError });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project_phase.updated",
      targetType: "project_phase",
      targetId: updated.id,
      metadata: {
        projectId: ctx.projectId,
        previousName: ctx.phaseName,
        name: updated.name,
      },
    });

    await revalidatePhaseSettings(ctx.workspaceSlug, ctx.projectId);

    return { ok: true, data: toPhaseActionData(updated) };
  },
);

export async function updatePhase(input: {
  phaseId: string;
  name: string;
  clientDescription: string | null;
  state: "not_started" | "active" | "blocked" | "done";
  plannedStart: string | null;
  plannedEnd: string | null;
  clientVisible: boolean;
}): Promise<PhaseActionResult> {
  return updatePhaseImpl(input);
}

// ---------------------------------------------------------------------
// deletePhase
// ---------------------------------------------------------------------
// Definition of done: "Deleting a phase that has tasks must not delete
// the tasks: phase_id is on delete set null (F001), so the action only
// needs to warn — show how many tasks will be unassigned and require
// confirmation." The count-and-confirm step happens client-side, in
// components/project/phase-list.tsx, from the `taskCount` the settings
// page's own initial fetch (getProjectPhasesForTeam) already carries — no
// second query needed here to reproduce that count; this action's only
// job is the delete itself, which the `phase_id` FK's `on delete set
// null` (20260909010000_portal_foundations.sql) already makes safe by
// construction.

export type DeletePhaseResult = { ok: true; data: { id: string } } | { ok: false; error: string };

const deletePhaseImpl = withAuthz(
  deletePhaseSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to manage this project's phases.",
    writeError: "Viewers don't have permission to manage phases.",
    requireVisibility: true,
    visibilityError: "You don't have permission to manage this project's phases.",
    resolveWorkspace: (input, admin) => loadPhaseExtra(admin, input.phaseId),
  },
  async (input, ctx): Promise<DeletePhaseResult> => {
    const { error: deleteError } = await ctx.admin
      .from("project_phases")
      .delete()
      .eq("id", input.phaseId);

    if (deleteError) {
      logger.error("deletePhase: delete failed", { error: deleteError });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project_phase.deleted",
      targetType: "project_phase",
      targetId: input.phaseId,
      metadata: { projectId: ctx.projectId, name: ctx.phaseName },
    });

    await revalidatePhaseSettings(ctx.workspaceSlug, ctx.projectId);

    return { ok: true, data: { id: input.phaseId } };
  },
);

export async function deletePhase(phaseId: string): Promise<DeletePhaseResult> {
  return deletePhaseImpl({ phaseId });
}

// ---------------------------------------------------------------------
// reorderPhases
// ---------------------------------------------------------------------

export type ReorderPhaseResult =
  | {
      ok: true;
      data: {
        moved: { id: string; position: number };
        swappedWith: { id: string; position: number } | null;
      };
    }
  | { ok: false; error: string };

const reorderPhaseImpl = withAuthz(
  reorderPhaseSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to manage this project's phases.",
    writeError: "Viewers don't have permission to manage phases.",
    requireVisibility: true,
    visibilityError: "You don't have permission to manage this project's phases.",
    resolveWorkspace: (input, admin) => loadPhaseExtra(admin, input.phaseId),
  },
  async (input, ctx): Promise<ReorderPhaseResult> => {
    const { data, error: siblingsError } = await ctx.admin
      .from("project_phases")
      .select("id, position")
      .eq("project_id", ctx.projectId)
      .order("position", { ascending: true });

    const siblings = data as { id: string; position: number }[] | null;

    if (siblingsError || !siblings) {
      logger.error("reorderPhases: failed to load siblings", { error: siblingsError });
      return { ok: false, error: GENERIC_ERROR };
    }

    const index = siblings.findIndex((phase) => phase.id === input.phaseId);
    if (index === -1) {
      return { ok: false, error: "Phase not found." };
    }

    const neighborIndex = input.direction === "up" ? index - 1 : index + 1;
    if (neighborIndex < 0 || neighborIndex >= siblings.length) {
      // Already first/last — nothing to swap, matches reorderColumn's own
      // no-op-when-unchanged short circuit.
      return {
        ok: true,
        data: { moved: siblings[index], swappedWith: null },
      };
    }

    const moved = siblings[index];
    const neighbor = siblings[neighborIndex];

    const [{ error: movedError }, { error: neighborError }] = await Promise.all([
      ctx.admin
        .from("project_phases")
        .update({ position: neighbor.position })
        .eq("id", moved.id),
      ctx.admin
        .from("project_phases")
        .update({ position: moved.position })
        .eq("id", neighbor.id),
    ]);

    if (movedError || neighborError) {
      logger.error("reorderPhases: swap failed", {
        error: movedError ?? neighborError,
      });
      return { ok: false, error: GENERIC_ERROR };
    }

    await revalidatePhaseSettings(ctx.workspaceSlug, ctx.projectId);

    return {
      ok: true,
      data: {
        moved: { id: moved.id, position: neighbor.position },
        swappedWith: { id: neighbor.id, position: moved.position },
      },
    };
  },
);

export async function reorderPhases(
  phaseId: string,
  direction: "up" | "down",
): Promise<ReorderPhaseResult> {
  return reorderPhaseImpl({ phaseId, direction });
}

// ---------------------------------------------------------------------
// seedDefaultPhases
// ---------------------------------------------------------------------

export type SeedDefaultPhasesResult =
  | { ok: true; data: { seeded: boolean } }
  | { ok: false; error: string };

const seedDefaultPhasesImpl = withAuthz(
  seedDefaultPhasesSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to manage this project's phases.",
    writeError: "Viewers don't have permission to manage phases.",
    requireVisibility: true,
    visibilityError: "You don't have permission to manage this project's phases.",
    resolveWorkspace: (input, admin) => loadProjectExtra(admin, input.projectId),
  },
  async (input, ctx): Promise<SeedDefaultPhasesResult> => {
    // Must go through ctx.supabase (session-bound), not ctx.admin — see
    // this file's header comment. seed_default_phases (F001) is itself
    // idempotent (a project that already has any phase is left untouched),
    // so this action does not pre-check "does this project have phases"
    // itself; that duplicate check would just race the RPC's own.
    const { error: rpcError } = await ctx.supabase.rpc("seed_default_phases", {
      p_project_id: ctx.projectId,
    });

    if (rpcError) {
      logger.error("seedDefaultPhases: rpc failed", { error: rpcError });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project_phase.seeded_defaults",
      targetType: "project",
      targetId: ctx.projectId,
      metadata: { projectId: ctx.projectId },
    });

    await revalidatePhaseSettings(ctx.workspaceSlug, ctx.projectId);

    return { ok: true, data: { seeded: true } };
  },
);

export async function seedDefaultPhases(
  projectId: string,
): Promise<SeedDefaultPhasesResult> {
  return seedDefaultPhasesImpl({ projectId });
}

// ---------------------------------------------------------------------
// getProjectPhaseOptions — read path for the task detail sheet / new
// task dialog / bulk action bar pickers (AS-013). A Server Action (not a
// Server Component prop) so those three Client Components can each fetch
// it on demand without every one of their many Server Component callers
// (board/page.tsx, list/page.tsx, t/[taskKey]/page.tsx, board.tsx,
// task-list-table.tsx, ...) having to be individually threaded with a new
// `phases` prop — mirrors task-detail-sheet.tsx's own existing
// `getMentionCandidates` call (lib/actions/comments.ts), called directly
// from a Client Component's `useEffect`, per that file's own doc comment
// ("Server Actions are safe to import and call from a Client Component").
// ---------------------------------------------------------------------

export type GetProjectPhaseOptionsResult =
  | { ok: true; data: { phases: ProjectPhaseOption[] } }
  | { ok: false; error: string };

const getProjectPhaseOptionsImpl = withAuthz(
  createPhaseSchema.pick({ projectId: true }),
  {
    // Read-only: no requireWrite. Any active member (including a viewer)
    // may see the phase list to know what a task is currently in.
    requireVisibility: true,
    resolveWorkspace: (input, admin) => loadProjectExtra(admin, input.projectId),
  },
  async (_input, ctx): Promise<GetProjectPhaseOptionsResult> => {
    const phases = await getProjectPhaseOptionsForTeam(ctx.projectId);
    return { ok: true, data: { phases } };
  },
);

export async function getProjectPhaseOptions(
  projectId: string,
): Promise<GetProjectPhaseOptionsResult> {
  return getProjectPhaseOptionsImpl({ projectId });
}

// ---------------------------------------------------------------------
// setTaskPhase — AS-013: assign (or clear) a single task's phase.
// ---------------------------------------------------------------------

type TaskPhaseExtra = AuthzExtra & {
  currentPhaseId: string | null;
};

export type SetTaskPhaseResult =
  | { ok: true; data: { id: string; phaseId: string | null } }
  | { ok: false; error: string };

const setTaskPhaseImpl = withAuthz(
  setTaskPhaseSchema,
  {
    requireWrite: true,
    writeCheck: canEditTask,
    membershipError: "You don't have permission to edit this task.",
    writeError: "Viewers don't have permission to edit tasks.",
    requireVisibility: true,
    visibilityError: "Viewers don't have permission to edit tasks.",
    resolveWorkspace: async (input, admin) => {
      const { data: taskRow, error } = await admin
        .from("tasks")
        .select(
          "id, phase_id, deleted_at, projects!inner(id, workspace_id, visibility)",
        )
        .eq("id", input.taskId)
        .is("deleted_at", null)
        .maybeSingle();

      if (error || !taskRow) return { ok: false, error: "Task not found." };

      const project = Array.isArray(taskRow.projects)
        ? taskRow.projects[0]
        : taskRow.projects;
      if (!project?.workspace_id) return { ok: false, error: "Task not found." };

      // Cross-project safety (mirrors removeColumnWithReassignment's own
      // destination-project check, lib/actions/statuses.ts): a phase id
      // supplied for a DIFFERENT project than this task's own must be
      // rejected, not silently accepted.
      if (input.phaseId) {
        const { data: phaseRow } = await admin
          .from("project_phases")
          .select("id, project_id")
          .eq("id", input.phaseId)
          .maybeSingle();
        if (!phaseRow || phaseRow.project_id !== project.id) {
          return { ok: false, error: "That phase does not belong to this task's project." };
        }
      }

      return {
        ok: true,
        workspaceId: project.workspace_id,
        projectId: project.id,
        visibility: (project.visibility as ProjectVisibility) ?? "workspace",
        extra: { currentPhaseId: taskRow.phase_id as string | null } satisfies TaskPhaseExtra,
      };
    },
  },
  async (input, ctx): Promise<SetTaskPhaseResult> => {
    if (input.phaseId === ctx.currentPhaseId) {
      return { ok: true, data: { id: input.taskId, phaseId: ctx.currentPhaseId } };
    }

    const { data: updated, error: updateError } = await ctx.admin
      .from("tasks")
      .update({ phase_id: input.phaseId })
      .eq("id", input.taskId)
      .select("id, phase_id")
      .single();

    if (updateError || !updated) {
      logger.error("setTaskPhase: update failed", { error: updateError });
      return { ok: false, error: GENERIC_ERROR };
    }

    return { ok: true, data: { id: updated.id, phaseId: updated.phase_id } };
  },
);

export async function setTaskPhase(
  taskId: string,
  phaseId: string | null,
): Promise<SetTaskPhaseResult> {
  return setTaskPhaseImpl({ taskId, phaseId });
}

// ---------------------------------------------------------------------
// bulkSetTaskPhase — "Move to phase" bulk action
// (components/task/bulk-action-bar.tsx), mirroring bulkUpdateTasks'
// (lib/actions/tasks.ts) partial-success shape: a task the caller can't
// edit is reported in `failedIds` rather than failing the whole batch.
// ---------------------------------------------------------------------

export type BulkSetTaskPhaseResult =
  | {
      ok: true;
      data: {
        succeededIds: string[];
        failedIds: { id: string; reason: string }[];
      };
    }
  | { ok: false; error: string };

export async function bulkSetTaskPhase(
  taskIds: string[],
  phaseId: string | null,
): Promise<BulkSetTaskPhaseResult> {
  const parsed = bulkSetTaskPhaseSchema.safeParse({ taskIds, phaseId });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  // This action touches many tasks that may not all share one project
  // (the list view IS project-scoped in this app today, but nothing here
  // assumes that), so it is deliberately NOT built on `withAuthz` (which
  // resolves exactly one workspace/project per call) — same reasoning
  // `bulkUpdateTasks` (lib/actions/tasks.ts) documents for its own
  // per-task auth loop.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to update tasks." };
  }

  const admin = createAdminClient();

  const { data: taskRows } = await admin
    .from("tasks")
    .select("id, phase_id, deleted_at, projects!inner(id, workspace_id, visibility)")
    .in("id", parsed.data.taskIds)
    .is("deleted_at", null);

  type TaskRow = {
    id: string;
    projects:
      | { id: string; workspace_id: string; visibility: ProjectVisibility }
      | { id: string; workspace_id: string; visibility: ProjectVisibility }[];
  };
  const rows = (taskRows ?? []) as TaskRow[];

  type Context = { workspaceId: string; projectId: string; visibility: ProjectVisibility };
  const contexts = new Map<string, Context>();
  for (const row of rows) {
    const project = Array.isArray(row.projects) ? row.projects[0] : row.projects;
    if (!project?.workspace_id) continue;
    contexts.set(row.id, {
      workspaceId: project.workspace_id,
      projectId: project.id,
      visibility: project.visibility ?? "workspace",
    });
  }

  const failedIds: { id: string; reason: string }[] = [];
  for (const id of parsed.data.taskIds) {
    if (!contexts.has(id)) failedIds.push({ id, reason: "Task not found." });
  }

  const distinctWorkspaceIds = new Set([...contexts.values()].map((c) => c.workspaceId));
  const roleByWorkspace = new Map<string, WorkspaceRole>();
  for (const workspaceId of distinctWorkspaceIds) {
    const membership = await requireActiveMembership(admin, workspaceId, user.id);
    if (membership.ok) roleByWorkspace.set(workspaceId, membership.role);
  }

  // Every phaseId supplied must belong to the SAME project as the task it
  // is being applied to — checked once per distinct project touched by
  // this call, not per task.
  let phaseProjectId: string | null | undefined;
  if (parsed.data.phaseId) {
    const { data: phaseRow } = await admin
      .from("project_phases")
      .select("project_id")
      .eq("id", parsed.data.phaseId)
      .maybeSingle();
    phaseProjectId = (phaseRow as { project_id: string } | null)?.project_id ?? null;
  }

  // Private-project visibility (mirrors bulkUpdateTasks'
  // lib/actions/tasks.ts:3994-4012 rule, re-applied here): only needed
  // for tasks whose project is actually private — one extra query
  // covering every such project in this call, not one per task. Without
  // this, a workspace member who is a member of the workspace but NOT of
  // a private project's `project_members` could write `phase_id` on that
  // project's tasks through this admin-client bulk path even though
  // `setTaskPhase` (via `requireVisibility`) rejects the identical call.
  const privateProjectIds = new Set(
    [...contexts.values()].filter((c) => c.visibility === "private").map((c) => c.projectId),
  );
  const explicitMemberProjectIds = new Set<string>();
  if (privateProjectIds.size > 0) {
    const { data: memberRows } = await admin
      .from("project_members")
      .select("project_id")
      .in("project_id", [...privateProjectIds])
      .eq("user_id", user.id);
    for (const row of memberRows ?? []) {
      explicitMemberProjectIds.add(row.project_id as string);
    }
  }

  const allowedIds: string[] = [];
  for (const [id, context] of contexts) {
    const role = roleByWorkspace.get(context.workspaceId);
    if (!role) {
      failedIds.push({ id, reason: "You are not a member of this workspace." });
      continue;
    }
    if (!canEditTask({ role })) {
      failedIds.push({ id, reason: "You don't have permission to edit this task." });
      continue;
    }
    if (
      context.visibility === "private" &&
      role !== "owner" &&
      role !== "admin" &&
      !explicitMemberProjectIds.has(context.projectId)
    ) {
      failedIds.push({ id, reason: "You don't have access to this task's project." });
      continue;
    }
    if (
      parsed.data.phaseId &&
      (!phaseProjectId || phaseProjectId !== context.projectId)
    ) {
      failedIds.push({ id, reason: "That phase does not belong to this task's project." });
      continue;
    }
    allowedIds.push(id);
  }

  if (allowedIds.length === 0) {
    return { ok: true, data: { succeededIds: [], failedIds } };
  }

  const { error: updateError } = await admin
    .from("tasks")
    .update({ phase_id: parsed.data.phaseId })
    .in("id", allowedIds);

  if (updateError) {
    logger.error("bulkSetTaskPhase: update failed", { error: updateError });
    return { ok: false, error: GENERIC_ERROR };
  }

  return { ok: true, data: { succeededIds: allowedIds, failedIds } };
}
