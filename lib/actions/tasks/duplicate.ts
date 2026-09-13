"use server";

import { revalidatePath } from "next/cache";
import { duplicateTaskSchema } from "@/lib/validation/tasks";
import { logger } from "@/lib/observability/logger";
import { type ActionResult, withAuthz } from "@/lib/actions/authz";
import { type ProjectVisibility } from "@/lib/actions/project-visibility";
import { calculatePosition } from "@/lib/board/position";
import { cloneTaskFields } from "@/lib/recurrence/clone-fields";
import { computeFanoutRecipients } from "@/lib/notifications/fanout";
import { filterRecipientsByInAppPreference } from "@/lib/notifications/preferences";
import { createNotification } from "@/lib/notifications/create-notification";
import type { Json } from "@/lib/supabase/database.types";
import { syncMirrorAssigneeId } from "./shared";

export type DuplicateTaskResult = ActionResult<{
        id: string;
        projectId: string;
        title: string;
        status: string;
        position: number;
        number: number;
      }>;

// Duplicates a task (F180: AS-324, AS-325, AS-326, AS-327). Reuses F176's
// `cloneTaskFields` (lib/recurrence/clone-fields.ts) verbatim for the
// title/description/description_json/assignees/priority/checklist/estimate
// copy rules, per this feature's own spec ("reusing F176's clone-fields
// allow-list so copy rules exist in exactly one place") — this function
// does NOT re-derive which fields are copied vs excluded; it only adds the
// two things `cloneTaskFields` deliberately has no I/O to do itself: `tags`
// (a plain column copy, not part of the recurrence allow-list — recurrence
// occurrences don't carry tags forward, but a duplicate explicitly should
// per AS-325) and the actual database writes (new task row + checklist
// items + task_assignees rows), including generating the new task's own
// key/number via the SAME atomic mechanism (F145's `assign_task_key`
// trigger, which fires on any `tasks` insert that doesn't supply `number`)
// every other task-creation path in this file already relies on — never a
// manually computed number.
//
// Title marking (Clarified implementation's one open question, resolved
// per the clarification's "take the simpler option, record it"): "Copy of
// <original title>" — matches this mission's project-duplication feature's
// own convention (see that feature's handoff) so both duplication features
// share one convention rather than inventing two.
//
// Same project, same status (AS-327): the duplicate is never re-parented
// to a different project/status — both are read straight from the source
// row and never accepted as caller input (duplicateTaskSchema takes only
// `taskId`).
//
// Position (AS-327): "positioned right after the original" is computed via
// the same lib/board/position.ts `calculatePosition` every other
// reposition path in this codebase (board drag-and-drop) already uses —
// the source task's own position is the `prevPosition` neighbor, and the
// source's current next sibling in that (project, status) column (by
// position ascending) is the `nextPosition` neighbor, so the new row's
// position always lands strictly between the two (or after the source with
// the boundary gap, if the source was already last in its column).
//
// Excluded (AS-326, per cloneTaskFields's own contract): comments,
// attachments, logged time entries are never read from the source task at
// all — this function has no query against `comments`/`attachments`/
// `time_entries` for the source. The new task's key/number is freshly
// assigned by the DB trigger, never copied from the source row.
type DuplicateTaskSourceRow = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  description_json: Json | null;
  status: string;
  priority: "urgent" | "high" | "medium" | "low" | "backlog" | null;
  tags: string[] | null;
  position: number;
  estimate_minutes: number | null;
  // F116 (AS-058): a duplicate keeps the source's own type — never
  // re-defaulted to 'delivery', since that would silently misclassify a
  // duplicated Page/QA-issue/etc. task.
  task_type_id: string;
};

// W11: migrated onto withAuthz — see deleteTaskImpl above and
// lib/actions/authz.ts's doc comment. The source row is threaded through
// as `extra` so the handler doesn't need a second query for it.
const duplicateTaskImpl = withAuthz(
  duplicateTaskSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to duplicate this task.",
    // Same gate createTask/editTask use: viewers/guests are read-only
    // (AS-216/AS-217) — duplicating a task creates a new one, so it's a
    // write, gated the same way createTask's own write is.
    writeError: "Viewers don't have permission to duplicate tasks.",
    requireVisibility: true,
    visibilityError: "Viewers don't have permission to duplicate tasks.",
    resolveWorkspace: async (input, admin) => {
      const { data: sourceRow, error } = await admin
        .from("tasks")
        .select(
          "id, project_id, title, description, description_json, status, priority, tags, position, estimate_minutes, task_type_id, deleted_at, projects(workspace_id, visibility)",
        )
        .eq("id", input.taskId)
        .is("deleted_at", null)
        .maybeSingle();

      if (error || !sourceRow) return { ok: false, error: "Task not found." };

      const project = sourceRow.projects as
        | { workspace_id: string; visibility: string | null }
        | { workspace_id: string; visibility: string | null }[]
        | null;
      const projectRow = Array.isArray(project) ? project[0] : project;

      if (!projectRow?.workspace_id) return { ok: false, error: "Task not found." };

      return {
        ok: true,
        workspaceId: projectRow.workspace_id,
        // F322 (AS-227, AS-228): uses `sourceRow.project_id` (already
        // selected as a top-level column) rather than the embedded
        // `projects` row's own id, which isn't selected here.
        projectId: sourceRow.project_id,
        visibility:
          (projectRow?.visibility as ProjectVisibility) ?? "workspace",
        extra: { sourceRow: sourceRow as unknown as DuplicateTaskSourceRow },
      };
    },
  },
  async (input, ctx): Promise<DuplicateTaskResult> => {
    const sourceRow = ctx.sourceRow;

    const [assigneesResult, checklistResult] = await Promise.all([
      ctx.admin
        .from("task_assignees")
        .select("user_id, created_at")
        .eq("task_id", input.taskId)
        .order("created_at", { ascending: true }),
      ctx.admin
        .from("checklist_items")
        .select("content, position")
        .eq("task_id", input.taskId)
        .order("position", { ascending: true }),
    ]);

    const cloned = cloneTaskFields({
      title: sourceRow.title,
      description: sourceRow.description,
      description_json: sourceRow.description_json,
      assigneeIds: (assigneesResult.data ?? []).map((row) => row.user_id as string),
      priority: sourceRow.priority,
      checklistItems: (checklistResult.data ?? []).map((row) => ({
        content: row.content as string,
        position: row.position as number,
      })),
      estimate_minutes: sourceRow.estimate_minutes,
    });

    // AS-327: land in the SAME status as the original, never the
    // recurrence allow-list's "todo" reset — cloneTaskFields.status is
    // deliberately ignored here (that reset is specific to recurring
    // occurrences, not duplication), and the source's own current status
    // is used instead.
    const targetStatus = sourceRow.status;

    // AS-327: positioned right after the original in its current column.
    // The source's own position is the previous-sibling anchor; its
    // current next sibling by position (same project + status column) is
    // the next-sibling anchor.
    const { data: nextSibling } = await ctx.admin
      .from("tasks")
      .select("position")
      .eq("project_id", sourceRow.project_id)
      .eq("status", targetStatus)
      .is("deleted_at", null)
      .gt("position", sourceRow.position)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();

    const newPosition = calculatePosition(
      sourceRow.position,
      nextSibling?.position ?? null,
    );

    const { data: inserted, error: insertError } = await ctx.admin
      .from("tasks")
      .insert({
        project_id: sourceRow.project_id,
        // AS-324: the duplicate's title is distinctly marked, never an
        // exact copy of the source's title.
        title: `Copy of ${cloned.title}`,
        description: cloned.description,
        description_json: cloned.description_json as Json,
        status: targetStatus,
        priority: cloned.priority,
        tags: sourceRow.tags ?? [],
        estimate_minutes: cloned.estimate_minutes,
        author_id: ctx.user.id,
        position: newPosition,
        // F116: carried over from the source, never re-defaulted.
        task_type_id: sourceRow.task_type_id,
        // No `number`/key supplied: F145's assign_task_key trigger assigns
        // this new row its OWN project-sequential number on insert, exactly
        // like every other task-creation path in this file
        // (createTaskForUser above never supplies one either) — never
        // copied from the source.
      })
      .select("id, project_id, title, status, position, number")
      .single();

    if (insertError || !inserted) {
      logger.error("duplicateTask: insert failed", { error: insertError });
      return {
        ok: false,
        error: "Something went wrong. Please try again in a moment.",
      };
    }

    // Atomicity fix (W7b): checklist items and assignees are copied inside
    // a single database transaction via RPC. Previously these were two
    // independent inserts whose failures were only logged, leaving an
    // orphan task on the board with a missing checklist and/or assignees
    // while the caller still saw ok:true. If the RPC fails, the newly-
    // inserted task is rolled back too, so the caller never sees a
    // partially-duplicated task.
    if (cloned.checklistItems.length > 0 || cloned.assigneeIds.length > 0) {
      const { error: atomicError } = await ctx.admin.rpc(
        "duplicate_task_atomic",
        { p_source_task_id: input.taskId, p_new_task_id: inserted.id },
      );
      if (atomicError) {
        logger.error("duplicateTask: duplicate_task_atomic failed", { error: atomicError });
        // Roll back the task insert too — don't leave a task with no
        // checklist/assignees.
        await ctx.admin.from("tasks").delete().eq("id", inserted.id);
        return {
          ok: false,
          error: "Something went wrong. Please try again in a moment.",
        };
      }

      if (cloned.assigneeIds.length > 0) {
        await syncMirrorAssigneeId(ctx.admin, inserted.id);

        // F306 (D9/FU-3 scrutiny fix, AS-380): the duplicate carries over
        // the source's assignees but never notified them — routed through
        // the same shared helpers every other fan-out call site uses. Like
        // createTaskForUser above, this is a creation, not a *change*, so
        // no task_activity entry is written for it, only the notification.
        // Non-fatal.
        try {
          const computedRecipients = computeFanoutRecipients({
            type: "assigned",
            actorId: ctx.user.id,
            assigneeIds: cloned.assigneeIds,
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
                taskId: inserted.id,
              },
              "duplicateTask",
            );
          }
        } catch (fanoutError) {
          logger.error("duplicateTask: notification fan-out failed (non-fatal)", { error: fanoutError });
        }
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
        logger.error("duplicateTask: revalidatePath failed (non-fatal)", { error: revalidateError });
      }
    }

    return {
      ok: true,
      data: {
        id: inserted.id,
        projectId: inserted.project_id,
        title: inserted.title,
        status: inserted.status,
        position: inserted.position,
        number: inserted.number,
      },
    };
  },
);

export async function duplicateTask(
  taskId: string,
): Promise<DuplicateTaskResult> {
  return duplicateTaskImpl({ taskId });
}

