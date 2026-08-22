"use server";

import { revalidatePath } from "next/cache";
import type { JSONContent } from "@tiptap/react";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  addCommentSchema,
  commentBodyJsonSchema,
  deleteCommentSchema,
  restoreCommentSchema,
} from "@/lib/validation/comments";
import { docFromPlainText, extractPlainText } from "@/lib/comments/rich-text";
import {
  requireActiveMembership,
  requireWorkspaceAdmin,
} from "@/lib/auth/require-membership";
import { canWrite } from "@/lib/auth/permissions";

export type AddCommentResult =
  | {
      ok: true;
      data: {
        id: string;
        taskId: string;
        userId: string;
        text: string;
        /** F174 (AS-312): the Tiptap JSONContent document actually
         * stored/rendered for this comment. */
        bodyJson: JSONContent;
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
// F174 (AS-312): `bodyJson` is optional so every existing caller of this
// action (tests, watcher/auto-watch flows, rls-viewer tests) that only
// ever passed a plain string keeps working unchanged — when omitted, the
// comment is stored as the same single-paragraph wrap shape F170 already
// established for descriptions (docFromPlainText), so a comment posted
// without rich formatting round-trips identically to before this feature.
// components/task/comment-list.tsx's rich-text composer now passes both:
// `text` (the plain-text projection, computed client-side via
// extractPlainText, used only for the pre-flight non-empty check) and
// `bodyJson` (the real Tiptap document, re-validated + the authoritative
// plain-text projection recomputed server-side below rather than trusted
// from the client).
export async function addComment(
  taskId: string,
  text: string,
  bodyJson?: JSONContent | null,
): Promise<AddCommentResult> {
  const parsed = addCommentSchema.safeParse({ taskId, text });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Enter a valid comment.",
    };
  }

  // F174: validate the rich-text payload's basic shape (defense in depth
  // — the real security boundary is RichTextRenderer's sanitiseDocument,
  // re-applied on every render regardless of what's stored, per
  // lib/comments/rich-text.ts's doc comment). An invalid/malformed
  // bodyJson silently falls back to wrapping the validated plain text,
  // rather than failing the whole submission — the plain text has already
  // passed addCommentSchema, so the comment can still be posted.
  const bodyJsonParsed = bodyJson
    ? commentBodyJsonSchema.safeParse(bodyJson)
    : null;
  const validatedBodyJson: JSONContent = bodyJsonParsed?.success
    ? (bodyJsonParsed.data as JSONContent)
    : docFromPlainText(parsed.data.text);

  // Authoritative plain-text projection, recomputed server-side from the
  // validated rich-text document — never trusts a client-supplied `text`
  // value alone as the thing that gets persisted, only as the pre-flight
  // non-empty check above. Falls back to the validated plain text if the
  // rich document projects to nothing (e.g. a formatting-only document),
  // so comments_text_not_empty is never violated by a real submission
  // that already passed the schema's own non-empty check.
  const projectedText =
    extractPlainText(validatedBodyJson) || parsed.data.text;

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

  // F128 (AS-216, AS-217): viewers are read-only (canWrite deliberately
  // does not exclude guest — see its doc comment in lib/auth/permissions.ts;
  // guest write access is separately scoped by F134's AS-223).
  if (!canWrite({ role: membership.role })) {
    return {
      ok: false,
      error: "Viewers don't have permission to comment.",
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
      // F174: `text` (legacy, still required by comments_text_not_empty)
      // and `body_text` are kept identical — both are the same
      // server-recomputed projection, never two independently-trusted
      // values.
      text: projectedText,
      body_json: validatedBodyJson,
      body_text: projectedText,
    })
    .select("id, task_id, user_id, text, body_json, created_at")
    .single();

  if (insertError || !inserted) {
    console.error("addComment: insert failed:", insertError);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  // F164 (AS-295): commenting on a task adds the commenter as a watcher,
  // idempotently. Uses the admin client (service role) rather than the
  // caller's own session because this is a write "on behalf of" the
  // commenter as a side effect of another action, not the self-serve
  // watch/unwatch path (lib/actions/watchers.ts) -- avoids needing a
  // SECURITY DEFINER trigger for this one call site, consistent with the
  // rest of this file already using the admin client for the primary
  // insert.
  //
  // Durability rule (AS-296, see F164 handoff's Decisions made for full
  // reasoning): `ignoreDuplicates: true` compiles to
  // `INSERT ... ON CONFLICT (task_id, user_id) DO NOTHING`. If the
  // commenter has never had a task_watchers row, this inserts one with
  // `is_watching: true` (default). If a row already exists -- whether
  // still watching or explicitly unwatched via unwatchTask -- the insert
  // is a no-op and that existing state, including an explicit opt-out, is
  // left untouched. This is what makes an explicit unwatch durable across
  // a later comment by the same user, rather than being silently
  // resurrected.
  const { error: watcherError } = await admin.from("task_watchers").upsert(
    { task_id: parsed.data.taskId, user_id: user.id, is_watching: true },
    { onConflict: "task_id,user_id", ignoreDuplicates: true },
  );

  if (watcherError) {
    // Non-fatal: the comment itself already succeeded. Auto-watch is a
    // best-effort side effect, not the source of truth for whether the
    // comment was posted (mirrors the non-fatal revalidatePath/broadcast
    // handling elsewhere in this file).
    console.error(
      "addComment: auto-watch upsert failed (non-fatal):",
      watcherError,
    );
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
      bodyJson: (inserted.body_json as JSONContent | null) ?? validatedBodyJson,
      createdAt: inserted.created_at,
    },
  };
}

export type DeleteCommentResult =
  | { ok: true; data: { id: string; deletedAt: string } }
  | { ok: false; error: string };

// Soft-deletes a comment (F061: AS-098, AS-099, AS-100). Pattern mirrors
// deleteTask in lib/actions/tasks.ts: Zod-validated input, membership
// re-checked server-side (defense in depth, AS-143), admin client used for
// the actual update, discriminated union return, generic user-facing
// errors with details only logged server-side (AS-146).
//
// Unlike deleteTask (any active member may delete), this action is
// authorization-gated per AS-098/AS-099/AS-100: only the comment's own
// author OR an admin/owner of the workspace that (transitively) owns the
// comment's task may delete it. A different regular member is rejected
// server-side even if they somehow invoke this action directly (AS-099)
// — the RLS `comments_update_author_or_admin` policy
// (supabase/migrations/20260818041550_rls_comments_delete_update.sql)
// backs this up as defense in depth, but this action's own check is the
// primary enforcement since the admin client bypasses RLS.
//
// The comment's owning task/project/workspace is looked up server-side
// (never trusted from the client) so this authorization check runs
// against the *real* owning workspace, same convention as addComment.
export async function deleteComment(
  commentId: string,
): Promise<DeleteCommentResult> {
  const parsed = deleteCommentSchema.safeParse({ commentId });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid comment.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to delete a comment." };
  }

  const admin = createAdminClient();

  // Look up the comment's owning task/project/workspace, and its author,
  // so both the authorization check and "not found" behaviour are based
  // on real server-side data. An already-deleted comment behaves as "not
  // found" (idempotent-safe), same convention as deleteTask.
  const { data: commentRow, error: commentError } = await admin
    .from("comments")
    .select("id, user_id, deleted_at, tasks(id, projects(workspace_id))")
    .eq("id", parsed.data.commentId)
    .is("deleted_at", null)
    .maybeSingle();

  if (commentError || !commentRow) {
    return { ok: false, error: "Comment not found." };
  }

  const task = commentRow.tasks as
    | {
        id: string;
        projects: { workspace_id: string } | { workspace_id: string }[] | null;
      }
    | {
        id: string;
        projects: { workspace_id: string } | { workspace_id: string }[] | null;
      }[]
    | null;
  const taskRow = Array.isArray(task) ? task[0] : task;
  const project = taskRow?.projects;
  const workspaceId = Array.isArray(project)
    ? project[0]?.workspace_id
    : project?.workspace_id;
  const commentTaskId = taskRow?.id;

  if (!workspaceId || !commentTaskId) {
    return { ok: false, error: "Comment not found." };
  }

  const isAuthor = commentRow.user_id === user.id;

  // AS-098: the comment's own author may always delete it, regardless of
  // role. AS-100: a workspace admin/owner may delete any comment in their
  // workspace, regardless of authorship. AS-099: anyone else — a
  // different regular member — is rejected.
  if (!isAuthor) {
    const adminMembership = await requireWorkspaceAdmin(
      admin,
      workspaceId,
      user.id,
    );
    if (!adminMembership.ok) {
      return {
        ok: false,
        error: "You don't have permission to delete this comment.",
      };
    }
  } else {
    // Even the author must still be an active member (defense in depth —
    // e.g. a removed member should not retain delete rights on their old
    // comments).
    const membership = await requireActiveMembership(
      admin,
      workspaceId,
      user.id,
    );
    if (!membership.ok) {
      return {
        ok: false,
        error: "You don't have permission to delete this comment.",
      };
    }
    // F128 (AS-216, AS-217): even the comment's own author must currently
    // be a writable role — a member later demoted to viewer loses delete
    // rights on their own old comments (defense in depth, shouldn't
    // practically occur since a viewer can no longer author new ones, but
    // a pre-existing comment from before the role change is still
    // possible). Deliberately `canWrite` (viewer-only), not a viewer+guest
    // exclusion — a guest may still delete their own comment per AS-223's
    // guest-can-comment allowance.
    if (!canWrite({ role: membership.role })) {
      return {
        ok: false,
        error: "Viewers don't have permission to delete comments.",
      };
    }
  }

  // F188/AS-347: `deleted_by` stamped on the same update as `deleted_at`
  // so the trash view can show who deleted this comment.
  const { data: deleted, error: deleteError } = await admin
    .from("comments")
    .update({ deleted_at: new Date().toISOString(), deleted_by: user.id })
    .eq("id", parsed.data.commentId)
    .select("id, deleted_at")
    .single();

  if (deleteError || !deleted || !deleted.deleted_at) {
    console.error("deleteComment: update failed:", deleteError);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  // F104 (AS-101 fix): notify live viewers via Realtime Broadcast instead
  // of relying on postgres_changes for this event. postgres_changes
  // re-evaluates the `comments_select_active_members` SELECT RLS policy
  // against the row's NEW state for UPDATE events — and this soft-delete's
  // new state (deleted_at now set) fails that same policy's
  // `deleted_at is null` clause, so postgres_changes silently drops the
  // delete event for every subscriber, not just the deleter (this was the
  // confirmed AS-101 bug: scrutiny-validator M6-scrutiny.md). Broadcast
  // delivery doesn't depend on the row still passing a read policy, so it
  // isn't affected by this class of bug.
  //
  // Security note: broadcast messages on this channel are NOT gated by
  // Postgres RLS at the transport level the way postgres_changes is. This
  // is acceptable here because the channel name embeds task_id
  // (`comments:<taskId>`) and the only client code that ever subscribes to
  // it (components/task/use-comments-realtime.ts, invoked from
  // comment-list.tsx inside task-detail-sheet.tsx) only does so for a task
  // the current user is already independently authorized to view via the
  // normal RLS-gated page/data-fetch path — a client never learns a
  // taskId, and therefore never subscribes to its channel, without having
  // already passed that check. The payload itself (a bare comment id) also
  // carries no sensitive data beyond what a subscriber could already infer
  // from having the task open.
  try {
    const broadcastChannel = supabase.channel(`comments:${commentTaskId}`);
    await broadcastChannel.send({
      type: "broadcast",
      event: "comment_deleted",
      payload: { id: deleted.id },
    });
    await supabase.removeChannel(broadcastChannel);
  } catch (broadcastError) {
    // Non-fatal: the soft-delete itself already succeeded (this is a
    // best-effort live-propagation notification, not the source of
    // truth — AS-102/reload always reflects the real deleted_at state
    // via RLS regardless of whether this broadcast is delivered).
    console.error(
      "deleteComment: broadcast failed (non-fatal):",
      broadcastError,
    );
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
      // Non-fatal cache-freshness rationale, same as addComment above.
      console.error(
        "deleteComment: revalidatePath failed (non-fatal):",
        revalidateError,
      );
    }
  }

  return {
    ok: true,
    data: {
      id: deleted.id,
      deletedAt: deleted.deleted_at,
    },
  };
}

export type RestoreCommentResult =
  | {
      ok: true;
      data: {
        id: string;
        taskId: string;
        userId: string;
        text: string;
        bodyJson: JSONContent;
        createdAt: string;
      };
    }
  | { ok: false; error: string };

// Restores a soft-deleted comment (F191: AS-346). Pattern and
// authorization rule mirror deleteComment above exactly (same
// "author OR workspace admin/owner" gate, F127's canWrite re-check for the
// author path, same server-side owning-task/project/workspace lookup, same
// discriminated-union / generic-error convention) — restoring is treated
// as the inverse of the same permission decision that let someone delete
// in the first place, which is also this feature's own clarified default
// (F191 clarification: "same class of problem" as F104's delete-broadcast
// fix, mirrored here for symmetry rather than inventing a separate rule).
//
// Unlike deleteComment's lookup (`.is("deleted_at", null)`, so an
// already-deleted comment behaves as "not found"), this lookup has NO
// deleted_at filter — it must find the row precisely because it IS
// deleted. A row that exists but is already active (deleted_at already
// null) is treated as a no-op success per this feature's own Clarified
// "empty / zero state" answer (inherited from the shared action-archetype
// defaults in the clarification file): restoring something that's already
// restored isn't an error, and the UI shows no error toast for it.
export async function restoreComment(
  commentId: string,
): Promise<RestoreCommentResult> {
  const parsed = restoreCommentSchema.safeParse({ commentId });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid comment.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to restore a comment." };
  }

  const admin = createAdminClient();

  const { data: commentRow, error: commentError } = await admin
    .from("comments")
    .select(
      "id, task_id, user_id, text, body_json, created_at, deleted_at, tasks(id, projects(workspace_id))",
    )
    .eq("id", parsed.data.commentId)
    .maybeSingle();

  if (commentError || !commentRow) {
    return { ok: false, error: "Comment not found." };
  }

  const task = commentRow.tasks as
    | {
        id: string;
        projects: { workspace_id: string } | { workspace_id: string }[] | null;
      }
    | {
        id: string;
        projects: { workspace_id: string } | { workspace_id: string }[] | null;
      }[]
    | null;
  const taskRow = Array.isArray(task) ? task[0] : task;
  const project = taskRow?.projects;
  const workspaceId = Array.isArray(project)
    ? project[0]?.workspace_id
    : project?.workspace_id;
  const commentTaskId = taskRow?.id;

  if (!workspaceId || !commentTaskId) {
    return { ok: false, error: "Comment not found." };
  }

  const isAuthor = commentRow.user_id === user.id;

  // Same three-way rule as deleteComment (AS-098/AS-099/AS-100's
  // counterpart for restore, both covered by AS-346's "author or admin"
  // wording): the comment's own author, or a workspace admin/owner, may
  // restore it. Any other regular member is rejected server-side even if
  // they call this action directly.
  if (!isAuthor) {
    const adminMembership = await requireWorkspaceAdmin(
      admin,
      workspaceId,
      user.id,
    );
    if (!adminMembership.ok) {
      return {
        ok: false,
        error: "You don't have permission to restore this comment.",
      };
    }
  } else {
    const membership = await requireActiveMembership(
      admin,
      workspaceId,
      user.id,
    );
    if (!membership.ok) {
      return {
        ok: false,
        error: "You don't have permission to restore this comment.",
      };
    }
    // F128 (AS-216, AS-217): mirrors deleteComment's own author-path
    // canWrite re-check — a member since demoted to viewer loses restore
    // rights on their own old comments too.
    if (!canWrite({ role: membership.role })) {
      return {
        ok: false,
        error: "Viewers don't have permission to restore comments.",
      };
    }
  }

  const bodyJson: JSONContent =
    (commentRow.body_json as JSONContent | null) ??
    docFromPlainText(commentRow.text);

  // No-op: already active, nothing to write. Per this feature's Clarified
  // "empty / zero state" default, this returns ok without a database
  // write and without the caller needing to distinguish it from a real
  // restore.
  if (!commentRow.deleted_at) {
    return {
      ok: true,
      data: {
        id: commentRow.id,
        taskId: commentRow.task_id,
        userId: commentRow.user_id,
        text: commentRow.text,
        bodyJson,
        createdAt: commentRow.created_at,
      },
    };
  }

  const { data: restored, error: restoreError } = await admin
    .from("comments")
    .update({ deleted_at: null, deleted_by: null })
    .eq("id", parsed.data.commentId)
    .select("id, task_id, user_id, text, body_json, created_at, deleted_at")
    .single();

  if (restoreError || !restored || restored.deleted_at !== null) {
    console.error("restoreComment: update failed:", restoreError);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const restoredBodyJson: JSONContent =
    (restored.body_json as JSONContent | null) ?? bodyJson;

  // Realtime delivery mirrors F104's fix for the exact same class of bug
  // (see lib/tasks/subscribe-comments-realtime.ts's doc comment):
  // postgres_changes on this channel only subscribes to `event: "INSERT"`
  // (UPDATE is not subscribed at all, precisely because of the delete-side
  // RLS-on-NEW-row failure F104 fixed) — so a restore, which is also an
  // UPDATE under the hood, would NEVER reach postgres_changes subscribers
  // regardless of whether the NEW row now passes
  // comments_select_active_members. Broadcast is therefore the only
  // delivery path for this event, same as comment_deleted, kept
  // symmetrical on purpose rather than trying to special-case restore onto
  // postgres_changes UPDATE (which would also resurrect the exact delete
  // bug for every OTHER still-deleted UPDATE variant, since Realtime
  // cannot distinguish "this specific UPDATE" from "some UPDATE" at the
  // subscription-filter level). The full comment row is sent (not just an
  // id) so the client's INSERT-shaped reconciliation
  // (lib/tasks/reconcile-realtime-comment.ts's `reconcileComment`, which
  // appends when the id isn't already present in local state) can
  // reconstruct the comment without a second round trip.
  try {
    const broadcastChannel = supabase.channel(`comments:${commentTaskId}`);
    await broadcastChannel.send({
      type: "broadcast",
      event: "comment_restored",
      payload: {
        id: restored.id,
        task_id: restored.task_id,
        user_id: restored.user_id,
        text: restored.text,
        body_json: restoredBodyJson,
        created_at: restored.created_at,
      },
    });
    await supabase.removeChannel(broadcastChannel);
  } catch (broadcastError) {
    // Non-fatal: the restore itself already succeeded — same rationale as
    // deleteComment's broadcast try/catch above. A reload always reflects
    // the real deleted_at state via RLS regardless of whether this
    // broadcast is delivered.
    console.error(
      "restoreComment: broadcast failed (non-fatal):",
      broadcastError,
    );
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
      console.error(
        "restoreComment: revalidatePath failed (non-fatal):",
        revalidateError,
      );
    }
  }

  return {
    ok: true,
    data: {
      id: restored.id,
      taskId: restored.task_id,
      userId: restored.user_id,
      text: restored.text,
      bodyJson: restoredBodyJson,
      createdAt: restored.created_at,
    },
  };
}
