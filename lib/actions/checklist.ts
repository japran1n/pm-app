"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  addChecklistItemSchema,
  toggleChecklistItemSchema,
  renameChecklistItemSchema,
  reorderChecklistItemSchema,
  deleteChecklistItemSchema,
} from "@/lib/validation/checklist";
import { logger } from "@/lib/observability/logger";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { canEditTask } from "@/lib/auth/permissions";
import { calculatePosition } from "@/lib/board/position";
import type { ActionResult } from "@/lib/actions/authz";

// F152: checklist item actions (AS-270, AS-271).
//
// Permission model note (per this feature's assignment): lib/auth/
// permissions.ts does not exist yet (M11's F127 hasn't landed). This file
// follows the membership-guard convention lib/actions/comments.ts already
// established (requireActiveMembership from
// lib/auth/require-membership.ts) rather than inventing an early, throwaway
// version of the future permissions predicate.
//
// Deliberate departure from comments.ts/tasks.ts/attachments.ts's usual
// "look everything up with the admin client, including the actual write"
// convention: F151's migration
// (supabase/migrations/20260819075456_create_checklist_items.sql) shipped
// SELECT/INSERT-only RLS on checklist_items, so UPDATE and DELETE were
// denied by default. This mission's orchestrator flagged that gap
// explicitly and asked for it to be closed with real UPDATE/DELETE
// policies (added in
// supabase/migrations/20260819080358_checklist_items_update_delete_policies.sql,
// scoped identically to the existing SELECT/INSERT policies) rather than
// routed around with `createAdminClient()` — using the admin client for
// the mutation itself would quietly move the authorization boundary for
// this table out of the database and into application code, the opposite
// of lib/supabase/server.ts's own stated convention ("the client used by
// application logic; RLS is the authorization boundary").
//
// So every action below performs its ACTUAL insert/update/delete on
// `checklist_items` through the request-scoped, RLS-respecting client
// (`supabase`, from lib/supabase/server.ts) — RLS is the real, exercised
// enforcement boundary for these writes. `createAdminClient()` is still
// used in this file, but ONLY for read-only lookups that need to resolve
// real data (a task's true owning workspace, an item's true owning task)
// regardless of the caller's own RLS visibility — this is what lets a bad
// id read as "not found" rather than an ambiguous RLS-filtered empty
// result, same convention comments.ts uses for its own lookups.
// requireActiveMembership (also using the admin client, so the check
// itself can't be defeated by a missing/incomplete RLS policy) is the
// second line of defense-in-depth on top of RLS, per the Clarified
// implementation's Access control answer.

type ChecklistItemContext = {
  id: string;
  taskId: string;
  content: string;
  isChecked: boolean;
  position: number;
  checkedBy: string | null;
  checkedAt: string | null;
  workspaceId: string;
};

// Shared lookup used by toggle/rename/reorder/delete: resolves a checklist
// item id to its full current row plus its real owning workspace (via
// task -> project -> workspace), or null if the item doesn't exist, or its
// task doesn't exist / is soft-deleted (treated the same as "not found",
// mirroring the tasks/comments soft-delete convention).
async function loadChecklistItemContext(
  admin: ReturnType<typeof createAdminClient>,
  itemId: string,
): Promise<ChecklistItemContext | null> {
  const { data: itemRow, error } = await admin
    .from("checklist_items")
    .select(
      "id, task_id, content, is_checked, position, checked_by, checked_at, tasks(id, deleted_at, projects(workspace_id))",
    )
    .eq("id", itemId)
    .maybeSingle();

  if (error || !itemRow) {
    return null;
  }

  const task = itemRow.tasks as
    | {
        id: string;
        deleted_at: string | null;
        projects: { workspace_id: string } | { workspace_id: string }[] | null;
      }
    | {
        id: string;
        deleted_at: string | null;
        projects: { workspace_id: string } | { workspace_id: string }[] | null;
      }[]
    | null;
  const taskRow = Array.isArray(task) ? task[0] : task;

  if (!taskRow || taskRow.deleted_at) {
    return null;
  }

  const project = taskRow.projects;
  const workspaceId = Array.isArray(project)
    ? project[0]?.workspace_id
    : project?.workspace_id;

  if (!workspaceId) {
    return null;
  }

  return {
    id: itemRow.id,
    taskId: itemRow.task_id,
    content: itemRow.content,
    isChecked: itemRow.is_checked,
    position: itemRow.position,
    checkedBy: itemRow.checked_by,
    checkedAt: itemRow.checked_at,
    workspaceId,
  };
}

// Shared non-fatal cache-freshness revalidation, same rationale as every
// other action file in this codebase: revalidatePath throws outside an
// active request/render context (e.g. invoked from a test harness), which
// is not itself a mutation failure — the write already succeeded.
async function revalidateWorkspace(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  actionLabel: string,
) {
  const { data: workspaceRow } = await admin
    .from("workspaces")
    .select("slug")
    .eq("id", workspaceId)
    .maybeSingle();

  if (workspaceRow?.slug) {
    try {
      revalidatePath(`/w/${workspaceRow.slug}`, "layout");
    } catch (revalidateError) {
      logger.error(`${actionLabel}: revalidatePath failed (non-fatal)`, { error: revalidateError });
    }
  }
}

export type AddChecklistItemResult = ActionResult<{
        id: string;
        taskId: string;
        content: string;
        isChecked: boolean;
        position: number;
        createdAt: string;
      }>;

// Adds a checklist item to a task (write-path setup for AS-269 — the read
// side lives in F153's checklist UI). Pattern mirrors addComment
// (lib/actions/comments.ts): Zod-validated input, membership re-checked
// server-side (defense in depth), generic user-facing errors with details
// only logged server-side (AS-146). See this file's header comment for why
// the INSERT itself runs through the RLS-respecting client rather than the
// admin client.
export async function addChecklistItem(
  taskId: string,
  content: string,
): Promise<AddChecklistItemResult> {
  const parsed = addChecklistItemSchema.safeParse({ taskId, content });

  if (!parsed.success) {
    return {
      ok: false,
      error:
        parsed.error.issues[0]?.message ?? "Enter a valid checklist item.",
    };
  }

  const { supabase, user } = await getCurrentUser();

  if (!user) {
    return {
      ok: false,
      error: "You must be signed in to add a checklist item.",
    };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  // Look up the task's owning project/workspace so membership is checked
  // against the real workspace, never one supplied by the caller. A
  // soft-deleted task behaves as "not found", same convention as
  // addComment's task lookup.
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

  const membership = await requireActiveMembership(
    admin,
    workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to add a checklist item to this task.",
    };
  }

  // Editing a checklist is editing the task: owner/admin/member only
  // (`canEditTask`). The checklist_items RLS policies enforce the same
  // team-writer rule for the session-bound writes below.
  if (!canEditTask({ role: membership.role })) {
    return {
      ok: false,
      error: "You don't have permission to add a checklist item to this task.",
    };
  }

  // Append to the end of this task's checklist, same "look up the current
  // last position and hand it to calculatePosition as prevPosition with no
  // nextPosition" convention createTask uses for board columns
  // (lib/actions/tasks.ts). Never reimplements the fractional-index maths
  // itself — lib/board/position.ts's calculatePosition (F101's
  // bound-safety fix included) is the single source of that logic. Reads
  // through the RLS-respecting client: the caller is already a verified
  // active member at this point, and SELECT on checklist_items has been
  // permitted for active members since F151.
  const { data: lastItem } = await supabase
    .from("checklist_items")
    .select("position")
    .eq("task_id", parsed.data.taskId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const newPosition = calculatePosition(lastItem?.position ?? null, null);

  const { data: inserted, error: insertError } = await supabase
    .from("checklist_items")
    .insert({
      task_id: parsed.data.taskId,
      content: parsed.data.content,
      position: newPosition,
    })
    .select("id, task_id, content, is_checked, position, created_at")
    .single();

  if (insertError || !inserted) {
    logger.error("addChecklistItem: insert failed", { error: insertError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  await revalidateWorkspace(admin, workspaceId, "addChecklistItem");

  return {
    ok: true,
    data: {
      id: inserted.id,
      taskId: inserted.task_id,
      content: inserted.content,
      isChecked: inserted.is_checked,
      position: inserted.position,
      createdAt: inserted.created_at,
    },
  };
}

export type ToggleChecklistItemResult = ActionResult<{
        id: string;
        isChecked: boolean;
        checkedBy: string | null;
        checkedAt: string | null;
      }>;

// Checks/unchecks a checklist item (AS-270: must persist immediately and
// survive a reload). This is the highest-frequency mutation in this
// feature — per the Clarified implementation it must be optimistic on the
// client; F153 (the checklist UI feature) owns the actual optimistic
// update + rollback-on-failure behaviour. This action's job is to make
// that reconciliation possible: it returns the full persisted state
// (API/contract answer: "the discriminated-union result plus the minimum
// data the UI needs to reconcile optimistically") rather than a bare
// boolean, so the client can confirm or roll back its optimistic guess
// against what the server actually persisted.
//
// `isChecked` is the caller's TARGET state, not "flip whatever it is
// now" (toggleChecklistItemSchema) — this makes a repeated call with the
// same value idempotent-safe rather than a flip-flop race, and is what
// makes the no-op branch below well-defined.
//
// checked_by/checked_at are set from server-verified data only: checking
// an item stamps the caller's own user id and the current server time;
// unchecking clears both. Neither is ever accepted from client input.
export async function toggleChecklistItem(
  itemId: string,
  isChecked: boolean,
): Promise<ToggleChecklistItemResult> {
  const parsed = toggleChecklistItemSchema.safeParse({ itemId, isChecked });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid checklist item.",
    };
  }

  const { supabase, user } = await getCurrentUser();

  if (!user) {
    return {
      ok: false,
      error: "You must be signed in to update a checklist item.",
    };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: membership/permission check via requireActiveMembership(); caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();
  const context = await loadChecklistItemContext(admin, parsed.data.itemId);

  if (!context) {
    return { ok: false, error: "Checklist item not found." };
  }

  const membership = await requireActiveMembership(
    admin,
    context.workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to update this checklist item.",
    };
  }

  // Editing a checklist is editing the task: owner/admin/member only
  // (`canEditTask`). The checklist_items RLS policies enforce the same
  // team-writer rule for the session-bound writes below.
  if (!canEditTask({ role: membership.role })) {
    return {
      ok: false,
      error: "You don't have permission to update this checklist item.",
    };
  }

  // No-op input (Clarified implementation's empty/zero-state answer): the
  // requested state already matches the current state — return ok without
  // writing, so the UI shows no error toast for an intentional no-op.
  if (context.isChecked === parsed.data.isChecked) {
    return {
      ok: true,
      data: {
        id: context.id,
        isChecked: context.isChecked,
        checkedBy: context.checkedBy,
        checkedAt: context.checkedAt,
      },
    };
  }

  const { data: updated, error: updateError } = await supabase
    .from("checklist_items")
    .update({
      is_checked: parsed.data.isChecked,
      checked_by: parsed.data.isChecked ? user.id : null,
      checked_at: parsed.data.isChecked ? new Date().toISOString() : null,
    })
    .eq("id", parsed.data.itemId)
    .select("id, is_checked, checked_by, checked_at")
    .single();

  if (updateError || !updated) {
    logger.error("toggleChecklistItem: update failed", { error: updateError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  await revalidateWorkspace(admin, context.workspaceId, "toggleChecklistItem");

  return {
    ok: true,
    data: {
      id: updated.id,
      isChecked: updated.is_checked,
      checkedBy: updated.checked_by,
      checkedAt: updated.checked_at,
    },
  };
}

export type RenameChecklistItemResult = ActionResult<{ id: string; content: string }>;

// Renames (edits the text of) a checklist item (AS-271).
export async function renameChecklistItem(
  itemId: string,
  content: string,
): Promise<RenameChecklistItemResult> {
  const parsed = renameChecklistItemSchema.safeParse({ itemId, content });

  if (!parsed.success) {
    return {
      ok: false,
      error:
        parsed.error.issues[0]?.message ?? "Enter a valid checklist item.",
    };
  }

  const { supabase, user } = await getCurrentUser();

  if (!user) {
    return {
      ok: false,
      error: "You must be signed in to rename a checklist item.",
    };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: membership/permission check via requireActiveMembership(); caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();
  const context = await loadChecklistItemContext(admin, parsed.data.itemId);

  if (!context) {
    return { ok: false, error: "Checklist item not found." };
  }

  const membership = await requireActiveMembership(
    admin,
    context.workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to rename this checklist item.",
    };
  }

  // Editing a checklist is editing the task: owner/admin/member only
  // (`canEditTask`). The checklist_items RLS policies enforce the same
  // team-writer rule for the session-bound writes below.
  if (!canEditTask({ role: membership.role })) {
    return {
      ok: false,
      error: "You don't have permission to rename this checklist item.",
    };
  }

  // No-op input: renaming to the exact same (already-trimmed) text is a
  // safe no-write no-op, same convention as toggleChecklistItem.
  if (context.content === parsed.data.content) {
    return { ok: true, data: { id: context.id, content: context.content } };
  }

  const { data: updated, error: updateError } = await supabase
    .from("checklist_items")
    .update({ content: parsed.data.content })
    .eq("id", parsed.data.itemId)
    .select("id, content")
    .single();

  if (updateError || !updated) {
    logger.error("renameChecklistItem: update failed", { error: updateError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  await revalidateWorkspace(admin, context.workspaceId, "renameChecklistItem");

  return { ok: true, data: { id: updated.id, content: updated.content } };
}

export type ReorderChecklistItemResult = ActionResult<{ id: string; position: number }>;

// Persists a checklist item's new `position` after a drag-and-drop
// reorder (AS-271). Mirrors reorderTask's division of responsibility
// (lib/actions/tasks.ts): the CALLER (the future checklist UI, F153)
// computes the new fractional-index value via lib/board/position.ts's
// calculatePosition from the dropped item's new neighbors, and this
// action only persists that already-computed value. This action does
// NOT call calculatePosition itself and does not reimplement any of its
// maths — only addChecklistItem's append-to-end path does that, same
// split as createTask vs reorderTask in tasks.ts.
export async function reorderChecklistItem(
  itemId: string,
  newPosition: number,
): Promise<ReorderChecklistItemResult> {
  const parsed = reorderChecklistItemSchema.safeParse({
    itemId,
    position: newPosition,
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid position.",
    };
  }

  const { supabase, user } = await getCurrentUser();

  if (!user) {
    return {
      ok: false,
      error: "You must be signed in to reorder a checklist item.",
    };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: membership/permission check via requireActiveMembership(); caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();
  const context = await loadChecklistItemContext(admin, parsed.data.itemId);

  if (!context) {
    return { ok: false, error: "Checklist item not found." };
  }

  const membership = await requireActiveMembership(
    admin,
    context.workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to reorder this checklist item.",
    };
  }

  // Editing a checklist is editing the task: owner/admin/member only
  // (`canEditTask`). The checklist_items RLS policies enforce the same
  // team-writer rule for the session-bound writes below.
  if (!canEditTask({ role: membership.role })) {
    return {
      ok: false,
      error: "You don't have permission to reorder this checklist item.",
    };
  }

  if (context.position === parsed.data.position) {
    return { ok: true, data: { id: context.id, position: context.position } };
  }

  const { data: updated, error: updateError } = await supabase
    .from("checklist_items")
    .update({ position: parsed.data.position })
    .eq("id", parsed.data.itemId)
    .select("id, position")
    .single();

  if (updateError || !updated) {
    logger.error("reorderChecklistItem: update failed", { error: updateError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  await revalidateWorkspace(admin, context.workspaceId, "reorderChecklistItem");

  return { ok: true, data: { id: updated.id, position: updated.position } };
}

export type DeleteChecklistItemResult = ActionResult<{ id: string }>;

// Hard-deletes a checklist item (AS-271). checklist_items has no
// deleted_at column (F151's migration deliberately omitted one), so
// unlike deleteTask/deleteComment this is a real DELETE, not a
// soft-delete flag flip.
//
// Any active member of the task's workspace may delete any checklist
// item — no per-item author/ownership restriction, matching the RLS
// policy's shape
// (supabase/migrations/20260819080358_checklist_items_update_delete_policies.sql)
// and F151's handoff note that checklist items are task-owned state, not
// user-authored content like a comment.
export async function deleteChecklistItem(
  itemId: string,
): Promise<DeleteChecklistItemResult> {
  const parsed = deleteChecklistItemSchema.safeParse({ itemId });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid checklist item.",
    };
  }

  const { supabase, user } = await getCurrentUser();

  if (!user) {
    return {
      ok: false,
      error: "You must be signed in to delete a checklist item.",
    };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: membership/permission check via requireActiveMembership(); caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();
  const context = await loadChecklistItemContext(admin, parsed.data.itemId);

  if (!context) {
    return { ok: false, error: "Checklist item not found." };
  }

  const membership = await requireActiveMembership(
    admin,
    context.workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to delete this checklist item.",
    };
  }

  // Editing a checklist is editing the task: owner/admin/member only
  // (`canEditTask`). The checklist_items RLS policies enforce the same
  // team-writer rule for the session-bound writes below.
  if (!canEditTask({ role: membership.role })) {
    return {
      ok: false,
      error: "You don't have permission to delete this checklist item.",
    };
  }

  // `.select("id")` after delete so a silently-affected-zero-rows outcome
  // (e.g. a concurrent delete between the lookup above and this statement,
  // or — the scenario this feature exists to guard against — an RLS
  // policy that doesn't actually permit this) is treated as a failure
  // rather than a false "ok: true", same defensive convention
  // `.select().single()` gives every UPDATE in this file.
  const { data: deletedRows, error: deleteError } = await supabase
    .from("checklist_items")
    .delete()
    .eq("id", parsed.data.itemId)
    .select("id");

  if (deleteError || !deletedRows || deletedRows.length === 0) {
    logger.error("deleteChecklistItem: delete failed", { error: deleteError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  await revalidateWorkspace(admin, context.workspaceId, "deleteChecklistItem");

  return { ok: true, data: { id: context.id } };
}
