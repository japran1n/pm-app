"use server";

import { revalidatePath } from "next/cache";
import type { JSONContent } from "@tiptap/react";

import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  addCommentSchema,
  commentBodyJsonSchema,
  deleteCommentSchema,
  editCommentSchema,
  restoreCommentSchema,
} from "@/lib/validation/comments";
import { logger } from "@/lib/observability/logger";
import { docFromPlainText, extractPlainText } from "@/lib/comments/rich-text";
import {
  sanitiseMentionsForVisibility,
  resolveVisibleMentionIds,
} from "@/lib/comments/mentions";
import {
  extractMentionIds,
  extractNewlyMentionedIds,
} from "@/lib/notifications/mentions";
import { computeFanoutRecipients } from "@/lib/notifications/fanout";
import { filterRecipientsByInAppPreference } from "@/lib/notifications/preferences";
import { createNotification } from "@/lib/notifications/create-notification";
import { revalidatePortalProject } from "@/lib/actions/portal-revalidate";
import {
  requireActiveMembership,
  requireWorkspaceAdmin,
} from "@/lib/auth/require-membership";
import { canWrite, isClient, type WorkspaceRole } from "@/lib/auth/permissions";
import { writeTaskCommentEvent } from "@/lib/activity/task-activity";
import { isProjectVisibleToCaller } from "@/lib/actions/project-visibility";
import { assertNotPreview } from "@/lib/auth/assert-not-preview";
import type { ActionResult } from "@/lib/actions/authz";

export type AddCommentResult = ActionResult<{
        id: string;
        taskId: string;
        userId: string;
        text: string;
        /** F174 (AS-312): the Tiptap JSONContent document actually
         * stored/rendered for this comment. */
        bodyJson: JSONContent;
        createdAt: string;
      }>;

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
  // C7: whether this comment is team-only. Deliberately defaults to
  // INTERNAL for team members (see below) — a comment that reaches an
  // outside party by accident cannot be unsent. Ignored for a client
  // caller, whose comments are never internal.
  internal?: boolean,
): Promise<AddCommentResult> {
  // F024b (missions/20260903-portal, AS-052): default-deny -- addComment
  // serves both team (`/w/*`) and portal (`/portal/*`) callers, and the
  // preview cookies this checks are only ever sent on a `/portal/*`
  // request (path-scoped, see lib/supabase/server.ts), so this guard is a
  // no-op for every team caller and only refuses a previewing admin
  // posting (and being attributed) as the client -- including the trail
  // comments approvePortalTask/requestPortalTaskChanges post through this
  // same function.
  const preview = await assertNotPreview();
  if (!preview.ok) return preview;

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

  const { supabase, user } = await getCurrentUser();

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
    .select("id, project_id, deleted_at, client_visible, projects(workspace_id, visibility, portal_enabled)")
    .eq("id", parsed.data.taskId)
    .is("deleted_at", null)
    .maybeSingle();

  if (taskError || !taskRow) {
    return { ok: false, error: "Task not found." };
  }

  const project = taskRow.projects as
    | { workspace_id: string; visibility: string; portal_enabled: boolean }
    | { workspace_id: string; visibility: string; portal_enabled: boolean }[]
    | null;
  const projectRow = Array.isArray(project) ? project[0] : project;
  const workspaceId = projectRow?.workspace_id;

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

  // C7: a client may comment, but only on a task actually shared with
  // them, and only as a non-internal comment. This is checked here as well
  // as in RLS because this action inserts with the admin client (see the
  // insert below), so the policy alone would not gate this path.
  const callerIsClient = isClient({ role: membership.role });

  if (callerIsClient && !taskRow.client_visible) {
    // Same message a genuinely missing task gets: whether an internal task
    // exists is not a client's business.
    return { ok: false, error: "Task not found." };
  }

  // F006l/B3: this insert goes through the admin client (see below), so
  // the gated `comments_insert_active_members` policy never runs — the
  // portal_enabled check has to be stated explicitly here, same as the
  // `client_visible` check immediately above. Without it, a client of a
  // portal-disabled project holding a `client_visible` task id could still
  // write a comment onto it (F006l/M1-scrutiny-3 B3).
  if (callerIsClient && !projectRow?.portal_enabled) {
    return { ok: false, error: "Task not found." };
  }

  // F128 (AS-216, AS-217): viewers are read-only (canWrite deliberately
  // does not exclude guest — see its doc comment in lib/auth/permissions.ts;
  // guest write access is separately scoped by F134's AS-223).
  if (!callerIsClient && !canWrite({ role: membership.role })) {
    return {
      ok: false,
      error: "Viewers don't have permission to comment.",
    };
  }

  // The default that matters: a team comment is internal unless someone
  // said otherwise, a client's comment never is. Existing callers pass
  // nothing, so every comment the team writes today stays team-only —
  // which is what the pre-client behaviour effectively was.
  const isInternal = callerIsClient ? false : (internal ?? true);

  // F323 (AS-227, AS-228, AS-229): the caller must be able to SEE this
  // task's project themselves, not just be an active workspace member —
  // see isProjectVisibleToCaller's doc comment in
  // lib/actions/project-visibility.ts. Same generic message as the role
  // failure above so a private project's existence is never disclosed.
  if (
    !(await isProjectVisibleToCaller(
      admin,
      { projectId: taskRow.project_id, visibility: (projectRow?.visibility as "workspace" | "private") ?? "workspace" },
      user.id,
      membership.role,
    ))
  ) {
    return {
      ok: false,
      error: "Viewers don't have permission to comment.",
    };
  }

  // F204 (AS-376): strip any mention node referencing a user who is not
  // actually visible to this commenter on the task's owning project,
  // independent of whatever suggestion list the client used (or bypassed
  // entirely via a hand-crafted bodyJson) — see
  // lib/comments/mentions.ts's doc comment for the full rationale.
  //
  // F301: if the visibility check itself fails (transient DB error), the
  // whole comment write fails rather than silently persisting every
  // mention rewritten to "@Former member" — see
  // MentionVisibilityCheckError's doc comment.
  let mentionSafeBodyJson: JSONContent;
  try {
    mentionSafeBodyJson = await sanitiseMentionsForVisibility(
      admin,
      validatedBodyJson,
      {
        projectId: taskRow.project_id,
        workspaceId,
        projectVisibility: projectRow?.visibility ?? "workspace",
      },
    );
  } catch (visibilityError) {
    logger.error("addComment: mention visibility check failed", { error: visibilityError });
    return {
      ok: false,
      error: "Something went wrong posting your comment. Please try again.",
    };
  }
  const finalProjectedText =
    extractPlainText(mentionSafeBodyJson) || projectedText;

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
      text: finalProjectedText,
      body_json: mentionSafeBodyJson,
      body_text: finalProjectedText,
      internal: isInternal,
    })
    .select("id, task_id, user_id, text, body_json, created_at")
    .single();

  if (insertError || !inserted) {
    logger.error("addComment: insert failed", { error: insertError });
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
    logger.error("addComment: auto-watch upsert failed (non-fatal)", { error: watcherError });
  }

  // F207 (AS-374, AS-375, AS-381, AS-382, AS-384): notify the task's
  // active watchers (comment_reply) and any mentioned users who actually
  // survived F204's visibility strip (mention — mentionSafeBodyJson, never
  // the raw client input, so a stripped mention never notifies), excluding
  // the commenter themselves. A mentioned non-watcher additionally becomes
  // a watcher (AS-375), same durable `ignoreDuplicates` upsert pattern as
  // the auto-watch-on-comment block above — an existing explicit unwatch
  // is never overridden. Entirely non-fatal: the comment itself already
  // succeeded above.
  try {
    const mentionedIds = Array.from(extractMentionIds(mentionSafeBodyJson));

    const { data: watcherRows } = await admin
      .from("task_watchers")
      .select("user_id")
      .eq("task_id", parsed.data.taskId)
      .eq("is_watching", true);
    const watcherIds = (watcherRows ?? []).map((row) => row.user_id as string);

    const computedRecipients = computeFanoutRecipients({
      type: "commented",
      actorId: user.id,
      watcherIds,
      mentionedIds,
    });

    // F211 (AS-391): drop recipients who have this kind's in-app channel
    // disabled before ever calling create_notification, so a disabled
    // preference means no row is ever written, not merely a row the UI
    // happens to hide.
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
          commentId: inserted.id,
        },
        "addComment",
      );
    }

    // AS-375: a mentioned non-watcher becomes a watcher. Never overrides
    // an existing row (including an explicit prior unwatch) — see this
    // block's doc comment above.
    const mentionRecipientIds = mentionedIds.filter((id) => id !== user.id);
    if (mentionRecipientIds.length > 0) {
      await admin.from("task_watchers").upsert(
        mentionRecipientIds.map((id) => ({
          task_id: parsed.data.taskId,
          user_id: id,
          is_watching: true,
        })),
        { onConflict: "task_id,user_id", ignoreDuplicates: true },
      );
    }
  } catch (fanoutError) {
    logger.error("addComment: notification fan-out failed (non-fatal)", { error: fanoutError });
  }

  // F195 (AS-356): comment additions appear in the same task_activity feed
  // as field changes. Non-fatal — the comment itself already succeeded.
  try {
    await writeTaskCommentEvent(
      supabase,
      parsed.data.taskId,
      "comment_added",
      inserted.id,
    );
  } catch (activityError) {
    logger.error("addComment: writeTaskCommentEvent failed (non-fatal)", { error: activityError });
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
      logger.error("addComment: revalidatePath failed (non-fatal)", { error: revalidateError });
    }
  }

  // F004c (AS-006): a client-visible, non-internal comment appears on the
  // portal's task thread — revalidate the portal layout too. An internal
  // team-only comment on the same task never shows there, so it's excluded.
  if (taskRow.client_visible && !isInternal && workspaceRow?.slug) {
    revalidatePortalProject(workspaceRow.slug, taskRow.project_id);
  }

  return {
    ok: true,
    data: {
      id: inserted.id,
      taskId: inserted.task_id,
      userId: inserted.user_id,
      text: inserted.text,
      bodyJson: (inserted.body_json as JSONContent | null) ?? mentionSafeBodyJson,
      createdAt: inserted.created_at,
    },
  };
}

export type DeleteCommentResult = ActionResult<{ id: string; deletedAt: string }>;

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

  const { supabase, user } = await getCurrentUser();

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
    .select(
      "id, user_id, deleted_at, internal, tasks(id, project_id, client_visible, projects(workspace_id, workspaces(slug)))",
    )
    .eq("id", parsed.data.commentId)
    .is("deleted_at", null)
    .maybeSingle();

  if (commentError || !commentRow) {
    return { ok: false, error: "Comment not found." };
  }

  const task = commentRow.tasks as
    | {
        id: string;
        project_id: string;
        client_visible: boolean;
        projects:
          | { workspace_id: string; workspaces?: { slug: string } | { slug: string }[] | null }
          | { workspace_id: string; workspaces?: { slug: string } | { slug: string }[] | null }[]
          | null;
      }
    | {
        id: string;
        project_id: string;
        client_visible: boolean;
        projects:
          | { workspace_id: string; workspaces?: { slug: string } | { slug: string }[] | null }
          | { workspace_id: string; workspaces?: { slug: string } | { slug: string }[] | null }[]
          | null;
      }[]
    | null;
  const taskRow = Array.isArray(task) ? task[0] : task;
  const project = taskRow?.projects;
  const projectRow = Array.isArray(project) ? project[0] : project;
  const workspaceId = projectRow?.workspace_id;
  const commentTaskId = taskRow?.id;

  if (!workspaceId || !commentTaskId) {
    return { ok: false, error: "Comment not found." };
  }

  const isAuthor = commentRow.user_id === user.id;

  // AS-098: the comment's own author may always delete it, regardless of
  // role. AS-100: a workspace admin/owner may delete any comment in their
  // workspace, regardless of authorship. AS-099: anyone else — a
  // different regular member — is rejected.
  let callerRole: WorkspaceRole;
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
    callerRole = adminMembership.role;
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
    callerRole = membership.role;
  }

  // F323 (AS-227, AS-228, AS-229): the caller (author or admin) must be
  // able to SEE this comment's task's project themselves, not just be an
  // active workspace member — see isProjectVisibleToCaller's doc comment
  // in lib/actions/project-visibility.ts. Re-checked here (after both
  // authorization branches above resolve, whichever path was taken) using
  // the SAME generic message this function already returns for a
  // permission failure, so a private project's existence is never
  // disclosed.
  {
    const { data: visProjectRow } = await admin
      .from("tasks")
      .select("project_id, projects(visibility)")
      .eq("id", commentTaskId)
      .maybeSingle();
    const visProject = visProjectRow?.projects as
      | { visibility: string }
      | { visibility: string }[]
      | null
      | undefined;
    const visProjectRowResolved = Array.isArray(visProject)
      ? visProject[0]
      : visProject;
    if (
      !visProjectRow?.project_id ||
      !(await isProjectVisibleToCaller(
        admin,
        {
          projectId: visProjectRow.project_id,
          visibility:
            (visProjectRowResolved?.visibility as "workspace" | "private") ??
            "workspace",
        },
        user.id,
        callerRole,
      ))
    ) {
      return {
        ok: false,
        error: "You don't have permission to delete this comment.",
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
    logger.error("deleteComment: update failed", { error: deleteError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  // F195 (AS-356): comment deletions appear in the same task_activity feed
  // as additions/field changes. Non-fatal — the delete itself already
  // succeeded.
  try {
    await writeTaskCommentEvent(
      supabase,
      commentTaskId,
      "comment_deleted",
      deleted.id,
    );
  } catch (activityError) {
    logger.error("deleteComment: writeTaskCommentEvent failed (non-fatal)", { error: activityError });
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
    logger.error("deleteComment: broadcast failed (non-fatal)", { error: broadcastError });
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
      logger.error("deleteComment: revalidatePath failed (non-fatal)", { error: revalidateError });
    }
  }

  // F004c (AS-006): deleting a client-visible, non-internal comment must
  // also refresh the portal's task thread.
  if (taskRow?.client_visible && !commentRow.internal && workspaceRow?.slug) {
    revalidatePortalProject(workspaceRow.slug, taskRow.project_id);
  }

  return {
    ok: true,
    data: {
      id: deleted.id,
      deletedAt: deleted.deleted_at,
    },
  };
}

export type RestoreCommentResult = ActionResult<{
        id: string;
        taskId: string;
        userId: string;
        text: string;
        bodyJson: JSONContent;
        createdAt: string;
      }>;

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

  const { supabase, user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to restore a comment." };
  }

  const admin = createAdminClient();

  const { data: commentRow, error: commentError } = await admin
    .from("comments")
    .select(
      "id, task_id, user_id, text, body_json, created_at, deleted_at, internal, tasks(id, project_id, client_visible, projects(workspace_id, visibility, workspaces(slug)))",
    )
    .eq("id", parsed.data.commentId)
    .maybeSingle();

  if (commentError || !commentRow) {
    return { ok: false, error: "Comment not found." };
  }

  const task = commentRow.tasks as
    | {
        id: string;
        project_id: string;
        client_visible: boolean;
        projects:
          | { workspace_id: string; visibility: string; workspaces?: { slug: string } | { slug: string }[] | null }
          | { workspace_id: string; visibility: string; workspaces?: { slug: string } | { slug: string }[] | null }[]
          | null;
      }
    | {
        id: string;
        project_id: string;
        client_visible: boolean;
        projects:
          | { workspace_id: string; visibility: string; workspaces?: { slug: string } | { slug: string }[] | null }
          | { workspace_id: string; visibility: string; workspaces?: { slug: string } | { slug: string }[] | null }[]
          | null;
      }[]
    | null;
  const taskRow = Array.isArray(task) ? task[0] : task;
  const project = taskRow?.projects;
  const projectRow = Array.isArray(project) ? project[0] : project;
  const workspaceId = projectRow?.workspace_id;
  const commentTaskId = taskRow?.id;
  const commentProjectId = taskRow?.project_id;

  if (!workspaceId || !commentTaskId || !commentProjectId) {
    return { ok: false, error: "Comment not found." };
  }

  const isAuthor = commentRow.user_id === user.id;

  // Same three-way rule as deleteComment (AS-098/AS-099/AS-100's
  // counterpart for restore, both covered by AS-346's "author or admin"
  // wording): the comment's own author, or a workspace admin/owner, may
  // restore it. Any other regular member is rejected server-side even if
  // they call this action directly.
  let restoreCallerRole: WorkspaceRole;
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
    restoreCallerRole = adminMembership.role;
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
    restoreCallerRole = membership.role;
  }

  // F323 (AS-227, AS-228, AS-229): the caller (author or admin) must be
  // able to SEE this comment's task's project themselves, not just be an
  // active workspace member — see isProjectVisibleToCaller's doc comment
  // in lib/actions/project-visibility.ts. Same generic message this
  // function already returns for a permission failure, so a private
  // project's existence is never disclosed.
  if (
    !(await isProjectVisibleToCaller(
      admin,
      {
        projectId: commentProjectId,
        visibility: (projectRow?.visibility as "workspace" | "private") ?? "workspace",
      },
      user.id,
      restoreCallerRole,
    ))
  ) {
    return {
      ok: false,
      error: "You don't have permission to restore this comment.",
    };
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
    logger.error("restoreComment: update failed", { error: restoreError });
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
    logger.error("restoreComment: broadcast failed (non-fatal)", { error: broadcastError });
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
      logger.error("restoreComment: revalidatePath failed (non-fatal)", { error: revalidateError });
    }
  }

  // F004c (AS-006): restoring a client-visible, non-internal comment must
  // also refresh the portal's task thread.
  if (taskRow?.client_visible && !commentRow.internal && workspaceRow?.slug) {
    revalidatePortalProject(workspaceRow.slug, commentProjectId);
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

export type EditCommentResult = ActionResult<{
        id: string;
        taskId: string;
        userId: string;
        text: string;
        bodyJson: JSONContent;
        editedAt: string;
      }>;

// Edits a comment's content (F197: AS-362, AS-364). Pattern mirrors
// deleteComment/restoreComment's shape (Zod-validated input, membership
// re-checked server-side, admin client for the write, discriminated-union
// return, generic user-facing errors) but with a stricter authorization
// rule than either of those siblings: AS-364's "cannot edit someone else's
// comment" is deliberately author-only, NOT author-or-admin. Per this
// feature's clarification Notes ("Admins deliberately cannot edit other
// people's words — only delete") — confirmed and recorded here as the
// resolved reading, since editing changes someone's own words in a way
// deleting/hiding them does not. See this feature's handoff, Decisions
// made, and supabase/migrations/20260823000000_comment_edit.sql for the
// matching database-level trigger that enforces the same author-only rule
// against a direct API call bypassing this action entirely (AS-364's
// "including via direct API").
//
// The comment's owning task/project/workspace is looked up server-side
// (never trusted from the client), same convention as every sibling
// action in this file.
export async function editComment(
  commentId: string,
  text: string,
  bodyJson?: JSONContent | null,
): Promise<EditCommentResult> {
  const parsed = editCommentSchema.safeParse({ commentId, text });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Enter a valid comment.",
    };
  }

  // Same "structural validation only, RichTextRenderer's sanitiseDocument
  // is the real security boundary on every render" convention as
  // addComment above.
  const bodyJsonParsed = bodyJson
    ? commentBodyJsonSchema.safeParse(bodyJson)
    : null;
  const validatedBodyJson: JSONContent = bodyJsonParsed?.success
    ? (bodyJsonParsed.data as JSONContent)
    : docFromPlainText(parsed.data.text);

  const projectedText =
    extractPlainText(validatedBodyJson) || parsed.data.text;

  const { supabase, user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to edit a comment." };
  }

  const admin = createAdminClient();

  // A soft-deleted comment behaves as "not found" for editing, same
  // convention as deleteComment's own lookup.
  const { data: commentRow, error: commentError } = await admin
    .from("comments")
    .select(
      "id, user_id, deleted_at, body_json, internal, tasks(id, project_id, client_visible, projects(workspace_id, visibility, workspaces(slug)))",
    )
    .eq("id", parsed.data.commentId)
    .is("deleted_at", null)
    .maybeSingle();

  if (commentError || !commentRow) {
    return { ok: false, error: "Comment not found." };
  }

  const task = commentRow.tasks as
    | {
        id: string;
        project_id: string;
        client_visible: boolean;
        projects:
          | { workspace_id: string; visibility: string; workspaces?: { slug: string } | { slug: string }[] | null }
          | { workspace_id: string; visibility: string; workspaces?: { slug: string } | { slug: string }[] | null }[]
          | null;
      }
    | {
        id: string;
        project_id: string;
        client_visible: boolean;
        projects:
          | { workspace_id: string; visibility: string; workspaces?: { slug: string } | { slug: string }[] | null }
          | { workspace_id: string; visibility: string; workspaces?: { slug: string } | { slug: string }[] | null }[]
          | null;
      }[]
    | null;
  const taskRow = Array.isArray(task) ? task[0] : task;
  const project = taskRow?.projects;
  const projectRow = Array.isArray(project) ? project[0] : project;
  const workspaceId = projectRow?.workspace_id;
  const commentTaskId = taskRow?.id;
  const commentProjectId = taskRow?.project_id;

  if (!workspaceId || !commentTaskId || !commentProjectId) {
    return { ok: false, error: "Comment not found." };
  }

  // AS-362/AS-364: author-only, no admin/owner override (see this
  // function's doc comment above for why this deliberately differs from
  // deleteComment/restoreComment's author-or-admin rule).
  if (commentRow.user_id !== user.id) {
    return {
      ok: false,
      error: "You can only edit your own comments.",
    };
  }

  // Even the author must still be an active, writable member (defense in
  // depth — mirrors deleteComment/restoreComment's own author-path checks:
  // a removed member or one demoted to viewer loses edit rights on their
  // old comments too).
  const membership = await requireActiveMembership(
    admin,
    workspaceId,
    user.id,
  );
  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to edit this comment.",
    };
  }
  if (!canWrite({ role: membership.role })) {
    return {
      ok: false,
      error: "Viewers don't have permission to edit comments.",
    };
  }

  // F323 (AS-227, AS-228, AS-229): the caller must be able to SEE this
  // comment's task's project themselves, not just be an active workspace
  // member — see isProjectVisibleToCaller's doc comment in
  // lib/actions/project-visibility.ts. Same generic message as the role
  // failure above so a private project's existence is never disclosed.
  if (
    !(await isProjectVisibleToCaller(
      admin,
      {
        projectId: commentProjectId,
        visibility: (projectRow?.visibility as "workspace" | "private") ?? "workspace",
      },
      user.id,
      membership.role,
    ))
  ) {
    return {
      ok: false,
      error: "Viewers don't have permission to edit comments.",
    };
  }

  // F204 (AS-376): same server-side re-check as addComment — see
  // lib/comments/mentions.ts's doc comment.
  //
  // F301: same "fail the write rather than corrupt it" handling as
  // addComment above.
  let mentionSafeBodyJson: JSONContent;
  try {
    mentionSafeBodyJson = await sanitiseMentionsForVisibility(
      admin,
      validatedBodyJson,
      {
        projectId: commentProjectId,
        workspaceId,
        projectVisibility: projectRow?.visibility ?? "workspace",
      },
    );
  } catch (visibilityError) {
    logger.error("editComment: mention visibility check failed", { error: visibilityError });
    return {
      ok: false,
      error: "Something went wrong updating your comment. Please try again.",
    };
  }
  const finalProjectedText =
    extractPlainText(mentionSafeBodyJson) || projectedText;

  const editedAt = new Date().toISOString();

  const { data: updated, error: updateError } = await admin
    .from("comments")
    .update({
      text: finalProjectedText,
      body_json: mentionSafeBodyJson,
      body_text: finalProjectedText,
      edited_at: editedAt,
    })
    .eq("id", parsed.data.commentId)
    .select("id, task_id, user_id, text, body_json, edited_at")
    .single();

  if (updateError || !updated) {
    logger.error("editComment: update failed", { error: updateError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  // F311 (AS-381 fix): editing a comment can introduce a mention that
  // wasn't there before (addComment already did this for brand-new
  // comments via F207's fan-out; editComment never did, which is the
  // bug this feature fixes — see M15-scrutiny.md blocker finding #3).
  //
  // Scope note: only the mentions that are NEW in this edit are notified
  // — present in `mentionSafeBodyJson` (the post-strip, post-update body)
  // but absent from the comment's PREVIOUS `body_json` (read above,
  // before the update). This mirrors F205/F207's established
  // "notify-only-newly-added-mentions-on-each-save" convention
  // (lib/notifications/mentions.ts's `extractNewlyMentionedIds`,
  // originally built for repeatedly-re-saved task descriptions) — without
  // this diff, editing a comment with an unrelated typo fix would
  // re-notify every mention on every single save, which is spammy and not
  // what AS-381 asks for. A mention REMOVED by this edit is simply absent
  // from `mentionSafeBodyJson`'s ids and is therefore never in the
  // "newly mentioned" set either — nothing special needs to happen for
  // it.
  //
  // Deliberately scoped to ONLY the mention notification + watcher
  // promotion, not a "comment_reply" watcher notification on every edit
  // (AS-381's assertion text is specifically about mentions, not about
  // watchers being notified of edits — see this feature's handoff,
  // Decisions made, for the full reasoning on why that's treated as a
  // separate, out-of-scope concern rather than silently expanded here).
  //
  // Reuses the exact same shared helpers addComment's fan-out block above
  // already uses (computeFanoutRecipients, filterRecipientsByInAppPreference,
  // createNotification) rather than a third reimplementation of the
  // fan-out logic. `type: "commented"` (not `"mentioned"`) is used so the
  // resulting `mention`-kind notification carries this edit's `commentId`
  // (`create_notification`'s `p_comment_id`), same as a mention in a
  // brand-new comment — a task-description mention (the "mentioned" event
  // type) has no comment to link to, but this one does. Entirely
  // non-fatal: the edit itself already succeeded above.
  try {
    const reallyNewlyMentionedIds = extractNewlyMentionedIds(
      (commentRow.body_json as JSONContent | null) ?? null,
      mentionSafeBodyJson,
    ).filter((id) => id !== user.id);

    if (reallyNewlyMentionedIds.length > 0) {
      const computedRecipients = computeFanoutRecipients({
        type: "commented",
        actorId: user.id,
        watcherIds: [],
        mentionedIds: reallyNewlyMentionedIds,
      });

      // F211 (AS-391): drop recipients who have this kind's in-app channel
      // disabled before ever calling create_notification.
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
            taskId: commentTaskId,
            commentId: updated.id,
          },
          "editComment",
        );
      }

      // AS-375: a newly-mentioned non-watcher becomes a watcher. Never
      // overrides an existing row (including an explicit prior unwatch) —
      // same durable `ignoreDuplicates` upsert pattern as addComment's own
      // mention block above.
      await admin.from("task_watchers").upsert(
        reallyNewlyMentionedIds.map((id) => ({
          task_id: commentTaskId,
          user_id: id,
          is_watching: true,
        })),
        { onConflict: "task_id,user_id", ignoreDuplicates: true },
      );
    }
  } catch (fanoutError) {
    logger.error("editComment: notification fan-out failed (non-fatal)", { error: fanoutError });
  }

  // F104-style realtime delivery: postgres_changes UPDATE subscriptions
  // are not relied on for this table (see deleteComment/restoreComment's
  // doc comments for the confirmed AS-101 class of bug), so an edit is
  // broadcast the same way a restore is — the full updated row, so
  // reconcileComment's UPDATE branch (lib/tasks/reconcile-realtime-comment.ts)
  // can replace the local copy without a second round trip.
  try {
    const broadcastChannel = supabase.channel(`comments:${commentTaskId}`);
    await broadcastChannel.send({
      type: "broadcast",
      event: "comment_edited",
      payload: {
        id: updated.id,
        task_id: updated.task_id,
        user_id: updated.user_id,
        text: updated.text,
        body_json: mentionSafeBodyJson,
        edited_at: updated.edited_at,
      },
    });
    await supabase.removeChannel(broadcastChannel);
  } catch (broadcastError) {
    logger.error("editComment: broadcast failed (non-fatal)", { error: broadcastError });
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
      logger.error("editComment: revalidatePath failed (non-fatal)", { error: revalidateError });
    }
  }

  // F004c (AS-006): editing a client-visible, non-internal comment must
  // also refresh the portal's task thread.
  if (taskRow?.client_visible && !commentRow.internal && workspaceRow?.slug) {
    revalidatePortalProject(workspaceRow.slug, commentProjectId);
  }

  return {
    ok: true,
    data: {
      id: updated.id,
      taskId: updated.task_id,
      userId: updated.user_id,
      text: updated.text,
      bodyJson: (updated.body_json as JSONContent | null) ?? mentionSafeBodyJson,
      editedAt: updated.edited_at as string,
    },
  };
}

export type MentionCandidateResult = ActionResult<{ userIds: string[] }>;

// F204 follow-up (AS-376, "not offered in the picker" half): returns the
// ids of workspace members who are actually visible (mentionable) to the
// caller on this specific task's owning project — active workspace member
// AND (project is workspace-visible, OR role is owner/admin, OR an
// explicit project_members row exists). This reuses
// `lib/comments/mentions.ts`'s `resolveVisibleMentionIds` directly (the
// exact same function `addComment`/`editComment` use to strip a
// hand-crafted mention referencing an invisible user) rather than
// reimplementing the rule a second time, so the "who's visible" predicate
// is defined in exactly one place for both the write-time enforcement
// (already GREEN, F204) and this read-time picker-narrowing half.
//
// Returns only ids, not full member records — the caller
// (components/task/comment-list.tsx) already has full member display
// data (name/email/avatar) in its own `members` prop, so this just
// narrows which of those ids are offered as mention candidates rather
// than duplicating a second member-record fetch.
export async function getMentionCandidates(
  taskId: string,
): Promise<MentionCandidateResult> {
  const { user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  const admin = createAdminClient();

  const { data: taskRow, error: taskError } = await admin
    .from("tasks")
    .select("id, project_id, deleted_at, projects(workspace_id, visibility)")
    .eq("id", taskId)
    .is("deleted_at", null)
    .maybeSingle();

  if (taskError || !taskRow) {
    return { ok: false, error: "Task not found." };
  }

  const project = taskRow.projects as
    | { workspace_id: string; visibility: string }
    | { workspace_id: string; visibility: string }[]
    | null;
  const projectRow = Array.isArray(project) ? project[0] : project;
  const workspaceId = projectRow?.workspace_id;

  if (!workspaceId) {
    return { ok: false, error: "Task not found." };
  }

  const membership = await requireActiveMembership(
    admin,
    workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to view this task.",
    };
  }

  const { data: memberRows, error: memberError } = await admin
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("status", "active");

  if (memberError) {
    logger.error("getMentionCandidates: member fetch failed", { error: memberError });
    return { ok: false, error: "Something went wrong. Please try again." };
  }

  const allMemberIds = (memberRows ?? [])
    .map((row) => row.user_id as string)
    .filter(Boolean);

  // F313 (AS-376 follow-up, M15 third scrutiny pass): this call was
  // previously unguarded while the memberError check above IS guarded —
  // an inconsistency. `resolveVisibleMentionIds` deliberately throws
  // `MentionVisibilityCheckError` on a transient DB read failure (F301,
  // lib/comments/mentions.ts) rather than silently treating it as "no one
  // is visible"; every other caller of this function
  // (addComment/editComment/editTask) already catches it and returns a
  // typed `{ ok: false }` result instead of letting the rejection
  // propagate. This call site is a Server Action too, so it follows the
  // same "lib stays pure/typed-error, the calling Server Action decides
  // how to surface it" convention rather than leaving an unhandled
  // rejection for the client's bare `.then()` call sites
  // (comment-list.tsx, task-detail-sheet.tsx) to hang on.
  let visibleIds: Set<string>;
  try {
    visibleIds = await resolveVisibleMentionIds(admin, allMemberIds, {
      projectId: taskRow.project_id,
      workspaceId,
      projectVisibility: projectRow?.visibility ?? "workspace",
    });
  } catch (visibilityError) {
    logger.error("getMentionCandidates: mention visibility resolution failed", { error: visibilityError });
    return { ok: false, error: "Something went wrong. Please try again." };
  }

  return { ok: true, data: { userIds: Array.from(visibleIds) } };
}
