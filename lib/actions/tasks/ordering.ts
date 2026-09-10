"use server";

import { revalidatePath } from "next/cache";
import {
  moveTaskStatusSchema,
  reorderTaskSchema,
  moveAndReorderTaskSchema,
} from "@/lib/validation/tasks";
import { logger } from "@/lib/observability/logger";
import { withAuthz } from "@/lib/actions/authz";
import { type ProjectVisibility } from "@/lib/actions/project-visibility";
import { isDoneStatus } from "@/lib/tasks/blocked-guard";
import { generateNextOccurrence } from "@/lib/recurrence/generate-next-occurrence";
import { getCurrentUserTimezone } from "@/lib/queries/profile";
import {
  diffTaskFields,
  writeTaskFieldChanges,
} from "@/lib/activity/task-activity";
import { computeFanoutRecipients } from "@/lib/notifications/fanout";
import { filterRecipientsByInAppPreference } from "@/lib/notifications/preferences";
import { createNotification } from "@/lib/notifications/create-notification";
import type { Json } from "@/lib/supabase/database.types";

export type MoveTaskStatusResult =
  | {
      ok: true;
      data: {
        id: string;
        status: string;
      };
    }
  | { ok: false; error: string };

// Updates a task's status when its card is dropped into a different board
// column (F045: AS-069). Pattern mirrors assignTask/editTask/deleteTask
// above: Zod-validated input against the fixed 4-value status set,
// membership re-checked server-side (defense in depth, AS-143), admin
// client used for the actual update, discriminated union return, generic
// user-facing errors with details only logged server-side (AS-146).
//
// AS-069 covers only the status-column update itself. Recomputing/
// persisting the task's `position` within its new (or same) column is
// F046's responsibility, layered on top of this same board.tsx onDragEnd
// handler — not duplicated here.
//
// Any active workspace member may move any task in that workspace,
// regardless of authorship/assignment — mirrors editTask (AS-061) and
// deleteTask (AS-055): no per-task ownership check, only workspace
// membership.
type MoveTaskStatusTaskRow = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  description_json: Json | null;
  priority: "urgent" | "high" | "medium" | "low" | "backlog" | null;
  estimate_minutes: number | null;
  due_date: string | null;
  recurrence: unknown;
  recurrence_parent_id: string | null;
  status: string;
  task_type_id: string;
};

// W11: migrated onto withAuthz — see deleteTaskImpl above and
// lib/actions/authz.ts's doc comment. The task row is threaded through as
// `extra` so the recurrence-generation step below doesn't need a second
// query for it.
const moveTaskStatusImpl = withAuthz(
  moveTaskStatusSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to move this task.",
    writeError: "Viewers don't have permission to move tasks.",
    requireVisibility: true,
    visibilityError: "Viewers don't have permission to move tasks.",
    // A soft-deleted task behaves as "not found", same convention as
    // assignTask/editTask/deleteTask's task lookup.
    resolveWorkspace: async (input, admin) => {
      const { data: taskRow, error } = await admin
        .from("tasks")
        .select(
          "id, deleted_at, project_id, title, description, description_json, priority, estimate_minutes, due_date, recurrence, recurrence_parent_id, status, task_type_id, projects!inner(id, workspace_id, visibility)",
        )
        .eq("id", input.taskId)
        .is("deleted_at", null)
        .maybeSingle();

      if (error || !taskRow) return { ok: false, error: "Task not found." };

      const project = Array.isArray(taskRow.projects)
        ? taskRow.projects[0]
        : taskRow.projects;

      if (!project?.workspace_id) return { ok: false, error: "Task not found." };

      const { projects: _ignoredProjects, deleted_at: _ignoredDeletedAt, ...taskFields } = taskRow;
      void _ignoredProjects;
      void _ignoredDeletedAt;

      return {
        ok: true,
        workspaceId: project.workspace_id,
        projectId: project.id,
        visibility: (project.visibility as ProjectVisibility) ?? "workspace",
        extra: { taskRow: taskFields as MoveTaskStatusTaskRow },
      };
    },
  },
  async (input, ctx): Promise<MoveTaskStatusResult> => {
    const taskRow = ctx.taskRow;

    // F221 (AS-409): `input.status` must name one of THIS project's real
    // board columns — the DB trigger that derives `status_id` from
    // `(project_id, name)` (F218's `sync_task_status_and_status_id`) fails
    // silently (leaves status_id null) for an unmatched name rather than
    // raising, so this check is the real guard against a stale/forged
    // column name reaching the DB.
    // F222 (AS-410): `category` selected alongside `id` so the recurrence
    // "moved into a done-category status" check below (isDoneStatus) can
    // use this SAME lookup instead of re-deriving/re-fetching it — no
    // second query, no second source of truth for "is the target column
    // done".
    const { data: columnMatch } = await ctx.admin
      .from("project_statuses")
      .select("id, category")
      .eq("project_id", ctx.projectId as string)
      .eq("name", input.status)
      .maybeSingle();

    if (!columnMatch) {
      return {
        ok: false,
        error: "That column no longer exists. Refresh the board and try again.",
      };
    }

    const { data: updated, error: updateError } = await ctx.admin
      .from("tasks")
      .update({ status: input.status })
      .eq("id", input.taskId)
      .select("id, status")
      .single();

    if (updateError || !updated) {
      logger.error("moveTaskStatus: update failed", { error: updateError });
      return {
        ok: false,
        error: "Something went wrong. Please try again in a moment.",
      };
    }

    // F195 (AS-354, AS-355): record the status change. Non-fatal, mirrors
    // editTask's own activity write above.
    try {
      const changes = diffTaskFields(
        { status: taskRow.status },
        { status: updated.status },
      );
      await writeTaskFieldChanges(ctx.supabase, input.taskId, changes);
    } catch (activityError) {
      logger.error("moveTaskStatus: writeTaskFieldChanges failed (non-fatal)", { error: activityError });
    }

    // F207 (AS-294, AS-382, AS-384): a status change notifies the task's
    // current active watchers (excluding the actor). Non-fatal, same
    // convention as writeTaskFieldChanges above. Uses the caller's own
    // session (`supabase`) so create_notification pins actor_id to
    // auth.uid() server-side — see setTaskAssigneesCore's identical
    // rationale above.
    try {
      const { data: watcherRows } = await ctx.admin
        .from("task_watchers")
        .select("user_id")
        .eq("task_id", input.taskId)
        .eq("is_watching", true);
      const watcherIds = (watcherRows ?? []).map((row) => row.user_id as string);

      const computedRecipients = computeFanoutRecipients({
        type: "status_changed",
        actorId: ctx.user.id,
        watcherIds,
      });
      // F211 (AS-391): drop recipients who have this kind's in-app channel
      // disabled before ever calling create_notification.
      const recipients = await filterRecipientsByInAppPreference(
        ctx.admin,
        computedRecipients ?? [],
      );
      for (const recipient of recipients ?? []) {
        await createNotification(
          ctx.supabase,
          {
            userId: recipient.userId,
            workspaceId: ctx.workspaceId,
            kind: recipient.kind,
            taskId: input.taskId,
          },
          "moveTaskStatus",
        );
      }
    } catch (fanoutError) {
      logger.error("moveTaskStatus: notification fan-out failed (non-fatal)", { error: fanoutError });
    }

    // F177 (AS-315, AS-320, AS-321): a recurring task that just
    // transitioned into a done-category status generates its next
    // occurrence, in the same logical unit as this status write
    // (immediately after it succeeds, same request). Per this feature's
    // Clarified implementation, this is purely additive — a failure or
    // legitimate no-op here (no recurrence, no due date, archived project,
    // already generated) never turns the status change itself into a
    // failure; the user's completion always succeeds.
    if (isDoneStatus(input.status, columnMatch.category) && taskRow.recurrence) {
      try {
        const timezone = await getCurrentUserTimezone(ctx.supabase);
        await generateNextOccurrence(
          ctx.admin,
          {
            id: taskRow.id,
            project_id: taskRow.project_id,
            title: taskRow.title,
            description: taskRow.description,
            description_json: taskRow.description_json,
            priority: taskRow.priority,
            estimate_minutes: taskRow.estimate_minutes,
            due_date: taskRow.due_date,
            recurrence: taskRow.recurrence,
            recurrence_parent_id: taskRow.recurrence_parent_id,
            // F116: the generated occurrence keeps the source's own
            // type — never re-defaulted, so a recurring 'client_request'
            // or 'page' task doesn't silently start generating
            // 'delivery'-typed occurrences.
            task_type_id: taskRow.task_type_id,
          },
          ctx.user.id,
          timezone,
        );
      } catch (recurrenceError) {
        // Non-fatal: the status change already succeeded above. Generation
        // is best-effort additive behavior, never a reason to fail the
        // user's completion action.
        logger.error("moveTaskStatus: generateNextOccurrence failed (non-fatal)", { error: recurrenceError });
      }
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
        logger.error("moveTaskStatus: revalidatePath failed (non-fatal)", { error: revalidateError });
      }
    }

    return {
      ok: true,
      data: {
        id: updated.id,
        status: updated.status,
      },
    };
  },
);

export async function moveTaskStatus(
  taskId: string,
  // F221 (AS-409): any of the project's real `project_statuses` column
  // names, not just the original fixed four — see moveTaskStatusSchema's
  // doc comment.
  newStatus: string,
): Promise<MoveTaskStatusResult> {
  return moveTaskStatusImpl({ taskId, status: newStatus });
}

export type ReorderTaskResult =
  | {
      ok: true;
      data: {
        id: string;
        position: number;
      };
    }
  | { ok: false; error: string };

// Persists a task's new `position` after a drag-and-drop reorder (F046:
// AS-070, AS-078, AS-079, AS-080). Pattern mirrors moveTaskStatus above:
// Zod-validated input, membership re-checked server-side (defense in
// depth, AS-143), admin client used for the actual update, discriminated
// union return, generic user-facing errors with details only logged
// server-side (AS-146).
//
// AS-070/AS-078: this action updates ONLY the `position` column — it never
// touches `status`. board.tsx's onDragEnd (F045 + F046, same handler)
// calls calculatePosition (lib/board/position.ts) to compute the new
// fractional-index value from the dropped card's new neighbors, then calls
// this action with that value for a same-column reorder. If a drag ALSO
// changes the column, onDragEnd instead calls moveAndReorderTask (F102) —
// a single atomic action that sets both columns in one UPDATE — rather
// than calling this action and moveTaskStatus (F045) independently. Two
// independent UPDATEs against the same row previously left a window where
// one could succeed and the other fail, leaving status/position
// inconsistent with each other and with the client's rolled-back view; see
// moveAndReorderTask's doc comment (F102, fixing M5-scrutiny.md Finding 2)
// for the full history.
//
// AS-080: dragging must not change updated_at unless status also changed.
// Investigated the `tasks_set_updated_at` trigger
// (supabase/migrations/20260818013434_create_tasks.sql) — it originally
// fired unconditionally on every UPDATE, which would have bumped
// updated_at on this position-only write too. Fixed at the schema level
// in supabase/migrations/20260818023746_tasks_updated_at_exclude_position.sql,
// which adds a WHEN clause so the trigger only fires when a column other
// than `position` (and `updated_at` itself) actually changed. Nothing
// further is needed here in application code — the UPDATE below only ever
// sets `position`, and the trigger now leaves `updated_at` alone for that
// case.
//
// Any active workspace member may reorder any task in that workspace,
// regardless of authorship/assignment — mirrors moveTaskStatus/editTask/
// deleteTask: no per-task ownership check, only workspace membership.
// W11: migrated onto withAuthz — see deleteTaskImpl above and
// lib/actions/authz.ts's doc comment.
const reorderTaskImpl = withAuthz(
  reorderTaskSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to reorder this task.",
    writeError: "Viewers don't have permission to reorder tasks.",
    requireVisibility: true,
    visibilityError: "Viewers don't have permission to reorder tasks.",
    // A soft-deleted task behaves as "not found", same convention as
    // moveTaskStatus/editTask/deleteTask's task lookup.
    resolveWorkspace: async (input, admin) => {
      const { data: taskRow, error } = await admin
        .from("tasks")
        .select("id, deleted_at, projects!inner(id, workspace_id, visibility)")
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
        extra: {},
      };
    },
  },
  async (input, ctx): Promise<ReorderTaskResult> => {
    // AS-070/AS-078: position only — status is deliberately absent from
    // this payload. AS-080: this UPDATE only ever sets `position`, and the
    // tasks_set_updated_at trigger's WHEN clause (see migration referenced
    // above) is what actually keeps updated_at untouched for this case.
    const { data: updated, error: updateError } = await ctx.admin
      .from("tasks")
      .update({ position: input.position })
      .eq("id", input.taskId)
      .select("id, position")
      .single();

    if (updateError || !updated) {
      logger.error("reorderTask: update failed", { error: updateError });
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
        logger.error("reorderTask: revalidatePath failed (non-fatal)", { error: revalidateError });
      }
    }

    return {
      ok: true,
      data: {
        id: updated.id,
        position: updated.position,
      },
    };
  },
);

export async function reorderTask(
  taskId: string,
  newPosition: number,
): Promise<ReorderTaskResult> {
  return reorderTaskImpl({ taskId, position: newPosition });
}

export type MoveAndReorderTaskResult =
  | {
      ok: true;
      data: {
        id: string;
        status: string;
        position: number;
      };
    }
  | { ok: false; error: string };

// Atomically updates both `status` and `position` for a cross-column drag
// (F102: AS-077, follow-up on scrutiny-validator's M5-scrutiny.md Finding
// 2). Before this action existed, board.tsx's onDragEnd called
// moveTaskStatus and reorderTask as two independent, uncoordinated Server
// Actions on a cross-column drag. If the first succeeded and the second
// failed, the client rolled back visually but the server kept the
// already-committed status change with a stale (pre-move) position value —
// client and server permanently disagreed about what happened.
//
// Fix: a single UPDATE statement setting both `status` and `position`
// together. A single UPDATE against a single row is inherently atomic in
// Postgres (it either commits both column changes or neither) — there is no
// intermediate state where one column changed and the other didn't, so the
// partial-failure class of bug this exists to fix is impossible by
// construction. Callers that only need to change one of the two fields
// (same-column reorder, or a status-only change with no reposition) should
// keep calling reorderTask/moveTaskStatus individually — this action is
// specifically for drags that change both at once.
//
// Pattern otherwise mirrors moveTaskStatus/reorderTask above: Zod-validated
// input (both fields validated together, before either reaches the
// database — an invalid status or non-finite position fails validation and
// the UPDATE never runs), membership re-checked server-side (defense in
// depth, AS-143), admin client used for the actual update, discriminated
// union return, generic user-facing errors with details only logged
// server-side (AS-146). No per-task ownership check, only workspace
// membership, same as its two single-purpose siblings.
// W11: migrated onto withAuthz — see deleteTaskImpl above and
// lib/actions/authz.ts's doc comment. The pre-move `status` is threaded
// through as `extra` so the "did status actually change" diff below
// doesn't need a second query.
const moveAndReorderTaskImpl = withAuthz(
  moveAndReorderTaskSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to move this task.",
    writeError: "Viewers don't have permission to move tasks.",
    requireVisibility: true,
    visibilityError: "Viewers don't have permission to move tasks.",
    // A soft-deleted task behaves as "not found", same convention as
    // moveTaskStatus/reorderTask's task lookup.
    resolveWorkspace: async (input, admin) => {
      const { data: taskRow, error } = await admin
        .from("tasks")
        .select(
          "id, deleted_at, status, projects!inner(id, workspace_id, visibility)",
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
        extra: { previousStatus: taskRow.status as string },
      };
    },
  },
  async (input, ctx): Promise<MoveAndReorderTaskResult> => {
    // F221 (AS-409): same column-name guard as moveTaskStatus above — see
    // that function's doc comment for why this check (not just the DB
    // trigger) is the real backstop against an unmatched/stale column
    // name.
    const { data: columnMatch } = await ctx.admin
      .from("project_statuses")
      .select("id")
      .eq("project_id", ctx.projectId as string)
      .eq("name", input.status)
      .maybeSingle();

    if (!columnMatch) {
      return {
        ok: false,
        error: "That column no longer exists. Refresh the board and try again.",
      };
    }

    // Single UPDATE, both columns set together — atomic by construction.
    // If this fails (constraint violation, connection drop, etc.), NEITHER
    // status NOR position changes; there is no partial-commit state for
    // the client to be inconsistent with.
    const { data: updated, error: updateError } = await ctx.admin
      .from("tasks")
      .update({ status: input.status, position: input.position })
      .eq("id", input.taskId)
      .select("id, status, position")
      .single();

    if (updateError || !updated) {
      logger.error("moveAndReorderTask: update failed", { error: updateError });
      return {
        ok: false,
        error: "Something went wrong. Please try again in a moment.",
      };
    }

    // F306 (D9/FU-3 scrutiny fix, AS-353, AS-355): the board drag path was
    // the single most common way a task's status ever changes and had
    // ZERO activity entry — record the status change exactly like
    // moveTaskStatus does above, non-fatal. Guarded on an actual status
    // change (unlike a pure in-column reorder, which never touches
    // `status` at all) so a same-column drag doesn't fabricate a "status
    // changed" entry/notify.
    if (ctx.previousStatus !== updated.status) {
      try {
        const changes = diffTaskFields(
          { status: ctx.previousStatus },
          { status: updated.status },
        );
        await writeTaskFieldChanges(ctx.supabase, input.taskId, changes);
      } catch (activityError) {
        logger.error("moveAndReorderTask: writeTaskFieldChanges failed (non-fatal)", { error: activityError });
      }

      // F306 (D9/FU-3 scrutiny fix, AS-294, AS-382): notify the task's
      // current active watchers of the status change — same fan-out
      // moveTaskStatus performs, routed through the same shared helpers.
      // Non-fatal.
      try {
        const { data: watcherRows } = await ctx.admin
          .from("task_watchers")
          .select("user_id")
          .eq("task_id", input.taskId)
          .eq("is_watching", true);
        const watcherIds = (watcherRows ?? []).map(
          (row) => row.user_id as string,
        );

        const computedRecipients = computeFanoutRecipients({
          type: "status_changed",
          actorId: ctx.user.id,
          watcherIds,
        });
        const recipients = await filterRecipientsByInAppPreference(
          ctx.admin,
          computedRecipients ?? [],
        );
        for (const recipient of recipients ?? []) {
          await createNotification(
            ctx.supabase,
            {
              userId: recipient.userId,
              workspaceId: ctx.workspaceId,
              kind: recipient.kind,
              taskId: input.taskId,
            },
            "moveAndReorderTask",
          );
        }
      } catch (fanoutError) {
        logger.error("moveAndReorderTask: notification fan-out failed (non-fatal)", { error: fanoutError });
      }
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
        logger.error("moveAndReorderTask: revalidatePath failed (non-fatal)", { error: revalidateError });
      }
    }

    return {
      ok: true,
      data: {
        id: updated.id,
        status: updated.status,
        position: updated.position,
      },
    };
  },
);

export async function moveAndReorderTask(
  taskId: string,
  // F221 (AS-409): any of the project's real `project_statuses` column
  // names — see moveAndReorderTaskSchema's doc comment.
  newStatus: string,
  newPosition: number,
): Promise<MoveAndReorderTaskResult> {
  return moveAndReorderTaskImpl({
    taskId,
    status: newStatus,
    position: newPosition,
  });
}

