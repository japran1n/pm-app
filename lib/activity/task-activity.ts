// F195: records `task_activity` entries on every task mutation (AS-354,
// AS-355, AS-356, AS-360).
//
// Two layers, matching this feature's clarified implementation:
//
//   1. A pure, side-effect-free diffing function (`diffTaskFields`) — no
//      React, no Supabase, plain typed inputs in, a plain typed array out.
//      This is the unit-tested core: given a task's field values before
//      and after a mutation, it returns exactly one `TaskFieldChange` per
//      field that actually changed value, using the closed field-name
//      vocabulary F194's migration documents ('title', 'status',
//      'priority', 'due_date', 'estimate', 'assignee_id').
//
//   2. Thin I/O wrappers (`writeTaskFieldChanges`, `writeTaskCommentEvent`)
//      that take an already-authenticated Supabase client and call the
//      `write_task_activity_entry` RPC (F194) for each change/event. These
//      mirror `lib/activity/audit.ts`'s `writeAudit()` shape exactly: a
//      failed write is logged via console.error and swallowed, never
//      thrown — activity is a side effect of the real mutation, not a
//      precondition for it. Kept in this one file (not a separate module)
//      because this feature's Files list names only
//      `lib/activity/task-activity.ts` as new, and splitting the RPC glue
//      into a second file would be an unnamed, out-of-scope addition for
//      no benefit — the diffing function itself has zero imports from
//      Supabase or React and is independently unit-testable regardless of
//      which file the I/O wrapper lives in.
//
// Called from every task-mutating action this feature's spec names:
// editTask, moveTaskStatus, assignTask/addTaskAssignee/removeTaskAssignee/
// setTaskAssignees, bulkUpdateTasks (once per task, not once per batch —
// see this feature's handoff Decisions Made), and the recurrence job
// (generateNextOccurrence), which passes `{ system: true }` so AS-360's
// entries carry a null actor_id.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/supabase/database.types";

// The closed field vocabulary AS-355 names explicitly: status, assignee,
// priority, due date, estimate, title. `assignee_id` and `due_date` are
// the exact DB column/vocabulary names from F194's migration header
// comment — the source of truth F195 must follow.
// F236 (AS-453): "start_date" added to the vocabulary, following the exact
// same "closed field-name vocabulary, DB column name" convention F195's
// header comment establishes for `due_date` above — the
// `write_task_activity_entry` RPC's `p_field` parameter is a plain text
// column with no DB-side CHECK restricting its values, so extending this
// vocabulary is additive and requires no migration.
export type TaskActivityField =
  | "title"
  | "status"
  | "priority"
  | "due_date"
  | "start_date"
  | "estimate"
  | "assignee_id";

// A plain typed snapshot of the six diffable fields, all optional — a
// caller only includes the keys it actually knows about (e.g. editTask
// only includes fields present in its own partial `updates`, per that
// action's existing "only present fields are applied" convention). A key
// absent from BOTH `before` and `after` is never diffed; a key present in
// `after` but absent from `before` is also never diffed (there is no
// prior value to compare against — this is the module's explicit
// "invalid input returns no result rather than a misleading diff" failure
// handling, per this feature's clarified answer).
export type TaskFieldSnapshot = {
  title?: string;
  status?: string;
  priority?: string | null;
  due_date?: string | null;
  start_date?: string | null;
  estimate_minutes?: number | null;
  assignee_id?: string | null;
};

export type TaskFieldChange = {
  field: TaskActivityField;
  oldValue: string | number | null;
  newValue: string | number | null;
};

const FIELD_KEY_MAP: Record<keyof TaskFieldSnapshot, TaskActivityField> = {
  title: "title",
  status: "status",
  priority: "priority",
  due_date: "due_date",
  start_date: "start_date",
  estimate_minutes: "estimate",
  assignee_id: "assignee_id",
};

function snapshotValuesEqual(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
): boolean {
  const normalizedA = a ?? null;
  const normalizedB = b ?? null;
  return normalizedA === normalizedB;
}

/**
 * Pure diff: compares `before` and `after` snapshots of the same task and
 * returns one `TaskFieldChange` per field whose value actually changed.
 * Empty/zero state (per this feature's clarified answer): a snapshot pair
 * with no overlapping keys, or with all overlapping values equal,
 * returns an explicit empty array — never a misleading placeholder entry.
 *
 * Only fields present in BOTH `before` and `after` are compared — a field
 * missing from `before` (no prior value known) is silently skipped rather
 * than treated as a change from `undefined`, since that would fabricate a
 * false "old value" the caller never actually observed.
 */
export function diffTaskFields(
  before: TaskFieldSnapshot,
  after: TaskFieldSnapshot,
): TaskFieldChange[] {
  const changes: TaskFieldChange[] = [];

  for (const key of Object.keys(after) as (keyof TaskFieldSnapshot)[]) {
    if (!(key in before)) continue;

    const oldValue = before[key];
    const newValue = after[key];

    if (snapshotValuesEqual(oldValue, newValue)) continue;

    changes.push({
      field: FIELD_KEY_MAP[key],
      oldValue: oldValue ?? null,
      newValue: newValue ?? null,
    });
  }

  return changes;
}

export type WriteTaskActivityOptions = {
  // AS-360: when true, the RPC is called without requiring an
  // authenticated session and always writes actor_id = null — the
  // recurrence job's "the system did this" attribution. Defaults to
  // false (human-attributed, auth-required), matching F194's RPC default.
  system?: boolean;
};

// Writes one `task_activity` entry (kind: 'field_changed') per change in
// `changes`, via F194's `write_task_activity_entry` RPC. Non-fatal on
// failure, mirroring `writeAudit()`'s exact rationale: an activity write
// is a side effect of the mutation that already succeeded, never a
// precondition for it.
export async function writeTaskFieldChanges(
  supabase: SupabaseClient<Database>,
  taskId: string,
  changes: TaskFieldChange[],
  options?: WriteTaskActivityOptions,
): Promise<void> {
  for (const change of changes) {
    try {
      const { error } = await supabase.rpc("write_task_activity_entry", {
        p_task_id: taskId,
        p_kind: "field_changed",
        p_field: change.field,
        p_old_value: (change.oldValue ?? null) as Json,
        p_new_value: (change.newValue ?? null) as Json,
        p_system: options?.system ?? false,
      });

      if (error) {
        console.error(
          "writeTaskFieldChanges: write_task_activity_entry RPC failed:",
          { taskId, field: change.field, error },
        );
      }
    } catch (unexpectedError) {
      console.error(
        "writeTaskFieldChanges: unexpected failure (non-fatal):",
        { taskId, field: change.field, unexpectedError },
      );
    }
  }
}

// Writes a single `comment_added`/`comment_deleted` event (AS-356). `field`
// is always null for these kinds (per F194's
// task_activity_field_presence_check), and the comment id is carried in
// `new_value` for `comment_added` or `old_value` for `comment_deleted`,
// per F194's documented vocabulary.
export async function writeTaskCommentEvent(
  supabase: SupabaseClient<Database>,
  taskId: string,
  kind: "comment_added" | "comment_deleted",
  commentId: string,
  options?: WriteTaskActivityOptions,
): Promise<void> {
  try {
    const { error } = await supabase.rpc("write_task_activity_entry", {
      p_task_id: taskId,
      p_kind: kind,
      p_old_value:
        kind === "comment_deleted"
          ? ({ comment_id: commentId } as Json)
          : undefined,
      p_new_value:
        kind === "comment_added"
          ? ({ comment_id: commentId } as Json)
          : undefined,
      p_system: options?.system ?? false,
    });

    if (error) {
      console.error(
        "writeTaskCommentEvent: write_task_activity_entry RPC failed:",
        { taskId, kind, commentId, error },
      );
    }
  } catch (unexpectedError) {
    console.error(
      "writeTaskCommentEvent: unexpected failure (non-fatal):",
      { taskId, kind, commentId, unexpectedError },
    );
  }
}
