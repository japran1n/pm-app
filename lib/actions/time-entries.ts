"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  logTimeEntrySchema,
  editTimeEntrySchema,
  deleteTimeEntrySchema,
  type EditTimeEntryUpdates,
} from "@/lib/validation/time-entries";
import {
  requireActiveMembership,
  requireWorkspaceAdmin,
} from "@/lib/auth/require-membership";

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

export type StartTimerResult =
  | {
      ok: true;
      data: { id: string; taskId: string; userId: string; startedAt: string };
    }
  | { ok: false; error: string };

export type StopTimerResult =
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

// startTimer (F111: AS-164, AS-165, AS-166, AS-168): starts a live timer on
// `taskId` for the caller. Membership is re-checked server-side the same
// way as logTimeEntry (F110) — the task's owning workspace is looked up
// and requireActiveMembership re-verified — before ever touching
// active_timers.
//
// AS-165/AS-166: a caller can have at most one active timer at a time
// (enforced at the DB level by the UNIQUE constraint on
// active_timers.user_id — supabase/migrations/20260818151845_create_active_timers.sql).
// If the caller already has a running timer (on any task — the constraint
// is per-user, not per-task), starting a new one must first auto-stop the
// old one: compute its elapsed minutes, log it as a completed time_entries
// row, delete the old active_timers row, THEN insert the new one. That
// whole sequence runs inside a single Postgres function
// (start_timer_atomic, supabase/migrations/20260818153433_create_stop_and_start_timer_rpc.sql)
// rather than as three separate round trips from this action, so a crash
// mid-sequence can never leave two active timers or silently lose the old
// timer's elapsed time — same atomicity pattern as
// create_workspace_with_owner (F013/F095).
//
// The RPC is invoked through the request-scoped (RLS-respecting) client,
// not the admin client: start_timer_atomic is SECURITY DEFINER and sources
// the caller's id from auth.uid() itself, so it must run under the
// caller's own session, never under the service role (which has no
// auth.uid()).
export async function startTimer(taskId: string): Promise<StartTimerResult> {
  if (!taskId || typeof taskId !== "string") {
    return { ok: false, error: "A task is required to start a timer." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to start a timer." };
  }

  const admin = createAdminClient();

  // Same task -> project -> workspace lookup as logTimeEntry, so
  // membership is checked against the task's real owning workspace, never
  // one supplied (or omitted) by the client. Soft-deleted tasks are
  // treated as not found, same convention as logTimeEntry.
  const { data: taskRow, error: taskError } = await admin
    .from("tasks")
    .select("id, deleted_at, projects(workspace_id)")
    .eq("id", taskId)
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

  // Defense in depth (AS-143): re-check the caller is an active member of
  // the task's workspace, server-side, before starting a timer on it.
  const membership = await requireActiveMembership(
    admin,
    workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to start a timer on this task.",
    };
  }

  const { data: rpcRows, error: rpcError } = await supabase.rpc(
    "start_timer_atomic",
    { p_task_id: taskId },
  );

  const started = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;

  if (rpcError || !started) {
    console.error("startTimer: start_timer_atomic failed:", rpcError);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  return {
    ok: true,
    data: {
      id: started.id,
      taskId: started.task_id,
      userId: started.user_id,
      startedAt: started.started_at,
    },
  };
}

// stopTimer (F111: AS-167, AS-168): stops the caller's own active timer,
// if any, and logs it as a completed time_entries row. Elapsed minutes are
// computed server-side inside stop_timer_atomic from the active_timers
// row's own `started_at` against the database's `now()` — never from any
// client-supplied timestamp, which is what makes this resistant to
// clock-skew or client tampering (AS-168's anti-tampering angle).
//
// If the caller has no active timer, this returns a clean `ok: false`
// rather than throwing — stopping a timer that was already stopped (e.g. a
// stale UI, or a duplicate double-click) is an expected, non-exceptional
// case, not a crash.
export async function stopTimer(): Promise<StopTimerResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to stop a timer." };
  }

  const { data: rpcRows, error: rpcError } =
    await supabase.rpc("stop_timer_atomic");

  if (rpcError) {
    console.error("stopTimer: stop_timer_atomic failed:", rpcError);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const stopped = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;

  if (!stopped) {
    return { ok: false, error: "You don't have an active timer running." };
  }

  return {
    ok: true,
    data: {
      id: stopped.id,
      taskId: stopped.task_id,
      userId: stopped.user_id,
      minutes: stopped.minutes,
      billable: stopped.billable,
      entryDate: stopped.entry_date,
      note: stopped.note,
      createdAt: stopped.created_at,
    },
  };
}

export type EditTimeEntryResult =
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
      };
    }
  | { ok: false; error: string };

// editTimeEntry (F112: AS-169). ONLY the entry's own author (caller's
// user_id matches the row's user_id) may edit — not an admin/owner, not
// anyone else. This is deliberately stricter than editTask (AS-061, any
// workspace member) or comments' update RLS (author-or-admin) — a logged
// time entry is a personal record of one's own time; even a workspace
// admin cleaning up team reporting must go through deleteTimeEntry, not
// silently rewrite someone else's hours (see Clarified implementation in
// missions/<id>/features/F112-edit-delete-time-entry-action.md).
//
// Pattern otherwise mirrors editTask: Zod-validated partial update (only
// fields actually present in `updates` are applied — an omitted field
// leaves the existing column value untouched), admin client used for the
// actual update once authorization has been independently verified here,
// discriminated-union return, generic user-facing errors with details only
// logged server-side (AS-146).
//
// Active workspace membership is also re-checked (AS-143 defense in
// depth) ahead of the author check, so a caller who has been removed from
// the workspace (but whose old rows still technically match user_id) is
// rejected the same generic way as a non-author — the error message never
// distinguishes "not the author" from "not a member" to avoid leaking
// which reason applied.
export async function editTimeEntry(
  entryId: string,
  updates: EditTimeEntryUpdates,
): Promise<EditTimeEntryResult> {
  const parsed = editTimeEntrySchema.safeParse({ entryId, updates });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Enter a valid time entry.",
    };
  }

  if (Object.keys(parsed.data.updates).length === 0) {
    return { ok: false, error: "No changes to save." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to edit a time entry." };
  }

  const admin = createAdminClient();

  // Look up the entry together with its task's owning workspace, so
  // membership is checked against the real workspace, not one supplied by
  // the caller.
  const { data: entryRow, error: entryError } = await admin
    .from("time_entries")
    .select("id, user_id, task_id, tasks(deleted_at, projects(workspace_id))")
    .eq("id", parsed.data.entryId)
    .maybeSingle();

  if (entryError || !entryRow) {
    return { ok: false, error: "Time entry not found." };
  }

  const task = entryRow.tasks as
    | { deleted_at: string | null; projects: { workspace_id: string } | { workspace_id: string }[] | null }
    | { deleted_at: string | null; projects: { workspace_id: string } | { workspace_id: string }[] | null }[]
    | null;
  const taskRow = Array.isArray(task) ? task[0] : task;

  if (!taskRow || taskRow.deleted_at) {
    return { ok: false, error: "Time entry not found." };
  }

  const project = taskRow.projects;
  const workspaceId = Array.isArray(project)
    ? project[0]?.workspace_id
    : project?.workspace_id;

  if (!workspaceId) {
    return { ok: false, error: "Time entry not found." };
  }

  const membership = await requireActiveMembership(
    admin,
    workspaceId,
    user.id,
  );

  // AS-169: author-only, no admin/owner override. Checked after (and in
  // addition to) the active-membership re-check above — both must hold.
  if (!membership.ok || entryRow.user_id !== user.id) {
    return {
      ok: false,
      error: "You don't have permission to edit this time entry.",
    };
  }

  const updatePayload: {
    minutes?: number;
    billable?: boolean;
    entry_date?: string;
    note?: string | null;
  } = {};
  if ("minutes" in parsed.data.updates) {
    updatePayload.minutes = parsed.data.updates.minutes;
  }
  if ("billable" in parsed.data.updates) {
    updatePayload.billable = parsed.data.updates.billable;
  }
  if ("entryDate" in parsed.data.updates) {
    updatePayload.entry_date = parsed.data.updates.entryDate;
  }
  if ("note" in parsed.data.updates) {
    updatePayload.note = parsed.data.updates.note;
  }

  const { data: updated, error: updateError } = await admin
    .from("time_entries")
    .update(updatePayload)
    .eq("id", parsed.data.entryId)
    .select("id, task_id, user_id, minutes, billable, entry_date, note")
    .single();

  if (updateError || !updated) {
    console.error("editTimeEntry: update failed:", updateError);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  return {
    ok: true,
    data: {
      id: updated.id,
      taskId: updated.task_id,
      userId: updated.user_id,
      minutes: updated.minutes,
      billable: updated.billable,
      entryDate: updated.entry_date,
      note: updated.note,
    },
  };
}

export type DeleteTimeEntryResult =
  | { ok: true; data: { id: string } }
  | { ok: false; error: string };

// deleteTimeEntry (F112: AS-170). The entry's own author OR a workspace
// admin/owner may delete — unlike editTimeEntry, an admin override is
// allowed here (correcting mistakes in team reporting is the stated
// rationale in the feature spec), reusing requireWorkspaceAdmin for the
// admin/owner half of that check, same helper editTask/deleteTask's
// siblings elsewhere in this codebase rely on for admin-gated actions.
//
// This is a real DELETE, not a soft delete — time_entries has no
// deleted_at column (supabase/migrations/20260818151501_create_time_entries.sql).
export async function deleteTimeEntry(
  entryId: string,
): Promise<DeleteTimeEntryResult> {
  const parsed = deleteTimeEntrySchema.safeParse({ entryId });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid time entry.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to delete a time entry." };
  }

  const admin = createAdminClient();

  const { data: entryRow, error: entryError } = await admin
    .from("time_entries")
    .select("id, user_id, task_id, tasks(deleted_at, projects(workspace_id))")
    .eq("id", parsed.data.entryId)
    .maybeSingle();

  if (entryError || !entryRow) {
    return { ok: false, error: "Time entry not found." };
  }

  const task = entryRow.tasks as
    | { deleted_at: string | null; projects: { workspace_id: string } | { workspace_id: string }[] | null }
    | { deleted_at: string | null; projects: { workspace_id: string } | { workspace_id: string }[] | null }[]
    | null;
  const taskRow = Array.isArray(task) ? task[0] : task;

  if (!taskRow || taskRow.deleted_at) {
    return { ok: false, error: "Time entry not found." };
  }

  const project = taskRow.projects;
  const workspaceId = Array.isArray(project)
    ? project[0]?.workspace_id
    : project?.workspace_id;

  if (!workspaceId) {
    return { ok: false, error: "Time entry not found." };
  }

  const isAuthor = entryRow.user_id === user.id;

  // Author check is independent of (and cheaper than) the admin check —
  // only fall through to requireWorkspaceAdmin (which still re-verifies
  // active membership itself) when the caller isn't the author.
  if (!isAuthor) {
    const adminMembership = await requireWorkspaceAdmin(
      admin,
      workspaceId,
      user.id,
    );
    if (!adminMembership.ok) {
      return {
        ok: false,
        error: "You don't have permission to delete this time entry.",
      };
    }
  } else {
    // Author still must be an active member of the workspace (AS-143
    // defense in depth), same convention as editTimeEntry above.
    const membership = await requireActiveMembership(
      admin,
      workspaceId,
      user.id,
    );
    if (!membership.ok) {
      return {
        ok: false,
        error: "You don't have permission to delete this time entry.",
      };
    }
  }

  const { error: deleteError } = await admin
    .from("time_entries")
    .delete()
    .eq("id", parsed.data.entryId);

  if (deleteError) {
    console.error("deleteTimeEntry: delete failed:", deleteError);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  return { ok: true, data: { id: parsed.data.entryId } };
}
