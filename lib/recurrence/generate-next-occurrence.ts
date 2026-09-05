import { logger } from "@/lib/observability/logger";

// F177 (AS-315, AS-320, AS-321): generates the next occurrence of a
// recurring task when it completes. Pure orchestration over the pieces
// F175/F176 already built (`recurrence`/`recurrence_parent_id`/
// `last_occurrence_at` columns, `nextOccurrenceDate`, `cloneTaskFields`) —
// this module is the one place that actually performs the write, called
// from `moveTaskStatus` (lib/actions/tasks.ts) in the same logical unit as
// the status-change write, per this feature's Clarified implementation.
//
// This module takes an already-created admin Supabase client (never
// constructs its own — the caller has already authenticated/authorized
// the status change; this module trusts that and focuses purely on
// generation), matching the "no new parallel implementation" convention
// every sibling action in lib/actions/tasks.ts follows for cross-cutting
// helpers (see e.g. syncMirrorAssigneeId).
import type { SupabaseClient } from "@supabase/supabase-js";
import { calculatePosition } from "@/lib/board/position";
import {
  cloneTaskFields,
  RECURRENCE_INITIAL_STATUS,
} from "@/lib/recurrence/clone-fields";
import { nextOccurrenceDate, type RecurrenceRule } from "@/lib/recurrence/next-date";
import type { Json } from "@/lib/supabase/database.types";

export type SourceTaskForRecurrence = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  description_json: unknown | null;
  priority: string | null;
  estimate_minutes: number | null;
  due_date: string | null;
  recurrence: unknown | null;
  recurrence_parent_id: string | null;
  // F116 (AS-058): carried straight through to the generated occurrence
  // — never re-defaulted to 'delivery' (see this file's own insert
  // below).
  task_type_id: string;
};

export type GenerateNextOccurrenceResult =
  | { generated: true; taskId: string; dueDate: string }
  // `skipped` covers every reason generation legitimately does nothing:
  // no recurrence rule, no due date to advance from, an invalid/exhausted
  // rule (past `until`), an archived project (AS-321), or a
  // constraint-level duplicate (AS-320) — none of these are failures of
  // the status change itself, which must still succeed either way.
  | { generated: false; reason: string };

/**
 * Generates the next occurrence of `source` if (and only if) it is a
 * recurring task with a due date to advance from, its project isn't
 * archived (AS-321), and no occurrence for the computed next due date
 * already exists for this series (AS-320, enforced at the database level
 * by the `tasks_recurrence_occurrence_idempotency` partial unique index —
 * this function's own pre-check is a fast path only, never the sole
 * guarantee).
 *
 * Never throws for an expected "nothing to do" case — returns
 * `{ generated: false, reason }` instead, so the caller (moveTaskStatus)
 * can let the status write succeed regardless.
 */
export async function generateNextOccurrence(
  admin: SupabaseClient,
  source: SourceTaskForRecurrence,
  actorId: string,
  timezone: string,
): Promise<GenerateNextOccurrenceResult> {
  if (!source.recurrence || typeof source.recurrence !== "object") {
    return { generated: false, reason: "not a recurring task" };
  }

  if (!source.due_date) {
    // Nothing to advance from — this task's series has no due date on any
    // occurrence, so there is no calendar anchor to compute a next date
    // against. Documented autonomous decision (spec doesn't cover this
    // edge case explicitly): skip silently rather than invent a "today"
    // anchor, since that would make the next due date depend on WHEN the
    // task happens to be completed rather than its own schedule.
    return { generated: false, reason: "source task has no due date" };
  }

  // AS-321: a recurring task in an archived project generates nothing —
  // completing the task itself still succeeds (the caller performs that
  // write independently; this function is purely additive).
  const { data: projectRow } = await admin
    .from("projects")
    .select("id, deleted_at")
    .eq("id", source.project_id)
    .maybeSingle();

  if (!projectRow || projectRow.deleted_at) {
    return { generated: false, reason: "project is archived" };
  }

  const nextDueDate = nextOccurrenceDate(
    source.recurrence as RecurrenceRule,
    source.due_date,
    timezone,
  );

  if (!nextDueDate) {
    return {
      generated: false,
      reason: "no further occurrence (invalid rule or past `until`)",
    };
  }

  // The ROOT of the series, never the immediately-completing task, so
  // repeated completions of occurrence N, N+1, N+2... of the SAME series
  // all collide against ONE recurrence_parent_id value in the DB-level
  // unique index (see the migration's own comment for the full rationale).
  const rootParentId = source.recurrence_parent_id ?? source.id;

  const [assigneesResult, checklistResult] = await Promise.all([
    admin
      .from("task_assignees")
      .select("user_id")
      .eq("task_id", source.id),
    admin
      .from("checklist_items")
      .select("content, position")
      .eq("task_id", source.id)
      .order("position", { ascending: true }),
  ]);

  const cloned = cloneTaskFields({
    title: source.title,
    description: source.description,
    description_json: source.description_json,
    assigneeIds: (assigneesResult.data ?? []).map(
      (row) => row.user_id as string,
    ),
    priority: source.priority,
    checklistItems: (checklistResult.data ?? []).map((row) => ({
      content: row.content as string,
      position: row.position as number,
    })),
    estimate_minutes: source.estimate_minutes,
  });

  // Appended to the end of the new occurrence's (project, todo) column —
  // same convention createTaskForUser uses for a brand-new task.
  const { data: lastInColumn } = await admin
    .from("tasks")
    .select("position")
    .eq("project_id", source.project_id)
    .eq("status", RECURRENCE_INITIAL_STATUS)
    .is("deleted_at", null)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const newPosition = calculatePosition(lastInColumn?.position ?? null, null);

  // AS-320: ON CONFLICT DO NOTHING against the DB-level unique constraint
  // `tasks_recurrence_occurrence_idempotency` (recurrence_parent_id,
  // due_date) — this is the real idempotency guarantee, not just the
  // due-date lookup above (which is a fast path only and still races under
  // concurrent requests without this). A non-partial constraint is used
  // (not a partial index) because PostgREST's `.upsert(...,
  // { onConflict })` issues a plain `ON CONFLICT (columns)` with no WHERE
  // clause, which only a full unique constraint/index can serve as an
  // arbiter for (see the migration's own comment for the full story).
  const { data: inserted, error: insertError } = await admin
    .from("tasks")
    .upsert(
      {
        project_id: source.project_id,
        title: cloned.title,
        description: cloned.description,
        description_json: cloned.description_json as Json,
        status: cloned.status,
        priority: cloned.priority,
        estimate_minutes: cloned.estimate_minutes,
        due_date: nextDueDate,
        author_id: actorId,
        position: newPosition,
        recurrence: source.recurrence as Json,
        recurrence_parent_id: rootParentId,
        task_type_id: source.task_type_id,
      },
      {
        onConflict: "recurrence_parent_id,due_date",
        ignoreDuplicates: true,
      },
    )
    .select("id, due_date")
    .maybeSingle();

  if (insertError) {
    logger.error("generateNextOccurrence: insert failed", { error: insertError });
    return { generated: false, reason: "insert failed" };
  }

  if (!inserted) {
    // ignoreDuplicates: true means a conflicting row returns no data —
    // AS-320's duplicate-completion case, absorbed cleanly.
    return { generated: false, reason: "occurrence already exists" };
  }

  if (cloned.checklistItems.length > 0) {
    const { error: checklistInsertError } = await admin
      .from("checklist_items")
      .insert(
        cloned.checklistItems.map((item) => ({
          task_id: inserted.id,
          content: item.content,
          position: item.position,
        })),
      );
    if (checklistInsertError) {
      logger.error("generateNextOccurrence: checklist insert failed", { error: checklistInsertError });
    }
  }

  if (cloned.assigneeIds.length > 0) {
    const { error: assigneeInsertError } = await admin
      .from("task_assignees")
      .insert(
        cloned.assigneeIds.map((assigneeId) => ({
          task_id: inserted.id,
          user_id: assigneeId,
          assigned_by: actorId,
        })),
      );
    if (assigneeInsertError) {
      logger.error("generateNextOccurrence: assignee insert failed", { error: assigneeInsertError });
    }
  }

  // last_occurrence_at tracks the series root, updated best-effort — not
  // itself part of the idempotency guarantee (the unique index is), so a
  // failure here doesn't affect the result.
  await admin
    .from("tasks")
    .update({ last_occurrence_at: new Date().toISOString() })
    .eq("id", rootParentId);

  // F195 (AS-360): the new occurrence's own creation is a SYSTEM action,
  // distinct from the human `actorId` who completed the prior occurrence
  // and triggered this generation — recorded with `p_system: true` so the
  // RPC writes `actor_id = null` regardless of who is authenticated in
  // this request. Recorded as a 'due_date' field_changed entry (old value
  // null — the occurrence didn't exist before this call — new value the
  // computed due date) since the closed `kind` vocabulary (F194) has no
  // dedicated "task created" kind and 'field_changed' is the closest
  // fit for "this occurrence now has a due date, set by the system".
  // Non-fatal on failure, same rationale as every other activity write in
  // this feature: the occurrence has already been created successfully.
  try {
    const { error: activityError } = await admin.rpc(
      "write_task_activity_entry",
      {
        p_task_id: inserted.id,
        p_kind: "field_changed",
        p_field: "due_date",
        p_old_value: null,
        p_new_value: inserted.due_date as Json,
        p_system: true,
      },
    );
    if (activityError) {
      logger.error("generateNextOccurrence: write_task_activity_entry RPC failed (non-fatal)", { error: activityError });
    }
  } catch (unexpectedActivityError) {
    logger.error("generateNextOccurrence: activity write unexpected failure (non-fatal)", { error: unexpectedActivityError });
  }

  return { generated: true, taskId: inserted.id, dueDate: inserted.due_date as string };
}
