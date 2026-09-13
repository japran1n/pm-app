"use server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { watchTaskSchema, unwatchTaskSchema } from "@/lib/validation/watchers";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { logger } from "@/lib/observability/logger";
import type { ActionResult } from "@/lib/actions/authz";

// F164: self-serve watch/unwatch Server Actions (AS-295, AS-296). Pattern
// mirrors lib/actions/comments.ts's addComment: Zod-validated input,
// membership re-checked server-side (defense in depth, AS-143),
// discriminated-union return, generic user-facing errors with details
// only logged server-side.
//
// Any active member (including a viewer) may watch/unwatch a task they
// can see -- watching is a personal notification preference, not a
// content mutation, so unlike addComment there is no canWrite gate here.
//
// The actual row write goes through the caller's own authenticated
// session (not the admin client), per the clarified "state location"
// answer -- RLS's `task_watchers_insert_self` / `task_watchers_update_self`
// policies (supabase/migrations/20260822040000_task_watchers.sql,
// 20260822053000_task_watchers_durable_unwatch.sql) already allow a user
// to write their own watcher row, so no service-role bypass is needed for
// this self-serve path (unlike the auto-watch-on-comment path in
// addComment below, which writes on behalf of the commenter using the
// admin client that action already holds).
export type WatchTaskResult = ActionResult<{ taskId: string; isWatching: true }>;

export type UnwatchTaskResult = ActionResult<{ taskId: string; isWatching: false }>;

// Shared lookup: resolves the task's owning workspace and re-verifies the
// caller is an active member of it, server-side, never trusting the UI to
// only show the watch toggle to members. Returns the authenticated user id
// on success. Mirrors addComment's task/workspace lookup convention.
async function resolveTaskAndMembership(
  admin: ReturnType<typeof createAdminClient>,
  taskId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
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

  const membership = await requireActiveMembership(admin, workspaceId, userId);

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to watch this task.",
    };
  }

  return { ok: true };
}

// Watches a task (AS-295's self-serve counterpart). Idempotent no-op if
// already watching -- a no-op still returns ok:true per the clarified
// "empty state" answer (no error toast for an intentional no-op).
export async function watchTask(taskId: string): Promise<WatchTaskResult> {
  const parsed = watchTaskSchema.safeParse({ taskId });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid task.",
    };
  }

  const { supabase, user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to watch a task." };
  }

  const admin = createAdminClient();
  const check = await resolveTaskAndMembership(
    admin,
    parsed.data.taskId,
    user.id,
  );

  if (!check.ok) {
    return check;
  }

  // Self-serve upsert through the caller's own session: creates the row
  // (is_watching defaults true) if none exists, or flips an existing
  // (possibly explicitly-unwatched) row back to is_watching: true. This is
  // the only path that re-enables watching after an explicit unwatch.
  const { error: upsertError } = await supabase
    .from("task_watchers")
    .upsert(
      { task_id: parsed.data.taskId, user_id: user.id, is_watching: true },
      { onConflict: "task_id,user_id" },
    );

  if (upsertError) {
    logger.error("watchTask: upsert failed", { error: upsertError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  return { ok: true, data: { taskId: parsed.data.taskId, isWatching: true } };
}

// Unwatches a task (AS-296). This is the durable opt-out: it flips
// is_watching to false (upserting a row if the caller had never watched at
// all -- clicking "stop watching" on a task you never explicitly watched
// still records an explicit "no", so a later auto-watch-on-comment insert
// (lib/actions/comments.ts's addComment) never silently re-adds this user
// -- see the durability-rule discussion in the F164 handoff's Decisions
// made). Idempotent no-op if already unwatched.
export async function unwatchTask(taskId: string): Promise<UnwatchTaskResult> {
  const parsed = unwatchTaskSchema.safeParse({ taskId });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid task.",
    };
  }

  const { supabase, user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to unwatch a task." };
  }

  const admin = createAdminClient();
  const check = await resolveTaskAndMembership(
    admin,
    parsed.data.taskId,
    user.id,
  );

  if (!check.ok) {
    return check;
  }

  const { error: upsertError } = await supabase
    .from("task_watchers")
    .upsert(
      { task_id: parsed.data.taskId, user_id: user.id, is_watching: false },
      { onConflict: "task_id,user_id" },
    );

  if (upsertError) {
    logger.error("unwatchTask: upsert failed", { error: upsertError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  return {
    ok: true,
    data: { taskId: parsed.data.taskId, isWatching: false },
  };
}
