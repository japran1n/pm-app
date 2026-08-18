"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { addCommentSchema } from "@/lib/validation/comments";
import { requireActiveMembership } from "@/lib/auth/require-membership";

export type AddCommentResult =
  | {
      ok: true;
      data: {
        id: string;
        taskId: string;
        userId: string;
        text: string;
        createdAt: string;
      };
    }
  | { ok: false; error: string };

// Adds a text comment to a task (AS-094, AS-095). Pattern mirrors
// lib/actions/tasks.ts's createTask: Zod-validated input, membership
// re-checked server-side (defense in depth, AS-143), admin client used for
// the actual insert (RLS on `comments` —
// supabase/migrations/20260818040214_create_comments.sql — would also allow
// this same insert for an active member; the admin client is used here only
// because this action has already independently re-verified membership
// itself, consistent with the rest of this file's siblings),
// discriminated-union return, generic user-facing errors with details only
// logged server-side.
//
// AS-095: an empty/whitespace-only comment is rejected by
// addCommentSchema (trimmed .min(1)) before ever reaching the database,
// mirroring the `comments_text_not_empty` CHECK constraint that is the real
// enforcement boundary.
//
// Comments are task-scoped, and a task has no workspace_id of its own on
// the caller's side — the task's owning project -> workspace is looked up
// server-side so membership is checked against the *real* owning
// workspace, never a workspace_id supplied (or omitted) by the client.
export async function addComment(
  taskId: string,
  text: string,
): Promise<AddCommentResult> {
  const parsed = addCommentSchema.safeParse({ taskId, text });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Enter a valid comment.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to comment." };
  }

  const admin = createAdminClient();

  // Look up the task's owning project/workspace so membership is checked
  // against the real workspace, not one supplied by the caller. Only
  // non-deleted tasks are eligible — a soft-deleted task should behave as
  // "not found" for commenting, same as createTask's project lookup
  // convention.
  const { data: taskRow, error: taskError } = await admin
    .from("tasks")
    .select("id, project_id, deleted_at, projects(workspace_id)")
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

  // Defense in depth: re-check the caller is an active member of the
  // task's workspace, server-side, rather than trusting that the UI only
  // shows the comment form to members of the active workspace (AS-094 —
  // only a workspace member may comment).
  const membership = await requireActiveMembership(
    admin,
    workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to comment on this task.",
    };
  }

  // user_id is set here from the server-verified caller id, never trusted
  // from client input. created_at is left to the column default
  // (supabase/migrations/20260818040214_create_comments.sql sets `default
  // now()`), also never accepted from the client.
  const { data: inserted, error: insertError } = await admin
    .from("comments")
    .insert({
      task_id: parsed.data.taskId,
      user_id: user.id,
      text: parsed.data.text,
    })
    .select("id, task_id, user_id, text, created_at")
    .single();

  if (insertError || !inserted) {
    console.error("addComment: insert failed:", insertError);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
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
      // Same non-fatal cache-freshness rationale as
      // lib/actions/tasks.ts: revalidatePath throws outside an active
      // request/render context (e.g. this action invoked from a test
      // harness). The insert itself already succeeded, so this is not an
      // action failure.
      console.error(
        "addComment: revalidatePath failed (non-fatal):",
        revalidateError,
      );
    }
  }

  return {
    ok: true,
    data: {
      id: inserted.id,
      taskId: inserted.task_id,
      userId: inserted.user_id,
      text: inserted.text,
      createdAt: inserted.created_at,
    },
  };
}
