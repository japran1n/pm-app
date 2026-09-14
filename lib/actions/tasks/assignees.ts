"use server";

import {
  assignTaskSchema,
  addTaskAssigneeSchema,
  removeTaskAssigneeSchema,
  setTaskAssigneesSchema,
} from "@/lib/validation/tasks";
import { logger } from "@/lib/observability/logger";
import { requireAssignActionContext, setTaskAssigneesCore, type TaskAssigneesActionResult } from "./shared";
import type { ActionResult } from "@/lib/actions/authz";

export type AssignTaskResult = ActionResult<{
        id: string;
        assigneeId: string | null;
      }>;

// Assigns (or unassigns) a task (F036: AS-051, AS-052, AS-053). Kept as the
// single-assignee entry point every existing caller already uses; now
// delegates to `setTaskAssigneesCore` (F160) so a call through this
// function writes both `task_assignees` and the deprecated
// `tasks.assignee_id` mirror in one atomic-per-row write path, rather than
// writing `assignee_id` directly the way this action used to.
//
// assigneeId === null means "unassign" (AS-053) and is a valid, explicit
// input — never treated as "no change". AS-052 (assignee must be a
// workspace member) is now the stricter AS-290 project-visibility check,
// enforced by `setTaskAssigneesCore` -> `filterProjectVisibleUserIds`.
export async function assignTask(
  taskId: string,
  assigneeId: string | null,
): Promise<AssignTaskResult> {
  const parsed = assignTaskSchema.safeParse({ taskId, assigneeId });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Enter valid assignment details.",
    };
  }

  const result = await setTaskAssigneesCore(
    parsed.data.taskId,
    parsed.data.assigneeId === null ? [] : [parsed.data.assigneeId],
  );

  if (!result.ok) return result;

  return {
    ok: true,
    data: { id: result.data.taskId, assigneeId: result.data.mirrorAssigneeId },
  };
}

export type SetTaskAssigneesResult = TaskAssigneesActionResult;

// F160 (AS-289, AS-290): replaces a task's entire assignee set in one call.
// See `setTaskAssigneesCore`'s doc comment for the write/validation
// semantics this and every other multi-assignee action below share.
export async function setTaskAssignees(
  taskId: string,
  userIds: string[],
): Promise<SetTaskAssigneesResult> {
  const parsed = setTaskAssigneesSchema.safeParse({ taskId, userIds });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Enter valid assignees.",
    };
  }

  return setTaskAssigneesCore(parsed.data.taskId, parsed.data.userIds);
}

export type AddTaskAssigneeResult = TaskAssigneesActionResult;

// F160 (AS-290): adds exactly one assignee to a task's existing set,
// leaving every other current assignee untouched. Implemented as
// setTaskAssigneesCore(taskId, [...current, userId]) rather than a direct
// single-row INSERT so it goes through the exact same AS-290
// project-visibility validation, zero-state no-op, and mirror-sync logic
// as setTaskAssignees/removeTaskAssignee — one real write path behind all
// three (see the block-level doc comment above assignTask).
export async function addTaskAssignee(
  taskId: string,
  userId: string,
): Promise<AddTaskAssigneeResult> {
  const parsed = addTaskAssigneeSchema.safeParse({ taskId, userId });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Enter a valid assignee.",
    };
  }

  const preflight = await requireAssignActionContext(parsed.data.taskId);
  if (!preflight.ok) return preflight;

  const { data: currentRows, error: currentError } = await preflight.admin
    .from("task_assignees")
    .select("user_id")
    .eq("task_id", parsed.data.taskId);

  if (currentError) {
    logger.error("addTaskAssignee: failed to read current assignees", { error: currentError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const currentUserIds = (currentRows ?? []).map((row) => row.user_id as string);

  return setTaskAssigneesCore(parsed.data.taskId, [
    ...currentUserIds,
    parsed.data.userId,
  ]);
}

export type RemoveTaskAssigneeResult = TaskAssigneesActionResult;

// F160 (AS-289): removes exactly one assignee from a task's existing set
// without affecting any other assignee. Implemented as
// setTaskAssigneesCore(taskId, current.filter(id => id !== userId)) — see
// addTaskAssignee's doc comment for why this goes through the shared core
// rather than a direct DELETE.
export async function removeTaskAssignee(
  taskId: string,
  userId: string,
): Promise<RemoveTaskAssigneeResult> {
  const parsed = removeTaskAssigneeSchema.safeParse({ taskId, userId });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Enter a valid assignee.",
    };
  }

  const preflight = await requireAssignActionContext(parsed.data.taskId);
  if (!preflight.ok) return preflight;

  const { data: currentRows, error: currentError } = await preflight.admin
    .from("task_assignees")
    .select("user_id")
    .eq("task_id", parsed.data.taskId);

  if (currentError) {
    logger.error("removeTaskAssignee: failed to read current assignees", { error: currentError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const currentUserIds = (currentRows ?? []).map((row) => row.user_id as string);

  return setTaskAssigneesCore(
    parsed.data.taskId,
    currentUserIds.filter((id) => id !== parsed.data.userId),
  );
}

