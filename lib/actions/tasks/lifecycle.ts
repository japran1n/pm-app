"use server";

import { revalidatePath } from "next/cache";
import {
  deleteTaskSchema,
  restoreTaskSchema,
  promoteSubtaskSchema,
} from "@/lib/validation/tasks";
import { logger } from "@/lib/observability/logger";
import { withAuthz } from "@/lib/actions/authz";
import { type ProjectVisibility } from "@/lib/actions/project-visibility";
import { writeTaskFieldChanges } from "@/lib/activity/task-activity";
import { revalidatePortalProject } from "@/lib/actions/portal-revalidate";

export type DeleteTaskResult =
  | {
      ok: true;
      data: {
        id: string;
        deletedAt: string;
      };
    }
  | { ok: false; error: string };

// Soft-deletes a task (F038: AS-055, AS-056, AS-057; F149: AS-267 —
// cascades to children). Pattern mirrors editTask/assignTask above:
// Zod-validated input, membership re-checked server-side (defense in
// depth, AS-143), admin client used for the actual update, discriminated
// union return, generic user-facing errors with details only logged
// server-side (AS-146).
//
// AS-055: any active workspace member may delete a task, matching the same
// "no per-task ownership restriction, only workspace membership" model
// already established for editTask (AS-061) and assignTask.
//
// This is a soft delete only — sets `deleted_at = now()`, never issues a
// real DELETE. Deleting is therefore an UPDATE under RLS
// (supabase/migrations/20260818013805_rls_tasks.sql), consistent with that
// migration's comment that tasks have no DELETE policy at all and use
// soft-delete exclusively.
//
// AS-056: the tasks_select_active_members RLS policy already filters
// `deleted_at is null` (confirmed by reading the F034 migration directly,
// not assumed), so the instant this row's deleted_at is set, every
// existing SELECT-based view (board, list, search, dashboard) stops
// returning it — no separate "hide from views" logic is needed here
// beyond setting the column.
//
// AS-057: comments/attachments tables don't exist yet (M6 — F058
// comments, F064 attachments land later) — there is nothing to
// individually orphan-hide today. This is a structural deferral, not a
// gap: once those tables land, their own RLS will be scoped through the
// (now-deleted) task, and a deleted task's children won't be
// independently browsable without going through the task itself, which is
// already gone from every view per AS-056. No code path here needs to
// pre-emptively guard tables that don't exist.
//
// AS-267 (F149): if this task has live (one-level) children — F148's
// `tasks.parent_task_id` — they must be soft-deleted too, in the SAME
// transaction as the parent, so a crash or partial failure can never
// leave orphaned children still visible on the board while their parent
// is gone. Two independent `.update()` calls (parent, then children)
// would be two separate network round trips with no shared transaction,
// so this delegates the whole thing to the `cascade_delete_task` Postgres
// RPC (supabase/migrations/20260819071821_subtask_cascade_delete.sql), a
// single SECURITY DEFINER PL/pgSQL function body — atomic by
// construction. That RPC also stamps cascaded children's
// `deleted_via_task_id`, the provenance F189's future restore feature
// needs to reverse exactly this cascade without resurrecting a child that
// was already deleted independently beforehand. This function works
// identically whether `taskId` is a top-level task with children (cascade
// fires), a childless task (the RPC's second UPDATE matches zero rows,
// a harmless no-op), or a child task itself (children can't have their
// own children per F148, so the cascade branch is always a no-op there
// too) — no branching needed here on which kind of task this is.
// W11 (mission 20260828-hardening): migrated onto withAuthz — see
// lib/actions/authz.ts's doc comment for the pipeline this now runs
// (Zod -> getUser -> admin client -> resolveWorkspace -> membership ->
// canWrite -> isProjectVisibleToCaller) in place of the hand-written
// preamble every sibling action in this file still carries.
const deleteTaskImpl = withAuthz(
  deleteTaskSchema,
  {
    requireWrite: true,
    // AS-055: any role, no per-task ownership check — mirrors editTask's
    // membership check exactly. Deliberately `canWrite` (withAuthz's
    // default), not `canDeleteTask` — canDeleteTask additionally scopes
    // plain members to their own creations, which would regress AS-055.
    membershipError: "You don't have permission to delete this task.",
    writeError: "Viewers don't have permission to delete tasks.",
    requireVisibility: true,
    visibilityError: "Viewers don't have permission to delete tasks.",
    // Look up the task's owning workspace (via its project) so membership
    // is checked against the real workspace, never one supplied by the
    // caller. An already-deleted task behaves as "not found", same
    // convention as assignTask/editTask's task lookup — this also makes
    // deleteTask naturally idempotent-safe (a second delete call just
    // reports "not found" rather than re-touching the row).
    resolveWorkspace: async (input, admin) => {
      const { data: taskRow, error } = await admin
        .from("tasks")
        .select(
          "id, deleted_at, client_visible, projects!inner(id, workspace_id, visibility)",
        )
        .eq("id", input.taskId)
        .is("deleted_at", null)
        .maybeSingle();

      if (error || !taskRow) return { ok: false, error: "Task not found." };

      const project = Array.isArray(taskRow.projects)
        ? taskRow.projects[0]
        : taskRow.projects;

      if (!project?.workspace_id) return { ok: false, error: "Task not found." };

      return {
        ok: true,
        workspaceId: project.workspace_id,
        projectId: project.id,
        visibility: (project.visibility as ProjectVisibility) ?? "workspace",
        extra: { clientVisible: Boolean(taskRow.client_visible) },
      };
    },
  },
  async (input, ctx): Promise<DeleteTaskResult> => {
    // AS-267: single atomic RPC call — soft-deletes this task AND cascades
    // to any live children in one transaction (see doc comment above).
    // F188/AS-347: `p_deleted_by` is stamped inside the same RPC call (see
    // 20260822210000_cascade_delete_task_deleted_by.sql's doc comment) so
    // the trash view can show who deleted this task without a second write.
    const { data: cascadeRows, error: deleteError } = await ctx.admin.rpc(
      "cascade_delete_task",
      { p_task_id: input.taskId, p_deleted_by: ctx.user.id },
    );

    const deleted = cascadeRows?.[0];

    if (deleteError || !deleted || !deleted.deleted_at) {
      logger.error("deleteTask: cascade_delete_task failed", { error: deleteError });
      return {
        ok: false,
        error: "Something went wrong. Please try again in a moment.",
      };
    }

    const { data: workspaceRow } = await ctx.admin
      .from("workspaces")
      .select("slug")
      .eq("id", ctx.workspaceId)
      .maybeSingle();

    if (workspaceRow?.slug) {
      try {
        revalidatePath(`/w/${workspaceRow.slug}`, "layout");
      } catch (revalidateError) {
        // Non-fatal cache-freshness rationale, same as createTask above.
        logger.error("deleteTask: revalidatePath failed (non-fatal)", { error: revalidateError });
      }

      // AS-006 scrutiny remediation: a client-visible task disappearing
      // from the team side must also disappear from the portal. Gated on
      // `client_visible` (loaded above with no extra round trip) so a
      // non-shared task's delete never touches the portal path.
      if (ctx.clientVisible) {
        revalidatePortalProject(workspaceRow.slug, ctx.projectId!);
      }
    }

    return {
      ok: true,
      data: {
        id: deleted.id,
        deletedAt: deleted.deleted_at,
      },
    };
  },
);

export async function deleteTask(taskId: string): Promise<DeleteTaskResult> {
  return deleteTaskImpl({ taskId });
}

export type RestoreTaskResult =
  | {
      ok: true;
      data: {
        id: string;
        projectId: string;
        status: string;
        position: number;
        // AS-344's "status no longer exists" fallback edge case (see this
        // function's doc comment): true only when the task's recorded
        // status somehow wasn't a valid column and had to be reset to the
        // project's first not-started column, so the caller can surface a
        // "status was reset" notice. Always false today (status is a
        // fixed DB CHECK-constrained enum — see moveTaskStatusSchema —
        // this branch has no reachable trigger until a future
        // caller-defined-columns feature, F218, lands), but the field
        // exists so the UI never has to guess.
        statusWasReset: boolean;
      };
    }
  | { ok: false; error: string };

// Restores a soft-deleted task (F189: AS-344, AS-351). Pattern mirrors
// deleteTask/editTask above: Zod-validated input, membership re-checked
// server-side (defense in depth, AS-143), admin client used for the
// actual update, discriminated union return, generic user-facing errors
// with details only logged server-side (AS-146).
//
// AS-344: a restored task returns to its ORIGINAL project (project_id is
// never changed by this action — there is no field for it, same "no
// field to carry a destination" convention editTask's AS-060 doc comment
// already established) and its original status. Position is the one
// field that is NOT restored verbatim: this feature's own worker brief
// explicitly calls out that the task's old position may now collide with
// other tasks' positions since time has passed (new tasks may have been
// created or reordered into that same slot while this task sat deleted),
// so a brand-new valid position is computed here via
// lib/board/position.ts's calculatePosition, appended to the END of the
// task's (project, status) column — the exact same "append to the end"
// convention createTask already uses for a newly created task (see that
// function's own position doc comment above) — never the stale value
// read back from the row.
//
// Status fallback (per this feature's Files/Clarified implementation,
// "if the task's original status no longer exists, fall back to the
// project's first not-started column and say so"): `status` is a fixed,
// DB CHECK-constrained enum today (tasks_status_check,
// supabase/migrations/20260818013434_create_tasks.sql) — every row's
// `status` is therefore ALWAYS one of the four known values, so this
// fallback branch can never actually trigger yet (caller-defined board
// columns are a later feature, F218, not built). The fallback is still
// implemented per the spec's explicit instruction (defensive, and ready
// the day F218 lands): any status value that isn't one of the four known
// columns falls back to "todo" (the fixed set's first not-started
// column), and `statusWasReset: true` is returned so the caller can show
// a toast.
//
// AS-351: restoring into an ARCHIVED project (an archived project is
// simply a project with `deleted_at` set — F142/AS-249 reuses the same
// soft-delete column rather than a second, parallel "archived" flag, per
// that feature's own migration doc comment) must NOT un-archive the
// project. This function never reads OR writes any column on `projects`
// other than looking up `workspace_id` (for the membership check) and
// `deleted_at` is deliberately never part of that lookup's select list,
// and never appears anywhere in this function's write path — there is no
// code here that could touch `projects.deleted_at` even by accident. A
// task inside an archived project restores exactly like a task in any
// other project; it simply becomes visible again inside that (still
// archived) project's own task list, the same way any other live task in
// an archived project already behaves — archiving a project does not
// itself hide its own tasks from that project's own board (only from
// cross-project aggregates, per AS-129/AS-174's `p.deleted_at is null`
// exclusions), so a restored task inside an archived project is
// consistent with every other task already sitting in that project.
//
// Cascade restore (reverses F149's `cascade_delete_task` RPC precisely,
// per this feature's own instruction): a task cascade-deleted alongside
// ITS parent (F149's single-task `deleteTask` path — see that function's
// doc comment) has `deleted_via_task_id` stamped to the parent's id. When
// the parent is restored here, every still-deleted child whose
// `deleted_via_task_id` equals this task's id is restored too, each
// getting its own fresh end-of-column position in ITS OWN (project,
// status) column — a child's status is untouched by its parent's
// restore, it simply becomes visible again in whichever column it was
// in. This is deliberately NOT the same as F187's bulk-delete cascade:
// children soft-deleted as a side effect of `bulkDeleteTasks` never had
// `deleted_via_task_id` stamped in the first place (F187's own documented
// gap, restated in F188's handoff) — this function has no way to
// distinguish those from an independently-deleted child and does not try
// to; only rows whose `deleted_via_task_id` correctly points back to
// THIS task are restored. A task with no cascade-deleted children is
// unaffected by this step (the children query simply returns zero rows).
//
// Zero-state: a task that is not currently soft-deleted (already restored,
// or never deleted) behaves as "not found" here, mirroring every other
// action in this file's "deleted_at is null means not found for a
// delete-scoped lookup" convention, inverted for a restore-scoped lookup
// (`deleted_at is NOT null` required).
// W11: migrated onto withAuthz — see deleteTaskImpl above and
// lib/actions/authz.ts's doc comment.
const restoreTaskImpl = withAuthz(
  restoreTaskSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to restore this task.",
    writeError: "Viewers don't have permission to restore tasks.",
    requireVisibility: true,
    visibilityError: "Viewers don't have permission to restore tasks.",
    // Only a currently soft-deleted task is eligible — a live (never-
    // deleted or already-restored) task behaves as "not found", the
    // inverse of deleteTask's own lookup convention. AS-351:
    // `projects.deleted_at` is deliberately not selected here — this
    // function has no reason to branch on whether the project is
    // archived, and selecting it would invite a future edit to
    // accidentally start writing it.
    resolveWorkspace: async (input, admin) => {
      const { data: taskRow, error } = await admin
        .from("tasks")
        .select(
          "id, project_id, status, deleted_at, deleted_via_task_id, client_visible, projects!inner(id, workspace_id, visibility)",
        )
        .eq("id", input.taskId)
        .not("deleted_at", "is", null)
        .maybeSingle();

      if (error || !taskRow) return { ok: false, error: "Task not found." };

      const project = Array.isArray(taskRow.projects)
        ? taskRow.projects[0]
        : taskRow.projects;

      if (!project?.workspace_id) return { ok: false, error: "Task not found." };

      return {
        ok: true,
        workspaceId: project.workspace_id,
        projectId: project.id,
        visibility: (project.visibility as ProjectVisibility) ?? "workspace",
        extra: { clientVisible: Boolean(taskRow.client_visible) },
      };
    },
  },
  async (input, ctx): Promise<RestoreTaskResult> => {
    // Restore atomically: the parent's own update and the cascade restore
    // of its still-deleted children (see this function's doc comment)
    // happen in a single transaction via RPC, so a mid-sequence failure
    // can never leave a child still marked deleted under a now-restored,
    // live-looking parent.
    const { data: restoreRows, error: updateError } = await ctx.admin.rpc(
      "restore_task_atomic",
      { p_task_id: input.taskId },
    );

    const updated = restoreRows?.[0];

    if (updateError || !updated) {
      logger.error("restoreTask: update failed", { error: updateError });
      return {
        ok: false,
        error: "Something went wrong. Please try again in a moment.",
      };
    }

    const statusWasReset = updated.status_was_reset;

    // F306 (D9/FU-3 scrutiny fix, AS-353, AS-355): record the restore in
    // the task's activity feed. There is no dedicated "restored" kind in
    // F194's closed task_activity_kind vocabulary ('field_changed',
    // 'comment_added', 'comment_deleted') and no migration is in this
    // feature's Files scope (lib/actions/tasks.ts only), so this follows
    // the exact precedent
    // supabase/migrations/20260822231000_recurrence_scheduled_generation_
    // activity.sql's own doc comment sets for "no dedicated kind exists":
    // 'field_changed' on the closest-fitting real field. `status` is the
    // closest fit here — a restored task always ends up with a concrete,
    // visible status again, `p_old_value := null` (there was no visible
    // status while soft-deleted/in trash) and `p_new_value :=
    // resolvedStatus`. This is deliberately activity-only, NOT a watcher/
    // assignee notification — per this feature's own scoping note,
    // restoring a task from trash is not treated as a fan-out-worthy event
    // the way a live status/assignee change is; see the handoff's
    // Decisions Made. Non-fatal, same convention as every other post-write
    // activity write in this file.
    try {
      // diffTaskFields skips a key absent from `before` (no prior value to
      // diff against) — restore's "before" is genuinely absent (the task
      // had no visible status while in trash), so the change is built
      // directly here rather than through diffTaskFields's "both present"
      // comparison, matching the SQL-side precedent's own `p_old_value :=
      // null` choice referenced above.
      await writeTaskFieldChanges(ctx.supabase, input.taskId, [
        { field: "status", oldValue: null, newValue: updated.status },
      ]);
    } catch (activityError) {
      logger.error("restoreTask: writeTaskFieldChanges failed (non-fatal)", { error: activityError });
    }

    const { data: workspaceRow } = await ctx.admin
      .from("workspaces")
      .select("slug")
      .eq("id", ctx.workspaceId)
      .maybeSingle();

    if (workspaceRow?.slug) {
      try {
        revalidatePath(`/w/${workspaceRow.slug}`, "layout");
        revalidatePath(`/w/${workspaceRow.slug}/trash`);
      } catch (revalidateError) {
        // Non-fatal cache-freshness rationale, same as createTask above.
        logger.error("restoreTask: revalidatePath failed (non-fatal)", { error: revalidateError });
      }

      // AS-006 scrutiny remediation: a client-visible task reappearing on
      // the team side must also reappear on the portal. Gated on
      // `client_visible` (loaded above with no extra round trip).
      if (ctx.clientVisible) {
        revalidatePortalProject(workspaceRow.slug, ctx.projectId!);
      }
    }

    return {
      ok: true,
      data: {
        id: updated.id,
        projectId: updated.project_id,
        status: updated.status,
        position: updated.position,
        statusWasReset,
      },
    };
  },
);

export async function restoreTask(taskId: string): Promise<RestoreTaskResult> {
  return restoreTaskImpl({ taskId });
}

export type PromoteSubtaskResult =
  | {
      ok: true;
      data: {
        id: string;
        parentTaskId: null;
      };
    }
  | { ok: false; error: string };

// Promotes a child task to a top-level task, detaching it from its
// parent (F149: AS-268). Pattern mirrors deleteTask/editTask above:
// Zod-validated input, membership re-checked server-side (defense in
// depth, AS-143), admin client used for the actual update, discriminated
// union return, generic user-facing errors with details only logged
// server-side (AS-146). Any active workspace member may promote any
// subtask in that workspace — no per-task ownership check, same "any
// role" model as deleteTask (AS-055) and editTask (AS-061).
//
// A promoted task's `position` and `status` are left completely
// untouched. A subtask is created through the same createTask code path
// as any top-level task (F149's createTask change above) and already
// carries a normal fractional-index `position` within its (project,
// status) column — the exact same axis a top-level task's position lives
// on. There is no separate "subtask position" to reconcile: clearing
// `parent_task_id` doesn't move the row to a different column or
// position space, so the row is already a valid, correctly-ordered board
// card the instant this UPDATE commits. (Verified, not assumed — see
// tests/integration/promote-subtask.test.ts's AS-268 position assertion.)
//
// Zero-state / no-op (per this feature's Clarified implementation,
// clarification question 6): a task that is already top-level
// (`parent_task_id` already null) is a no-op — this returns `ok: true`
// without writing to the database, so the caller doesn't have to special-
// case "already promoted" as an error.
// W11: migrated onto withAuthz — see deleteTaskImpl above and
// lib/actions/authz.ts's doc comment.
const promoteSubtaskImpl = withAuthz(
  promoteSubtaskSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to promote this task.",
    writeError: "Viewers don't have permission to promote tasks.",
    requireVisibility: true,
    visibilityError: "Viewers don't have permission to promote tasks.",
    // A soft-deleted task behaves as "not found", same convention as every
    // other action in this file. `parent_task_id` is threaded through as
    // `extra` so the handler's zero-state check below doesn't need a
    // second query.
    resolveWorkspace: async (input, admin) => {
      const { data: taskRow, error } = await admin
        .from("tasks")
        .select(
          "id, parent_task_id, deleted_at, projects!inner(id, workspace_id, visibility)",
        )
        .eq("id", input.taskId)
        .is("deleted_at", null)
        .maybeSingle();

      if (error || !taskRow) return { ok: false, error: "Task not found." };

      const project = Array.isArray(taskRow.projects)
        ? taskRow.projects[0]
        : taskRow.projects;

      if (!project?.workspace_id) return { ok: false, error: "Task not found." };

      return {
        ok: true,
        workspaceId: project.workspace_id,
        projectId: project.id,
        visibility: (project.visibility as ProjectVisibility) ?? "workspace",
        extra: {
          taskRow: { id: taskRow.id, parentTaskId: taskRow.parent_task_id as string | null },
        },
      };
    },
  },
  async (input, ctx): Promise<PromoteSubtaskResult> => {
    // Zero-state (Clarified implementation Q6): already top-level — no-op,
    // ok without writing.
    if (ctx.taskRow.parentTaskId === null) {
      return { ok: true, data: { id: ctx.taskRow.id, parentTaskId: null } };
    }

    const { data: updated, error: updateError } = await ctx.admin
      .from("tasks")
      .update({ parent_task_id: null })
      .eq("id", input.taskId)
      .select("id, parent_task_id")
      .single();

    if (updateError || !updated) {
      logger.error("promoteSubtask: update failed", { error: updateError });
      return {
        ok: false,
        error: "Something went wrong. Please try again in a moment.",
      };
    }

    const { data: workspaceRow } = await ctx.admin
      .from("workspaces")
      .select("slug")
      .eq("id", ctx.workspaceId)
      .maybeSingle();

    if (workspaceRow?.slug) {
      try {
        revalidatePath(`/w/${workspaceRow.slug}`, "layout");
      } catch (revalidateError) {
        // Non-fatal cache-freshness rationale, same as createTask above.
        logger.error("promoteSubtask: revalidatePath failed (non-fatal)", { error: revalidateError });
      }
    }

    return {
      ok: true,
      data: {
        id: updated.id,
        parentTaskId: null,
      },
    };
  },
);

export async function promoteSubtask(
  taskId: string,
): Promise<PromoteSubtaskResult> {
  return promoteSubtaskImpl({ taskId });
}

