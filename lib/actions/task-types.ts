"use server";
import { logger } from "@/lib/observability/logger";


// F434-F440: workspace-owned task types (Setup/Design/Dev/SEO/QA/Add-on),
// and setting one on a task.
//
// Management actions (create/rename/recolor/delete/reorder) mirror
// lib/actions/status-templates.ts exactly: RLS-respecting client for the
// actual write (RLS is the real boundary — task_types_write_admins),
// admin client only for read-only lookups that need real data regardless
// of the caller's own visibility, requireWorkspaceAdmin re-checked
// server-side on top of RLS (AS-230's "DB is the last line, not the only
// line" convention).
//
// setTaskType reuses the exact task-edit gate every other per-task field
// mutation in lib/actions/tasks.ts uses (requireActiveMembership +
// canEditTask) — assigning a task type is an edit like any other field,
// not a workspace-taxonomy-management action.

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireActiveMembership, requireWorkspaceAdmin } from "@/lib/auth/require-membership";
import { canEditTask } from "@/lib/auth/permissions";
import {
  createTaskTypeSchema,
  updateTaskTypeSchema,
  deleteTaskTypeSchema,
  reorderTaskTypeSchema,
  setTaskTypeSchema,
} from "@/lib/validation/task-types";

const PERMISSION_DENIED_ERROR = "You don't have permission to manage task types.";
const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";

export type TaskTypeActionResult = { ok: true } | { ok: false; error: string };

async function currentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function createTaskType(input: unknown): Promise<TaskTypeActionResult> {
  const parsed = createTaskTypeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  }

  const userId = await currentUserId();
  if (!userId) return { ok: false, error: PERMISSION_DENIED_ERROR };

  const admin = createAdminClient();
  const membership = await requireWorkspaceAdmin(admin, parsed.data.workspaceId, userId);
  if (!membership.ok) return { ok: false, error: PERMISSION_DENIED_ERROR };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("task_types")
    .select("position")
    .eq("workspace_id", parsed.data.workspaceId)
    .order("position", { ascending: false })
    .limit(1);
  const nextPosition = (existing?.[0]?.position ?? 0) + 1000;

  const { error } = await supabase.from("task_types").insert({
    workspace_id: parsed.data.workspaceId,
    name: parsed.data.name,
    color: parsed.data.color,
    position: nextPosition,
  });

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "A task type with that name already exists." };
    }
    logger.error("createTaskType failed", { error: error });
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath("/w/[workspaceSlug]/settings", "page");
  return { ok: true };
}

async function requireTaskTypeAdmin(taskTypeId: string) {
  const userId = await currentUserId();
  if (!userId) return { ok: false as const };

  const admin = createAdminClient();
  const { data: taskType } = await admin
    .from("task_types")
    .select("workspace_id")
    .eq("id", taskTypeId)
    .maybeSingle();
  if (!taskType) return { ok: false as const };

  const membership = await requireWorkspaceAdmin(admin, taskType.workspace_id, userId);
  if (!membership.ok) return { ok: false as const };

  return { ok: true as const };
}

export async function updateTaskType(input: unknown): Promise<TaskTypeActionResult> {
  const parsed = updateTaskTypeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  }

  const auth = await requireTaskTypeAdmin(parsed.data.taskTypeId);
  if (!auth.ok) return { ok: false, error: PERMISSION_DENIED_ERROR };

  const patch: { name?: string; color?: string; system_key?: string | null } = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.color !== undefined) patch.color = parsed.data.color;
  // F006c (missions/20260903-portal, AS-014): the write path `system_key`
  // never had — a team can now tag a type as the portal's page type (or
  // clear that tag) from this same settings screen, instead of only ever
  // being set by SQL or the create_workspace_with_owner seed.
  if (parsed.data.systemKey !== undefined) patch.system_key = parsed.data.systemKey;

  const supabase = await createClient();
  const { error } = await supabase
    .from("task_types")
    .update(patch)
    .eq("id", parsed.data.taskTypeId);

  if (error) {
    if (error.code === "23505") {
      // F006c: the partial unique index
      // (task_types_workspace_id_system_key_idx) is what actually
      // enforces "at most one type per portal role per workspace" — this
      // turns that raw constraint violation into the same plain-language
      // message the pre-existing name-uniqueness branch above already
      // gives, rather than surfacing a Postgres error string to the
      // team member setting the tag.
      return parsed.data.systemKey !== undefined
        ? {
            ok: false,
            error:
              "Another task type is already tagged as the portal's page type. Remove that tag from the other type first.",
          }
        : { ok: false, error: "A task type with that name already exists." };
    }
    // F116: task_types_lock_system_flags_trigger rejects any change to
    // is_billable, or to system_key on one of the five business keys
    // this feature seeds (delivery/qa/client_request/change_request/
    // improvement) — 'page' is exempt (F006c's own affordance).
    if (error.code === "42501") {
      return {
        ok: false,
        error: "This is a fixed system task type — that field can't be changed.",
      };
    }
    logger.error("updateTaskType failed", { error: error });
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath("/w/[workspaceSlug]/settings", "page");
  return { ok: true };
}

export async function deleteTaskType(input: unknown): Promise<TaskTypeActionResult> {
  const parsed = deleteTaskTypeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  }

  const auth = await requireTaskTypeAdmin(parsed.data.taskTypeId);
  if (!auth.ok) return { ok: false, error: PERMISSION_DENIED_ERROR };

  // AS-579 (docs/plan-daily-work-followups.md) originally relied on `on
  // delete set null` here so an in-use type could be deleted for free.
  // F116 made `tasks.task_type_id` required (AS-058), which the FK's own
  // `on delete restrict` (20261104010000/20261104030000_f116_task_type_
  // taxonomy.sql) now enforces: a type still assigned to any task cannot
  // be deleted until those tasks are re-typed, rather than silently
  // leaving one typeless.
  const supabase = await createClient();
  const { error } = await supabase.from("task_types").delete().eq("id", parsed.data.taskTypeId);

  if (error) {
    if (error.code === "23503") {
      return {
        ok: false,
        error: "This task type is still used by at least one task. Re-type those tasks first.",
      };
    }
    logger.error("deleteTaskType failed", { error: error });
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath("/w/[workspaceSlug]/settings", "page");
  return { ok: true };
}

export async function reorderTaskType(input: unknown): Promise<TaskTypeActionResult> {
  const parsed = reorderTaskTypeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  }

  const auth = await requireTaskTypeAdmin(parsed.data.taskTypeId);
  if (!auth.ok) return { ok: false, error: PERMISSION_DENIED_ERROR };

  const supabase = await createClient();
  const { error } = await supabase
    .from("task_types")
    .update({ position: parsed.data.newPosition })
    .eq("id", parsed.data.taskTypeId);

  if (error) {
    logger.error("reorderTaskType failed", { error: error });
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath("/w/[workspaceSlug]/settings", "page");
  return { ok: true };
}

// Assigning a task type to a task: same gate every other per-task field
// edit in lib/actions/tasks.ts uses (any active non-viewer/guest role may
// edit any task, AS-061) — not a taxonomy-management action, so
// requireWorkspaceAdmin does NOT apply here.
export async function setTaskType(input: unknown): Promise<TaskTypeActionResult> {
  const parsed = setTaskTypeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  }

  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "You must be signed in to edit this task." };

  const admin = createAdminClient();
  const { data: taskRow } = await admin
    .from("tasks")
    .select("id, deleted_at, projects!inner(workspace_id)")
    .eq("id", parsed.data.taskId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!taskRow) return { ok: false, error: "Task not found." };

  const project = Array.isArray(taskRow.projects) ? taskRow.projects[0] : taskRow.projects;
  const workspaceId = project?.workspace_id;
  if (!workspaceId) return { ok: false, error: "Task not found." };

  const membership = await requireActiveMembership(admin, workspaceId, userId);
  if (!membership.ok) {
    return { ok: false, error: "You don't have permission to edit this task." };
  }
  if (!canEditTask({ role: membership.role })) {
    return { ok: false, error: "You don't have permission to edit this task." };
  }

  // The chosen task type must belong to THIS task's own workspace —
  // otherwise a caller could tag a task with another workspace's
  // taxonomy row (harmless data-wise since it's just a label, but still
  // a cross-tenant reference this action should refuse outright rather
  // than silently allow).
  const { data: taskType } = await admin
    .from("task_types")
    .select("workspace_id")
    .eq("id", parsed.data.taskTypeId)
    .maybeSingle();
  if (!taskType || taskType.workspace_id !== workspaceId) {
    return { ok: false, error: "Task type not found." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("tasks")
    .update({ task_type_id: parsed.data.taskTypeId })
    .eq("id", parsed.data.taskId);

  if (error) {
    logger.error("setTaskType failed", { error: error });
    return { ok: false, error: GENERIC_ERROR };
  }

  return { ok: true };
}
