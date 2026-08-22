"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { purgeTrashItemSchema } from "@/lib/validation/purge";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { canPurge } from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/activity/audit";

// F192 (AS-348, AS-349): permanently (hard-)deletes an already-trashed
// task or comment, plus every dependent row/Storage object it owns. This
// is the only irreversible destructive action in the app — see this
// feature's Clarified implementation ("this is the only destructive path
// in the app — the confirmation must be explicit and the permission
// check server-side").
//
// Pattern mirrors deleteAttachment/deleteTask: Zod-validated input,
// membership + role re-checked server-side (defense in depth), admin
// client for the actual mutation, discriminated-union return, generic
// user-facing errors with details only logged server-side.
//
// Access control (Clarified implementation, Auth answer): re-verified
// server-side via lib/auth/permissions.ts's `canPurge`, which restricts
// this action to the workspace OWNER (deliberately narrower than
// `canManageMembers`'s owner-or-admin — see that predicate's own doc
// comment: "irreversible, workspace-wide destructive action"). A
// non-admin/non-owner calling this Server Action directly (bypassing the
// UI entirely) is rejected here, before any row is ever touched.
//
// Typed confirmation (this feature's own worker brief + Clarified
// ambiguity-resolution answer: "take the simpler option that adds no new
// dependency and no second source of truth"): the caller must pass the
// literal string below as `confirmation`. This is enforced HERE, not only
// in the UI dialog, so a direct call to this Server Action without going
// through the confirmation dialog is also rejected — the UI dialog (see
// components/trash/purge-dialog.tsx) is the only surface that can produce
// a matching confirmation string, but the string itself is not a secret
// (it's shown in the dialog's own copy) — its purpose is to make purging
// require a deliberate, typed act, not to gate access (canPurge already
// does that).
export const PURGE_CONFIRMATION_PHRASE = "DELETE";

const ATTACHMENTS_BUCKET = "task-attachments";

export type PurgeTrashItemResult =
  | { ok: true; data: { itemId: string; itemType: "task" | "comment" } }
  | { ok: false; error: string };

export async function purgeTrashItem(
  itemId: string,
  itemType: "task" | "comment",
  confirmation: string,
): Promise<PurgeTrashItemResult> {
  const parsed = purgeTrashItemSchema.safeParse({
    itemId,
    itemType,
    confirmation,
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid purge request.",
    };
  }

  if (parsed.data.confirmation !== PURGE_CONFIRMATION_PHRASE) {
    return {
      ok: false,
      error: `Type "${PURGE_CONFIRMATION_PHRASE}" to confirm this permanent deletion.`,
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to purge an item." };
  }

  const admin = createAdminClient();

  // Look up the item's owning workspace, and confirm it is actually
  // soft-deleted, server-side — never trusted from the client. An item
  // that is not currently in the trash is treated as "not found": this is
  // the hard boundary this feature's brief calls out — "never allow
  // purging a live row" — enforced here AND again at the DB level inside
  // purge_task/purge_comment (defense in depth).
  let workspaceId: string | undefined;

  if (parsed.data.itemType === "task") {
    const { data: taskRow, error: taskError } = await admin
      .from("tasks")
      .select("id, deleted_at, projects!inner(workspace_id)")
      .eq("id", parsed.data.itemId)
      .not("deleted_at", "is", null)
      .maybeSingle();

    if (taskError || !taskRow) {
      return { ok: false, error: "Item not found in trash." };
    }

    const project = Array.isArray(taskRow.projects)
      ? taskRow.projects[0]
      : taskRow.projects;
    workspaceId = project?.workspace_id;
  } else {
    const { data: commentRow, error: commentError } = await admin
      .from("comments")
      .select("id, deleted_at, tasks!inner(projects!inner(workspace_id))")
      .eq("id", parsed.data.itemId)
      .not("deleted_at", "is", null)
      .maybeSingle();

    if (commentError || !commentRow) {
      return { ok: false, error: "Item not found in trash." };
    }

    const task = Array.isArray(commentRow.tasks)
      ? commentRow.tasks[0]
      : commentRow.tasks;
    const project = task
      ? Array.isArray(task.projects)
        ? task.projects[0]
        : task.projects
      : null;
    workspaceId = project?.workspace_id;
  }

  if (!workspaceId) {
    return { ok: false, error: "Item not found in trash." };
  }

  // Defense in depth: re-check the caller is an active member of the
  // real owning workspace before evaluating role.
  const membership = await requireActiveMembership(admin, workspaceId, user.id);

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to purge this item.",
    };
  }

  // Access control (AS-348): purging is restricted to the workspace
  // owner — a non-owner (including an admin) calling this action
  // directly is rejected here, server-side, regardless of what the UI
  // shows.
  if (!canPurge({ role: membership.role })) {
    return {
      ok: false,
      error: "Only a workspace owner can permanently delete this item.",
    };
  }

  if (parsed.data.itemType === "task") {
    const { data: purgeRows, error: purgeError } = await admin.rpc(
      "purge_task",
      { p_task_id: parsed.data.itemId },
    );

    if (purgeError || !purgeRows || purgeRows.length === 0) {
      console.error("purgeTrashItem: purge_task RPC failed:", purgeError);
      return {
        ok: false,
        error: "Something went wrong. Please try again in a moment.",
      };
    }

    // Storage objects are removed AFTER the DB rows are gone (their file
    // paths are returned by the RPC precisely so this can happen here) —
    // this is the app-layer half of "purge does not leave orphaned files
    // in the bucket": the rows are already gone at this point regardless
    // of whether this Storage call succeeds, so a failure here is a
    // logged, dangling-object case (loud on inspection of the bucket),
    // never a silently-accumulating one, and it can never leave a
    // dangling DB row (the opposite failure mode) since the rows are
    // already deleted by the RPC above.
    const paths = purgeRows[0]?.attachment_paths ?? [];
    if (paths.length > 0) {
      const { error: storageError } = await admin.storage
        .from(ATTACHMENTS_BUCKET)
        .remove(paths);
      if (storageError) {
        console.error(
          "purgeTrashItem: storage removal failed after purge_task succeeded:",
          storageError,
        );
      }
    }
  } else {
    const { data: purgeRows, error: purgeError } = await admin.rpc(
      "purge_comment",
      { p_comment_id: parsed.data.itemId },
    );

    if (purgeError || !purgeRows || purgeRows.length === 0) {
      console.error("purgeTrashItem: purge_comment RPC failed:", purgeError);
      return {
        ok: false,
        error: "Something went wrong. Please try again in a moment.",
      };
    }
  }

  // F140 (audit): one entry per purge, following this mission's
  // `<subject>.<past_tense_verb>` naming convention
  // (lib/activity/README.md).
  await writeAudit(supabase, {
    workspaceId,
    action:
      parsed.data.itemType === "task" ? "task.purged" : "comment.purged",
    targetType: parsed.data.itemType,
    targetId: parsed.data.itemId,
  });

  const { data: workspaceRow } = await admin
    .from("workspaces")
    .select("slug")
    .eq("id", workspaceId)
    .maybeSingle();

  if (workspaceRow?.slug) {
    try {
      revalidatePath(`/w/${workspaceRow.slug}/trash`);
    } catch (revalidateError) {
      // Non-fatal cache-freshness rationale, same convention as every
      // other Server Action in this codebase.
      console.error(
        "purgeTrashItem: revalidatePath failed (non-fatal):",
        revalidateError,
      );
    }
  }

  return {
    ok: true,
    data: { itemId: parsed.data.itemId, itemType: parsed.data.itemType },
  };
}
