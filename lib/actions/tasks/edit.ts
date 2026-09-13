"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  editTaskSchema,
  type EditTaskUpdates,
} from "@/lib/validation/tasks";
import { logger } from "@/lib/observability/logger";
import type { JSONContent } from "@/components/editor/rich-text-editor";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { canEditTask } from "@/lib/auth/permissions";
import {
  isProjectVisibleToCaller,
  type ProjectVisibility,
} from "@/lib/actions/project-visibility";
import {
  diffTaskFields,
  writeTaskFieldChanges,
} from "@/lib/activity/task-activity";
import { sanitiseMentionsForVisibility } from "@/lib/comments/mentions";
import {
  extractNewlyMentionedIds,
  notifyNewlyMentionedUsers,
} from "@/lib/notifications/mentions";
import { computeFanoutRecipients } from "@/lib/notifications/fanout";
import { filterRecipientsByInAppPreference } from "@/lib/notifications/preferences";
import { createNotification } from "@/lib/notifications/create-notification";
import type { Json } from "@/lib/supabase/database.types";

export type EditTaskResult =
  | {
      ok: true;
      data: {
        id: string;
        title: string;
        description: string | null;
        /** F205 (AS-378): present only when `updates.descriptionJson` was
         * part of this call — the mention-sanitised document actually
         * persisted, so an optimistic caller can re-sync its local mirror
         * to the authoritative (possibly-stripped) value without a second
         * fetch, same "return what was actually written" convention as
         * `toggleDescriptionChecklistItem`. */
        descriptionJson?: JSONContent | null;
        priority: string | null;
        dueDate: string | null;
        // F236 (AS-453): mirrors dueDate's own always-present convention
        // (not descriptionJson's conditional one) — a plain scalar field
        // with no server-side transform, same shape as dueDate.
        startDate: string | null;
        estimateMinutes: number | null;
        // F005 (missions/20260903-portal, AS-014): mirrors startDate's
        // own always-present convention above.
        pageSlug: string | null;
        pageOrder: number | null;
        // F006c (missions/20260903-portal, AS-013): mirrors pageSlug's
        // own always-present convention above.
        phaseId: string | null;
      };
    }
  | { ok: false; error: string };

// Edits a task's title/description/priority/due date (F037: AS-054,
// AS-061). Pattern mirrors assignTask above: Zod-validated partial input,
// membership re-checked server-side (defense in depth, AS-143), admin
// client used for the actual update, discriminated union return, generic
// user-facing errors with details only logged server-side (AS-146).
//
// AS-061: any active workspace member may edit any task in that workspace,
// regardless of whether they authored it or are assigned to it — there is
// no per-task ownership check here, only workspace membership.
//
// AS-060: `updates` is typed as `EditTaskUpdates`
// (lib/validation/tasks.ts), which has no `projectId` field. Moving a task
// between projects is out of scope for v1 — this isn't a runtime check
// that rejects a projectId, it's the absence of any field that could carry
// one, so there is no code path here that could move a task between
// projects even by accident. Do not add a projectId field to
// `EditTaskUpdates` or to this function's update payload.
//
// Only fields actually present in `updates` are applied — an omitted field
// leaves the existing column value untouched (unlike createTask, which
// always writes every column).
export async function editTask(
  taskId: string,
  updates: EditTaskUpdates,
): Promise<EditTaskResult> {
  const parsed = editTaskSchema.safeParse({ taskId, updates });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Enter valid task details.",
    };
  }

  if (Object.keys(parsed.data.updates).length === 0) {
    return { ok: false, error: "No changes to save." };
  }

  const { supabase, user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to edit a task." };
  }

  const admin = createAdminClient();

  // Look up the task's owning workspace (via its project) so membership is
  // checked against the real workspace, never one supplied by the caller.
  // A soft-deleted task behaves as "not found", same convention as
  // assignTask's task lookup.
  const { data: taskRow, error: taskError } = await admin
    .from("tasks")
    .select(
      // F205 (AS-378): `description_json` (needed to diff against the new
      // document — see extractNewlyMentionedIds call below) and the
      // project's own `id`/`visibility` (needed by
      // sanitiseMentionsForVisibility, mirroring lib/actions/comments.ts's
      // addComment/editComment) are added here alongside the pre-existing
      // columns; nothing else about this select changes.
      "id, deleted_at, title, priority, due_date, start_date, estimate_minutes, description_json, projects!inner(id, workspace_id, visibility)",
    )
    .eq("id", parsed.data.taskId)
    .is("deleted_at", null)
    .maybeSingle();

  if (taskError || !taskRow) {
    return { ok: false, error: "Task not found." };
  }

  const project = Array.isArray(taskRow.projects)
    ? taskRow.projects[0]
    : taskRow.projects;
  const workspaceId = project?.workspace_id;

  if (!workspaceId) {
    return { ok: false, error: "Task not found." };
  }

  // Defense in depth (AS-143): re-check the caller is an active member of
  // the task's workspace, server-side. AS-061: any role, no per-task
  // ownership/authorship check.
  const membership = await requireActiveMembership(
    admin,
    workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to edit this task.",
    };
  }

  // F128 (AS-216, AS-217): viewers are read-only (canWrite deliberately
  // does not exclude guest — see its doc comment in lib/auth/permissions.ts;
  // guest write access is separately scoped by F134's AS-223). Uses
  // `canEditTask` (identical viewer/guest gating to `canWrite` here, since
  // editTask has no ownership restriction — AS-061) so this stays wired to
  // the same predicate the task-detail UI's edit controls already use.
  if (!canEditTask({ role: membership.role })) {
    return {
      ok: false,
      error: "Viewers don't have permission to edit tasks.",
    };
  }

  // F322 (AS-227, AS-228): the caller must be able to SEE this task's
  // project themselves, not just be an active workspace member — see
  // isProjectVisibleToCaller's doc comment above `loadTaskAssignContext`.
  // Same generic message as the role failure above so a private project's
  // existence is never disclosed to someone who can't see it.
  if (
    !(await isProjectVisibleToCaller(
      admin,
      {
        projectId: project.id,
        visibility: (project.visibility as ProjectVisibility) ?? "workspace",
      },
      user.id,
      membership.role,
    ))
  ) {
    return {
      ok: false,
      error: "Viewers don't have permission to edit tasks.",
    };
  }

  // Build the update payload from only the fields present in `updates`.
  // Never includes project_id (AS-060) — there is no source field for it.
  // F205 (AS-378): when `updates.descriptionJson` is present, every
  // mention in it is re-validated against this task's own project
  // visibility server-side — the exact same
  // `sanitiseMentionsForVisibility` call addComment/editComment already
  // make (lib/comments/mentions.ts), reused rather than reimplemented, so
  // "who's visible" stays defined in exactly one place regardless of
  // whether the mention lives in a comment or a description. A
  // hand-crafted descriptionJson bypassing the picker entirely (any raw
  // call to editTask, not just the wired-up UI) gets the same protection
  // AS-376 already gives comments — this is not skipped just because it's
  // a description.
  // F301: if the visibility check itself fails (transient DB error), the
  // whole description write fails rather than silently persisting every
  // mention rewritten to "@Former member" — same "fail the write rather
  // than corrupt it" handling as addComment/editComment
  // (lib/actions/comments.ts), see MentionVisibilityCheckError's doc
  // comment in lib/comments/mentions.ts.
  let sanitisedDescriptionJson: JSONContent | undefined;
  if ("descriptionJson" in parsed.data.updates) {
    const rawDescriptionJson = parsed.data.updates.descriptionJson;
    if (rawDescriptionJson) {
      try {
        sanitisedDescriptionJson = (await sanitiseMentionsForVisibility(
          admin,
          rawDescriptionJson as JSONContent,
          {
            projectId: project.id,
            workspaceId,
            projectVisibility: project.visibility ?? "workspace",
          },
        )) as JSONContent;
      } catch (visibilityError) {
        logger.error("editTask: mention visibility check failed", { error: visibilityError });
        return {
          ok: false,
          error: "Something went wrong saving your changes. Please try again.",
        };
      }
    } else {
      sanitisedDescriptionJson = { type: "doc", content: [] } as JSONContent;
    }
  }

  // F006c (missions/20260903-portal, AS-013): cross-project safety —
  // mirrors setTaskPhaseImpl's own resolveWorkspace check
  // (lib/actions/phases.ts:646-658, itself citing
  // removeColumnWithReassignment's destination-project check in
  // lib/actions/statuses.ts): a phase id supplied for a DIFFERENT
  // project than this task's own must be rejected, not silently
  // accepted. Not expressible in editTaskSchema (Zod has no cross-table
  // lookup), so it is re-checked here, same "the DB/business rule is
  // re-verified in the action body, not just the client-side schema"
  // convention this file already follows for every other constraint.
  if ("phaseId" in parsed.data.updates && parsed.data.updates.phaseId) {
    const { data: phaseRow } = await admin
      .from("project_phases")
      .select("id, project_id")
      .eq("id", parsed.data.updates.phaseId)
      .maybeSingle();
    if (!phaseRow || phaseRow.project_id !== project.id) {
      return {
        ok: false,
        error: "That phase does not belong to this task's project.",
      };
    }
  }

  const updatePayload: {
    title?: string;
    description?: string | null;
    // F205 (AS-378): written ALONE (never alongside `description` in the
    // same call — `EditTaskUpdates` has no code path that sets both at
    // once, since the description Textarea and the RichTextEditor are
    // mutually exclusive edit surfaces on the same field, see
    // task-detail-sheet.tsx) so the direct-write trigger condition in
    // 20260822130000_task_description_json_direct_write.sql ("description
    // changed is-distinct AND description did NOT change") is met and
    // description_text is derived FROM this document rather than this
    // write being silently discarded back to whatever `description`
    // (untouched) would otherwise re-derive.
    description_json?: Json;
    priority?: "urgent" | "high" | "medium" | "low" | "backlog" | null;
    due_date?: string | null;
    // F236 (AS-453): mirrors due_date's own field above.
    start_date?: string | null;
    estimate_minutes?: number | null;
    // F179 (AS-317, AS-318, AS-319): `null` clears the rule (AS-319: no
    // future occurrences generate — F177's generation logic already
    // checks `recurrence is not null` before generating, per that
    // feature's own skip-conditions list), a valid rule object sets/
    // replaces it.
    recurrence?: {
      freq: "daily" | "weekly" | "monthly" | "every_n_days";
      interval: number;
      until?: string | null;
    } | null;
    // F005 (missions/20260903-portal, AS-014): the portal Pages view's
    // slug/order for a `page`-type task, edited from the task detail
    // sheet's own inline fields — plain scalars, no server-side
    // transform, same shape as due_date/start_date above.
    page_slug?: string | null;
    page_order?: number | null;
    // F006c (missions/20260903-portal, AS-013): the task<->phase
    // assignment. `null` clears it; a validated (see the cross-project
    // check above) uuid sets it.
    phase_id?: string | null;
  } = {};
  if ("title" in parsed.data.updates) {
    updatePayload.title = parsed.data.updates.title;
  }
  if ("description" in parsed.data.updates) {
    updatePayload.description = parsed.data.updates.description;
  }
  if ("priority" in parsed.data.updates) {
    updatePayload.priority = parsed.data.updates.priority;
  }
  if ("dueDate" in parsed.data.updates) {
    updatePayload.due_date = parsed.data.updates.dueDate;
  }
  if ("startDate" in parsed.data.updates) {
    updatePayload.start_date = parsed.data.updates.startDate;
  }
  if ("estimateMinutes" in parsed.data.updates) {
    updatePayload.estimate_minutes = parsed.data.updates.estimateMinutes;
  }
  if ("recurrence" in parsed.data.updates) {
    updatePayload.recurrence = parsed.data.updates.recurrence;
  }
  if ("pageSlug" in parsed.data.updates) {
    updatePayload.page_slug = parsed.data.updates.pageSlug;
  }
  if ("pageOrder" in parsed.data.updates) {
    updatePayload.page_order = parsed.data.updates.pageOrder;
  }
  if ("phaseId" in parsed.data.updates) {
    updatePayload.phase_id = parsed.data.updates.phaseId;
  }
  if (sanitisedDescriptionJson !== undefined) {
    updatePayload.description_json = sanitisedDescriptionJson as Json;
  }

  const { data: updated, error: updateError } = await admin
    .from("tasks")
    .update(updatePayload)
    .eq("id", parsed.data.taskId)
    .select(
      "id, title, description, description_json, priority, due_date, start_date, estimate_minutes, recurrence, page_slug, page_order, phase_id",
    )
    .single();

  if (updateError || !updated) {
    // F166 (AS-299): the tasks_estimate_minutes_positive CHECK is the last
    // line of defense if this row is ever reached with an invalid value
    // (e.g. via a future direct-write path); map it to a field-level
    // message rather than the generic fallback, per this feature's
    // Clarified failure-handling answer.
    if (
      updateError?.message?.includes("tasks_estimate_minutes_positive")
    ) {
      return {
        ok: false,
        error: "Estimate must be greater than zero.",
      };
    }
    // F179 (AS-317, AS-318): last line of defense against
    // `tasks_recurrence_shape` (F175's migration) — the Zod schema above
    // already rejects the same malformed shapes client-side, so this
    // should only ever fire via a future direct-write path.
    if (updateError?.message?.includes("tasks_recurrence_shape")) {
      return {
        ok: false,
        error: "Enter a valid recurrence rule.",
      };
    }
    // F236 (AS-453): `tasks_start_date_not_after_due_date`
    // (supabase/migrations/20260828010000_tasks_start_date.sql) is the
    // last line of defense — the Zod cross-field refine above already
    // rejects the same combination client-side when both fields are
    // touched in the same call, so this should only ever fire when a
    // call sets only one of startDate/dueDate and the OTHER field's
    // existing DB value now conflicts with it.
    if (
      updateError?.message?.includes(
        "tasks_start_date_not_after_due_date",
      )
    ) {
      return {
        ok: false,
        error: "Start date must not be after the due date.",
      };
    }
    logger.error("editTask: update failed", { error: updateError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  // F195 (AS-354, AS-355): record one task_activity entry per diffably
  // changed field (title, priority, due date, estimate — status/assignee
  // are not editable through this action). Non-fatal on failure, same as
  // revalidatePath below — the edit itself already succeeded.
  try {
    const changes = diffTaskFields(
      {
        title: taskRow.title,
        priority: taskRow.priority,
        due_date: taskRow.due_date,
        start_date: taskRow.start_date,
        estimate_minutes: taskRow.estimate_minutes,
      },
      {
        title: updated.title,
        priority: updated.priority,
        due_date: updated.due_date,
        start_date: updated.start_date,
        estimate_minutes: updated.estimate_minutes,
      },
    );
    await writeTaskFieldChanges(supabase, parsed.data.taskId, changes);

    // F319 (AS-294): watchers are notified of a task's activity generally,
    // not just status changes (moveTaskStatus, above) and comments
    // (addComment) — a title/priority/due-date/estimate edit is exactly as
    // much "activity on a watched task" as those, per this feature's
    // Clarified implementation. Scoped to the SAME set of fields
    // diffTaskFields/writeTaskFieldChanges just activity-logged above (not
    // every possible internal field), and only fires when `changes` is
    // non-empty — a no-op save (re-saving identical values) produces zero
    // diffed changes and therefore zero notifications, matching this
    // codebase's "diff first, only act on real changes" convention.
    // Reuses the "status_changed" fan-out event (-> `watcher_update` kind)
    // rather than inventing a new NotificationKind: the notification's
    // purpose ("something about a task I'm watching changed") is identical
    // regardless of which specific field changed, same as moveTaskStatus's
    // block below. Non-fatal, same convention as writeTaskFieldChanges
    // itself.
    if (changes.length > 0) {
      try {
        const { data: watcherRows } = await admin
          .from("task_watchers")
          .select("user_id")
          .eq("task_id", parsed.data.taskId)
          .eq("is_watching", true);
        const watcherIds = (watcherRows ?? []).map(
          (row) => row.user_id as string,
        );

        const computedRecipients = computeFanoutRecipients({
          type: "status_changed",
          actorId: user.id,
          watcherIds,
        });
        // F211 (AS-391): drop recipients who have this kind's in-app
        // channel disabled before ever calling create_notification.
        const recipients = await filterRecipientsByInAppPreference(
          admin,
          computedRecipients ?? [],
        );
        for (const recipient of recipients ?? []) {
          await createNotification(
            supabase,
            {
              userId: recipient.userId,
              workspaceId,
              kind: recipient.kind,
              taskId: parsed.data.taskId,
            },
            "editTask",
          );
        }
      } catch (fanoutError) {
        logger.error("editTask: notification fan-out failed (non-fatal)", { error: fanoutError });
      }
    }
  } catch (activityError) {
    logger.error("editTask: writeTaskFieldChanges failed (non-fatal)", { error: activityError });
  }

  // F205 (AS-378): "notify only newly added mentions, diffed against the
  // previous save" — the whole feature. Compares the document that was
  // ACTUALLY on the row before this call (`taskRow.description_json`)
  // against the document ACTUALLY written (`updated.description_json`,
  // post-sanitisation) — not the raw client input, so a mention that got
  // stripped by sanitiseMentionsForVisibility above is never notified
  // either. Non-fatal (same convention as writeTaskFieldChanges above) and
  // only runs when this call actually touched descriptionJson.
  if (sanitisedDescriptionJson !== undefined) {
    try {
      const newlyMentionedUserIds = extractNewlyMentionedIds(
        taskRow.description_json as JSONContent | null,
        updated.description_json as JSONContent | null,
      );
      await notifyNewlyMentionedUsers({
        taskId: parsed.data.taskId,
        workspaceId,
        authorId: user.id,
        newlyMentionedUserIds,
        supabase,
        admin,
      });
    } catch (notifyError) {
      logger.error("editTask: notifyNewlyMentionedUsers failed (non-fatal)", { error: notifyError });
    }
  }

  const { data: workspaceRow } = await admin
    .from("workspaces")
    .select("slug")
    .eq("id", workspaceId)
    .maybeSingle();

  if (workspaceRow?.slug) {
    try {
      revalidatePath(`/w/${workspaceRow.slug}`, "layout");
    } catch (revalidateError) {
      // Non-fatal cache-freshness rationale, same as createTask above.
      logger.error("editTask: revalidatePath failed (non-fatal)", { error: revalidateError });
    }
  }

  return {
    ok: true,
    data: {
      id: updated.id,
      title: updated.title,
      description: updated.description,
      ...(sanitisedDescriptionJson !== undefined
        ? { descriptionJson: updated.description_json as JSONContent | null }
        : {}),
      priority: updated.priority,
      dueDate: updated.due_date,
      startDate: updated.start_date,
      estimateMinutes: updated.estimate_minutes,
      // F005 (missions/20260903-portal, AS-014): mirrors dueDate/
      // startDate's own always-present convention.
      pageSlug: updated.page_slug,
      pageOrder: updated.page_order,
      // F006c (missions/20260903-portal, AS-013): mirrors pageSlug/
      // pageOrder's own always-present convention above.
      phaseId: updated.phase_id,
    },
  };
}

