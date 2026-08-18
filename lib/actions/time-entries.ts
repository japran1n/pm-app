"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logTimeEntrySchema } from "@/lib/validation/time-entries";
import { requireActiveMembership } from "@/lib/auth/require-membership";

export type LogTimeEntryResult =
  | {
      ok: true;
      data: {
        id: string;
        taskId: string;
        userId: string;
        minutes: number;
        billable: boolean;
        entryDate: string;
        note: string | null;
        createdAt: string;
      };
    }
  | { ok: false; error: string };

// Logs a manual time entry on a task (F110: AS-161, AS-162, AS-163).
// Pattern mirrors lib/actions/comments.ts's addComment / lib/actions/
// tasks.ts's createTask: Zod-validated input, membership re-checked
// server-side (defense in depth, AS-143), admin client used for the actual
// insert (RLS on `time_entries` —
// supabase/migrations/20260818151501_create_time_entries.sql — would also
// allow this same insert for an active member; the admin client is used
// here only because this action has already independently re-verified
// membership itself, consistent with the rest of this codebase's actions),
// discriminated-union return, generic user-facing errors with details only
// logged server-side (AS-146).
//
// AS-162: zero/negative (and non-integer) minutes are rejected by
// logTimeEntrySchema before ever reaching the database, mirroring the
// `time_entries_minutes_positive` CHECK constraint, which is the real
// enforcement boundary.
//
// Time entries are task-scoped, and a task has no workspace_id of its own
// on the caller's side — the task's owning project -> workspace is looked
// up server-side so membership is checked against the *real* owning
// workspace, never a workspace_id supplied (or omitted) by the client
// (AS-163: a member cannot log time on a task outside their own workspace,
// even via direct API access — this lookup plus the requireActiveMembership
// re-check is the primary enforcement here since the admin client bypasses
// RLS; the time_entries_insert_active_members RLS policy is defense in
// depth behind it).
export async function logTimeEntry(
  taskId: string,
  minutes: number,
  billable: boolean,
  entryDate: string,
  note?: string,
): Promise<LogTimeEntryResult> {
  const parsed = logTimeEntrySchema.safeParse({
    taskId,
    minutes,
    billable,
    entryDate,
    note,
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Enter a valid time entry.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to log time." };
  }

  const admin = createAdminClient();

  // Look up the task's owning project/workspace so membership is checked
  // against the real workspace, not one supplied by the caller. Only
  // non-deleted tasks are eligible — a soft-deleted task should behave as
  // "not found" for time logging, same as addComment's task lookup
  // convention.
  const { data: taskRow, error: taskError } = await admin
    .from("tasks")
    .select("id, deleted_at, projects(workspace_id)")
    .eq("id", parsed.data.taskId)
    .is("deleted_at", null)
    .maybeSingle();

  if (taskError || !taskRow) {
    return { ok: false, error: "Task not found." };
  }

  const project = taskRow.projects as
    | { workspace_id: string }
    | { workspace_id: string }[]
    | null;
  const workspaceId = Array.isArray(project)
    ? project[0]?.workspace_id
    : project?.workspace_id;

  if (!workspaceId) {
    return { ok: false, error: "Task not found." };
  }

  // Defense in depth (AS-143, AS-163): re-check the caller is an active
  // member of the task's workspace, server-side, rather than trusting that
  // the UI only shows the log-time form to members of the active
  // workspace.
  const membership = await requireActiveMembership(
    admin,
    workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to log time on this task.",
    };
  }

  // user_id is set here from the server-verified caller id, never trusted
  // from client input. created_at/updated_at are left to their column
  // defaults (supabase/migrations/20260818151501_create_time_entries.sql).
  const { data: inserted, error: insertError } = await admin
    .from("time_entries")
    .insert({
      task_id: parsed.data.taskId,
      user_id: user.id,
      minutes: parsed.data.minutes,
      billable: parsed.data.billable,
      entry_date: parsed.data.entryDate,
      note: parsed.data.note ?? null,
    })
    .select("id, task_id, user_id, minutes, billable, entry_date, note, created_at")
    .single();

  if (insertError || !inserted) {
    console.error("logTimeEntry: insert failed:", insertError);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  return {
    ok: true,
    data: {
      id: inserted.id,
      taskId: inserted.task_id,
      userId: inserted.user_id,
      minutes: inserted.minutes,
      billable: inserted.billable,
      entryDate: inserted.entry_date,
      note: inserted.note,
      createdAt: inserted.created_at,
    },
  };
}
