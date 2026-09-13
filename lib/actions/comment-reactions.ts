"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { toggleReactionSchema } from "@/lib/validation/comment-reactions";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { canWrite } from "@/lib/auth/permissions";
import { logger } from "@/lib/observability/logger";

// F200: toggle a reaction on a comment (AS-367). Pattern mirrors
// lib/actions/watchers.ts / lib/actions/comments.ts: Zod-validated input,
// membership + role re-checked server-side (defense in depth, AS-143),
// discriminated-union return, generic user-facing errors with details only
// logged server-side.
//
// Postgres unique-violation error code, used below to detect the "row
// already exists" branch of the toggle without a separate read.
const POSTGRES_UNIQUE_VIOLATION = "23505";

export type ToggleReactionResult =
  | {
      ok: true;
      data: { commentId: string; emoji: string; reacted: boolean };
    }
  | { ok: false; error: string };

// Resolves the comment's owning task/workspace and re-verifies the caller
// is an active, writable member -- exactly the same shape as
// resolveTaskAndMembership in lib/actions/watchers.ts, but starting from a
// comment id (reactions are comment-scoped, not task-scoped) and additionally
// requiring canWrite (per the clarified "access control" answer): reacting
// is a content mutation like commenting, not a read-only preference like
// watching, so a viewer may see reactions (RLS SELECT) but not add/remove
// one -- mirrors addComment's canWrite gate in lib/actions/comments.ts.
async function resolveCommentAndMembership(
  admin: ReturnType<typeof createAdminClient>,
  commentId: string,
  userId: string,
): Promise<
  | { ok: true; taskId: string; workspaceId: string }
  | { ok: false; error: string }
> {
  const { data: commentRow, error: commentError } = await admin
    .from("comments")
    .select("id, deleted_at, tasks(id, projects(workspace_id))")
    .eq("id", commentId)
    .is("deleted_at", null)
    .maybeSingle();

  if (commentError || !commentRow) {
    return { ok: false, error: "Comment not found." };
  }

  const task = commentRow.tasks as
    | { id: string; projects: { workspace_id: string } | { workspace_id: string }[] | null }
    | { id: string; projects: { workspace_id: string } | { workspace_id: string }[] | null }[]
    | null;
  const taskRow = Array.isArray(task) ? task[0] : task;
  const project = taskRow?.projects;
  const workspaceId = Array.isArray(project)
    ? project[0]?.workspace_id
    : project?.workspace_id;
  const taskId = taskRow?.id;

  if (!workspaceId || !taskId) {
    return { ok: false, error: "Comment not found." };
  }

  const membership = await requireActiveMembership(admin, workspaceId, userId);

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to react to this comment.",
    };
  }

  if (!canWrite({ role: membership.role })) {
    return {
      ok: false,
      error: "Viewers don't have permission to react to comments.",
    };
  }

  return { ok: true, taskId, workspaceId };
}

// Toggles the caller's own reaction of `emoji` on `commentId` (AS-367:
// clicking an existing reaction removes it).
//
// Idempotent-toggle implementation (per the clarified ambiguity-resolution
// answer -- simpler option, no new dependency, database constraint decides
// the final state, not the client):
//
// Always ATTEMPT AN INSERT first, through the caller's own authenticated
// session so RLS's self-only `comment_reactions_insert_self` /
// `comment_reactions_delete_self` policies are the real enforcement
// boundary (mirrors watchTask/unwatchTask's self-serve-via-own-session
// pattern in lib/actions/watchers.ts -- no admin-client bypass is needed
// for a user's own reaction row).
//
//   - If the insert succeeds, the row didn't exist a moment ago: the
//     caller is now reacted (reacted: true).
//   - If the insert fails with Postgres unique-violation 23505, the
//     composite primary key (comment_id, user_id, emoji) from F199's
//     migration says a row for this exact (comment, user, emoji) already
//     exists -- so DELETE it, converging to reacted: false.
//   - Any other insert error is unexpected and mapped to a generic
//     message (never a raw database error surfaced to the user).
//
// This is safe against a rapid double-click / two-tab race for the SAME
// caller+comment+emoji: two concurrent toggle calls when no row exists
// both attempt insert; the database's primary key (not a client-side
// read-then-branch) decides which one succeeds, and the other one's
// unique-violation is caught here and converted into a delete rather than
// crashing or double-inserting. The two calls may return different
// `reacted` values to their own caller (whichever "won" the insert saw
// reacted:true, the one that lost and then deleted saw reacted:false),
// but the row ends up in exactly one final state (absent) either way --
// no duplicate-key crash, no split-brain row, no double-toggle back to
// "reacted" from two clicks. A caller can always re-toggle again if the
// UI's own optimistic state and the server's returned `reacted` disagree.
export async function toggleReaction(
  commentId: string,
  emoji: string,
): Promise<ToggleReactionResult> {
  const parsed = toggleReactionSchema.safeParse({ commentId, emoji });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid reaction.",
    };
  }

  const { supabase, user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to react to a comment." };
  }

  const admin = createAdminClient();
  const check = await resolveCommentAndMembership(
    admin,
    parsed.data.commentId,
    user.id,
  );

  if (!check.ok) {
    return check;
  }

  const row = {
    comment_id: parsed.data.commentId,
    user_id: user.id,
    emoji: parsed.data.emoji,
    // F305 (AS-369): denormalized from the comment's own task_id so the
    // reactions realtime subscription can filter server-side on
    // `task_id=eq.<taskId>`. RLS's comment_reactions_insert_self (F305
    // migration) independently re-verifies this matches the comment's
    // real task_id, so a caller can't smuggle a mismatched value in.
    task_id: check.taskId,
  };

  const { error: insertError } = await supabase
    .from("comment_reactions")
    .insert(row);

  let reacted: boolean;

  if (!insertError) {
    reacted = true;
  } else if (insertError.code === POSTGRES_UNIQUE_VIOLATION) {
    const { error: deleteError } = await supabase
      .from("comment_reactions")
      .delete()
      .eq("comment_id", row.comment_id)
      .eq("user_id", row.user_id)
      .eq("emoji", row.emoji);

    if (deleteError) {
      logger.error("toggleReaction: delete-after-conflict failed", { error: deleteError });
      return {
        ok: false,
        error: "Something went wrong. Please try again in a moment.",
      };
    }

    reacted = false;
  } else {
    logger.error("toggleReaction: insert failed", { error: insertError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const { data: workspaceRow } = await admin
    .from("workspaces")
    .select("slug")
    .eq("id", check.workspaceId)
    .maybeSingle();

  if (workspaceRow?.slug) {
    try {
      revalidatePath(`/w/${workspaceRow.slug}`, "layout");
    } catch (revalidateError) {
      // Non-fatal cache-freshness rationale, same as addComment in
      // lib/actions/comments.ts.
      logger.error("toggleReaction: revalidatePath failed (non-fatal)", { error: revalidateError });
    }
  }

  return {
    ok: true,
    data: { commentId: parsed.data.commentId, emoji: parsed.data.emoji, reacted },
  };
}
