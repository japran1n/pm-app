"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  assignTaskSchema,
  addTaskAssigneeSchema,
  removeTaskAssigneeSchema,
  setTaskAssigneesSchema,
  editTaskSchema,
  deleteTaskSchema,
  restoreTaskSchema,
  updateTaskTagsSchema,
  moveTaskStatusSchema,
  reorderTaskSchema,
  moveAndReorderTaskSchema,
  promoteSubtaskSchema,
  getOpenBlockersSchema,
  toggleDescriptionChecklistItemSchema,
  duplicateTaskSchema,
  bulkUpdateTasksSchema,
  bulkDeleteTasksSchema,
  type EditTaskUpdates,
  type BulkUpdateTasksUpdates,
} from "@/lib/validation/tasks";
import { logger } from "@/lib/observability/logger";
import type { JSONContent } from "@/components/editor/rich-text-editor";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { withAuthz } from "@/lib/actions/authz";
import { canWrite, canEditTask, type WorkspaceRole } from "@/lib/auth/permissions";
import {
  isProjectVisibleToCaller,
  type ProjectVisibility,
} from "@/lib/actions/project-visibility";
import { calculatePosition } from "@/lib/board/position";
import { isDoneStatus } from "@/lib/tasks/blocked-guard";
import { cloneTaskFields } from "@/lib/recurrence/clone-fields";
import { generateNextOccurrence } from "@/lib/recurrence/generate-next-occurrence";
import { getCurrentUserTimezone } from "@/lib/queries/profile";
import {
  diffTaskFields,
  writeTaskFieldChanges,
  type TaskFieldChange,
} from "@/lib/activity/task-activity";
import { sanitiseMentionsForVisibility } from "@/lib/comments/mentions";
import {
  extractNewlyMentionedIds,
  notifyNewlyMentionedUsers,
} from "@/lib/notifications/mentions";
import { computeFanoutRecipients } from "@/lib/notifications/fanout";
import { filterRecipientsByInAppPreference } from "@/lib/notifications/preferences";
import { createNotification } from "@/lib/notifications/create-notification";
import type { Json } from "@/lib/supabase/database.types";
import { createTaskForUser } from "@/lib/tasks/create";
import type { TaskDetailSheetTask } from "@/components/task/task-detail-sheet";
import type { TaskComment } from "@/components/task/comment-list";
import type { TaskAttachment } from "@/components/task/attachment-list";
import type { SubtaskListChildTask } from "@/components/task/subtask-list";
import type { ChecklistListItem } from "@/components/task/checklist";
import type { DependencyRelatedTask } from "@/components/task/dependencies";

export type CreateTaskResult =
  | {
      ok: true;
      data: {
        id: string;
        projectId: string;
        title: string;
        description: string | null;
        status: string;
        priority: string | null;
        assigneeId: string | null;
        dueDate: string | null;
        authorId: string;
        position: number;
        createdAt: string;
        // F149 (AS-267/AS-268 setup): null for a top-level task, the
        // parent's id for a subtask.
        parentTaskId: string | null;
        // F296 (AS-563): the project-sequential number F145's DB trigger
        // assigns on insert — exposed here so callers can combine it with
        // the owning project's key (lib/tasks/task-key.ts's
        // formatTaskKey(), the ONE formatter for this) without a second
        // round trip. Every existing caller of createTask/createTaskForUser
        // already destructures only the specific fields it needs, so this
        // additive field is backward compatible.
        number: number;
      };
    }
  | { ok: false; error: string };

// Creates a task within a project (AS-043, AS-044, AS-045, AS-046). Pattern
// mirrors lib/actions/projects.ts's createProject: Zod-validated input,
// membership re-checked server-side (defense in depth, AS-143), admin
// client used for the actual insert (RLS on `tasks` —
// supabase/migrations/20260818013805_rls_tasks.sql — would also allow this
// same insert for an active member; the admin client is used here only
// because this action has already independently re-verified membership
// itself, consistent with the rest of this file's siblings),
// discriminated-union return, generic user-facing errors with details only
// logged server-side (AS-146).
//
// Unlike projects (which are workspace-scoped directly), tasks are
// project-scoped, and a project has no workspace_id of its own on the
// caller's side — the project's workspace_id is looked up server-side so
// membership can be checked against the *real* owning workspace, never a
// workspace_id supplied (or omitted) by the client.
//
// position: F035 originally assigned a simple placeholder default (0).
// F046 supersedes that here: a newly created task must be appended to the
// end of its column's position order (AS-079), computed via
// lib/board/position.ts's calculatePosition against the current last task
// in that (project, status) column — never a hardcoded constant. F149:
// this applies identically whether or not `parentTaskId` is set — a
// subtask is appended to the end of its OWN (project, status) column,
// the same axis every top-level task shares (per this feature's
// migration doc comment: a subtask is already a normal card).
//
// parentTaskId (F149, AS-267/AS-268 setup): optional. When present, this
// creates a one-level subtask of the given parent task rather than a
// top-level task — the single entry point for creating a subtask, per
// this feature's Clarified implementation ("extend the existing task
// create action ... do not create a parallel create-subtask path"). The
// parent row is looked up and validated server-side (exists, not
// deleted, same project, itself top-level) before the insert is
// attempted, so a bad parentTaskId maps to a specific user-facing error
// rather than surfacing the database trigger's raw exception text
// (enforce_task_parent_rules(), F148) — that trigger is still the final
// enforcement gate for any race between this check and the insert.
//
// SECURITY (F336, identical class to M17 scrutiny BLOCKER-3/F334): this is
// the ONLY exported function in this "use server" module that touches the
// shared create-task implementation, and it is deliberately the ONLY one —
// every exported async function in a "use server" module is a
// client-invocable Server Action endpoint reachable by ID regardless of
// whether any UI calls it. The actual creation logic (including a raw,
// trusted `userId` parameter) now lives in lib/tasks/create.ts, a plain
// module with no "use server" directive, so it is only reachable via a
// real import — never a network-addressable action. `userId` below is
// resolved from the caller's own authenticated cookie session, never
// accepted as an argument, so this Server Action can never be used to act
// as another user.
export async function createTask(
  projectId: string,
  title: string,
  description?: string | null,
  // F248 (AS-479): widened from the original fixed four-value union to
  // any string — see createTaskSchema's own doc comment in
  // lib/validation/tasks.ts for why (project boards have real per-project
  // columns since F221; a caller passing one of the original four literal
  // values still type-checks unchanged, since that union is a subtype of
  // string).
  status?: string,
  priority?: "urgent" | "high" | "medium" | "low" | "backlog" | null,
  assigneeId?: string | null,
  dueDate?: string | null,
  parentTaskId?: string | null,
): Promise<CreateTaskResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to create a task." };
  }

  return createTaskForUser(
    user.id,
    {
      projectId,
      title,
      description,
      status,
      priority,
      assigneeId,
      dueDate,
      parentTaskId,
    },
    // F306 (D9/FU-3 scrutiny fix, AS-380): the caller's own authenticated
    // session, so a task created with an initial assignee can notify that
    // assignee (create_notification pins actor_id via auth.uid()).
    supabase,
  );
}

export type AssignTaskResult =
  | {
      ok: true;
      data: {
        id: string;
        assigneeId: string | null;
      };
    }
  | { ok: false; error: string };

// ---------------------------------------------------------------------
// F160: multi-assignee actions over `task_assignees` (AS-289, AS-290).
//
// `assignTask` (F036) is kept as the single-assignee entry point every
// existing caller (task-detail-sheet.tsx, the create-task flow, and
// tests/integration/assign-task.test.ts) already uses — its signature and
// AssignTaskResult shape are unchanged. It is now a thin wrapper around
// `setTaskAssigneesCore` below (assigneeId === null -> empty set,
// otherwise a one-element set), so a single-assignee call through the old
// entry point writes BOTH `task_assignees` and the deprecated
// `tasks.assignee_id` mirror, and a multi-assignee call through the new
// `addTaskAssignee`/`removeTaskAssignee`/`setTaskAssignees` entry points
// keeps that same mirror in sync — there is exactly one write path
// (`setTaskAssigneesCore`'s diff-and-write + `syncMirrorAssigneeId`) behind
// both.
// ---------------------------------------------------------------------

type TaskAssignContext = {
  workspaceId: string;
  projectId: string;
  visibility: ProjectVisibility;
};

// Loads task -> project -> workspace context for assignment actions.
// Mirrors the "deleted_at is null, else not found" convention every
// sibling action in this file already uses for its own task lookup.
async function loadTaskAssignContext(
  admin: ReturnType<typeof createAdminClient>,
  taskId: string,
): Promise<{ ok: true; context: TaskAssignContext } | { ok: false }> {
  const { data: taskRow, error } = await admin
    .from("tasks")
    .select("id, deleted_at, projects!inner(id, workspace_id, visibility)")
    .eq("id", taskId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !taskRow) return { ok: false };

  const project = Array.isArray(taskRow.projects)
    ? taskRow.projects[0]
    : taskRow.projects;

  if (!project?.workspace_id) return { ok: false };

  return {
    ok: true,
    context: {
      workspaceId: project.workspace_id,
      projectId: project.id,
      visibility: (project.visibility as ProjectVisibility) ?? "workspace",
    },
  };
}

// AS-290: re-implements `public.is_project_visible_to`'s rule
// (supabase/migrations/20260821140526_project_visibility_rls_sweep.sql) in
// application code. Every action in this file uses the admin client, which
// bypasses RLS entirely by design (see the module-level doc comments on
// createTask/editTask above) — so the visibility check RLS would otherwise
// provide has to be re-run explicitly here, exactly like every other
// "defense in depth" re-check in this file (AS-143). A candidate user id is
// assignable only if they are an ACTIVE workspace member of the task's
// workspace AND (the project is 'workspace'-visible, OR they're a
// workspace owner/admin, OR they have an explicit project_members row for
// this project) — a guest, or an otherwise-active workspace member, who
// lacks access to a private project is rejected even though they are
// technically an active workspace member (AS-290's exact scenario).
//
// One query per input (workspace_members, then project_members only when
// the project is private) — bounded by the size of the caller-supplied
// candidate list, never a per-existing-row loop over the task's current
// assignees (this feature's performance-budget answer).
async function filterProjectVisibleUserIds(
  admin: ReturnType<typeof createAdminClient>,
  context: TaskAssignContext,
  candidateUserIds: string[],
): Promise<Set<string>> {
  if (candidateUserIds.length === 0) return new Set();

  const { data: memberRows } = await admin
    .from("workspace_members")
    .select("user_id, role")
    .eq("workspace_id", context.workspaceId)
    .eq("status", "active")
    .in("user_id", candidateUserIds);

  const activeRoleById = new Map<string, WorkspaceRole>(
    (memberRows ?? []).map((row) => [
      row.user_id as string,
      row.role as WorkspaceRole,
    ]),
  );

  if (context.visibility === "workspace") {
    return new Set(activeRoleById.keys());
  }

  // Private project: only workspace owners/admins, or candidates with an
  // explicit project_members row for THIS project, are assignable.
  const { data: explicitRows } = await admin
    .from("project_members")
    .select("user_id")
    .eq("project_id", context.projectId)
    .in("user_id", candidateUserIds);

  const explicitIds = new Set(
    (explicitRows ?? [])
      .map((row) => row.user_id as string)
      .filter(Boolean),
  );

  const visible = new Set<string>();
  for (const [userId, role] of activeRoleById) {
    if (role === "owner" || role === "admin" || explicitIds.has(userId)) {
      visible.add(userId);
    }
  }
  return visible;
}

// F160 clarification, ambiguity Q1 ("decide the deprecated-column mirror
// rule: first assignee, or null when there are several"). Resolved per the
// ambiguity-resolution default (simpler option, no second source of
// truth) as "always the first assignee, never null while at least one
// assignee exists" — a mirror that goes null the instant a second
// assignee is added would silently break every existing reader of
// `tasks.assignee_id` (board grouping, my-tasks, notifications) for a task
// that still very much has an assignee, which is a worse
// transition-period regression than a mirror that only ever names ONE of
// several assignees. "First" = the earliest `task_assignees.created_at`
// row for this task, ties broken by `user_id` for determinism. Zero
// assignees mirrors to null (AS-053's existing "unassign" meaning is
// unchanged).
function resolveMirrorAssigneeId(
  rows: Array<{ user_id: string; created_at: string }>,
): string | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => {
    const byTime = a.created_at.localeCompare(b.created_at);
    if (byTime !== 0) return byTime;
    return a.user_id.localeCompare(b.user_id);
  });
  return sorted[0].user_id;
}

// Re-reads the task's current `task_assignees` rows and writes the
// resolved mirror value to `tasks.assignee_id` — the single place this
// column is written from the multi-assignee code path, so it can never
// drift from what `task_assignees` actually contains (F207 notifications,
// which read `assignee_id`, therefore see one consistent value regardless
// of which of the three actions below changed the underlying set).
async function syncMirrorAssigneeId(
  admin: ReturnType<typeof createAdminClient>,
  taskId: string,
): Promise<string | null> {
  const { data: rows } = await admin
    .from("task_assignees")
    .select("user_id, created_at")
    .eq("task_id", taskId);

  const mirror = resolveMirrorAssigneeId(rows ?? []);

  await admin.from("tasks").update({ assignee_id: mirror }).eq("id", taskId);

  return mirror;
}

type TaskAssigneesData = {
  taskId: string;
  assigneeIds: string[];
  mirrorAssigneeId: string | null;
};

type TaskAssigneesActionResult =
  | { ok: true; data: TaskAssigneesData }
  | { ok: false; error: string };

// Shared preflight for every multi-assignee action: resolves the caller's
// identity, the task's owning project/workspace (not-found for a missing
// or soft-deleted task), re-verifies workspace membership + edit
// permission server-side (AS-143's defense-in-depth convention, same as
// every sibling action in this file), and hands back the admin client plus
// resolved context so each caller only has to run its own specific write.
async function requireAssignActionContext(taskId: string): Promise<
  | {
      ok: true;
      admin: ReturnType<typeof createAdminClient>;
      supabase: Awaited<ReturnType<typeof createClient>>;
      userId: string;
      context: TaskAssignContext;
    }
  | { ok: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to change assignees." };
  }

  const admin = createAdminClient();

  const taskContext = await loadTaskAssignContext(admin, taskId);
  if (!taskContext.ok) {
    return { ok: false, error: "Task not found." };
  }

  const membership = await requireActiveMembership(
    admin,
    taskContext.context.workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to change this task's assignees.",
    };
  }

  // Per this feature's Clarified implementation ("permission-checked
  // (canEditTask or similar)"): `canEditTask` mirrors editTask's own gate
  // above (viewers and guests are read-only, AS-216/AS-217; every other
  // active role may edit any task in the workspace, AS-061).
  if (!canEditTask({ role: membership.role })) {
    return {
      ok: false,
      error: "You don't have permission to change this task's assignees.",
    };
  }

  // F322 (AS-227, AS-228): the caller must be able to SEE this task's
  // project themselves, not just be an active workspace member — see
  // isProjectVisibleToCaller's doc comment above. Same generic message as
  // the membership/role failures above so a private project's existence is
  // never disclosed to someone who can't see it.
  const visible = await isProjectVisibleToCaller(
    admin,
    taskContext.context,
    user.id,
    membership.role,
  );
  if (!visible) {
    return {
      ok: false,
      error: "You don't have permission to change this task's assignees.",
    };
  }

  return {
    ok: true,
    admin,
    supabase,
    userId: user.id,
    context: taskContext.context,
  };
}

async function revalidateWorkspaceForTaskAssignment(
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
      // Non-fatal cache-freshness rationale, same as createTask above.
      logger.error(`${actionLabel}: revalidatePath failed (non-fatal)`, { error: revalidateError });
    }
  }
}

// The one real write path behind assignTask/addTaskAssignee/
// removeTaskAssignee/setTaskAssignees: replaces a task's entire assignee
// set with `desiredUserIds`, validating every desired id against AS-290's
// project-visibility rule first (the whole call is rejected, nothing is
// written, if ANY desired id fails that check — never a partial
// assignment). AS-289 falls out of this by construction: removing one
// assignee (a desired set missing just that one id) computes a diff whose
// `toRemove` is exactly that one row; the DELETE is scoped to
// `(task_id, user_id)` pairs, so it can never touch any other assignee's
// row.
//
// Zero-state (Clarified implementation Q6, same convention as
// promoteSubtask above): when the desired set already equals the current
// set, this returns ok without writing anything — no DELETE/INSERT, no
// mirror recompute, no revalidatePath.
async function setTaskAssigneesCore(
  taskId: string,
  desiredUserIdsInput: string[],
): Promise<TaskAssigneesActionResult> {
  const preflight = await requireAssignActionContext(taskId);
  if (!preflight.ok) return preflight;
  const { admin, supabase, userId, context } = preflight;

  const desiredUserIds = Array.from(new Set(desiredUserIdsInput));

  if (desiredUserIds.length > 0) {
    const visible = await filterProjectVisibleUserIds(
      admin,
      context,
      desiredUserIds,
    );
    const invalid = desiredUserIds.filter((id) => !visible.has(id));
    if (invalid.length > 0) {
      return {
        ok: false,
        error:
          "One or more selected people don't have access to this task's project.",
      };
    }
  }

  const { data: currentRows, error: currentError } = await admin
    .from("task_assignees")
    .select("user_id")
    .eq("task_id", taskId);

  if (currentError) {
    logger.error("setTaskAssigneesCore: failed to read current assignees", { error: currentError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const currentUserIds = (currentRows ?? []).map((row) => row.user_id as string);
  const currentSet = new Set(currentUserIds);
  const desiredSet = new Set(desiredUserIds);

  const toRemove = currentUserIds.filter((id) => !desiredSet.has(id));
  const toAdd = desiredUserIds.filter((id) => !currentSet.has(id));

  if (toRemove.length === 0 && toAdd.length === 0) {
    // Zero-state no-op: read the already-correct mirror rather than
    // recomputing it, since nothing changed.
    const { data: taskRow } = await admin
      .from("tasks")
      .select("assignee_id")
      .eq("id", taskId)
      .maybeSingle();
    return {
      ok: true,
      data: {
        taskId,
        assigneeIds: desiredUserIds,
        mirrorAssigneeId: taskRow?.assignee_id ?? null,
      },
    };
  }

  // Atomic: DELETE removed assignees + INSERT added assignees + recompute
  // the `tasks.assignee_id` mirror all happen inside a single Postgres
  // function/transaction, so a failure partway through can never leave
  // the task with a stripped or partial assignee set (see migration
  // 20260905050000_set_task_assignees_atomic.sql).
  const { data: mirrorResult, error: rpcError } = await admin.rpc(
    "set_task_assignees_atomic",
    {
      p_task_id: taskId,
      p_desired_user_ids: desiredUserIds,
      p_assigned_by: userId,
    },
  );

  if (rpcError) {
    logger.error("setTaskAssigneesCore: set_task_assignees_atomic failed", { error: rpcError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const mirror = (mirrorResult as string | null) ?? null;

  // F207 (AS-380, AS-384): notify every newly-added assignee
  // (`toAdd` — never a re-notify of someone already assigned, and never
  // the actor themselves, per computeFanoutRecipients's actor-exclusion).
  // Non-fatal, same convention as every other post-write side effect in
  // this function — the assignment itself already succeeded above. Uses
  // the caller's own authenticated session (`supabase`, not `admin`) so
  // `create_notification`'s SECURITY DEFINER function can pin `actor_id`
  // to `auth.uid()` server-side (F206's spoofing fix) — an admin/service-
  // role call would have no `auth.uid()` and would be rejected as
  // unauthenticated for a non-system notification.
  try {
    const computedRecipients = computeFanoutRecipients({
      type: "assigned",
      actorId: userId,
      assigneeIds: toAdd,
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
          workspaceId: context.workspaceId,
          kind: recipient.kind,
          taskId,
        },
        "setTaskAssigneesCore",
      );
    }
  } catch (fanoutError) {
    logger.error("setTaskAssigneesCore: notification fan-out failed (non-fatal)", { error: fanoutError });
  }

  // F306 (D9/FU-3 scrutiny fix, AS-353, AS-355): record every assignee
  // added/removed by this call, not just a change to the mirror column.
  // The prior implementation ONLY diffed `mirrorBefore`/`mirror` (the
  // deprecated single-assignee `tasks.assignee_id` projection —
  // resolveMirrorAssigneeId's doc comment), so adding/removing a
  // NON-first assignee on an already-multi-assignee task changed
  // `toAdd`/`toRemove` above but never touched the mirror column, and
  // silently wrote NO activity entry at all — exactly the scrutiny
  // report's finding. `toAdd`/`toRemove` (computed above from the real
  // `task_assignees` diff) are the actual full-set source of truth; one
  // 'assignee_id' field_changed entry per removed user (oldValue: that
  // user, newValue: null — "unassigned, was X") and per added user
  // (oldValue: null, newValue: that user — "assigned to X") reads
  // correctly through formatTaskActivityEntry's existing per-id
  // assignee_id rendering (lib/activity/format-task-activity-entry.ts),
  // without inventing a new field/kind. Non-fatal.
  try {
    const changes: TaskFieldChange[] = [
      ...toRemove.map((removedId) => ({
        field: "assignee_id" as const,
        oldValue: removedId,
        newValue: null,
      })),
      ...toAdd.map((addedId) => ({
        field: "assignee_id" as const,
        oldValue: null,
        newValue: addedId,
      })),
    ];
    await writeTaskFieldChanges(supabase, taskId, changes);
  } catch (activityError) {
    logger.error("setTaskAssigneesCore: writeTaskFieldChanges failed (non-fatal)", { error: activityError });
  }

  await revalidateWorkspaceForTaskAssignment(
    admin,
    context.workspaceId,
    "setTaskAssigneesCore",
  );

  return {
    ok: true,
    data: { taskId, assigneeIds: desiredUserIds, mirrorAssigneeId: mirror },
  };
}

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

export type EditTaskResult =
  | {
      ok: true;
      data: {
        id: string;
        title: string;
        description: string | null;
        /** F205 (AS-378): present only when `updates.descriptionJson` was
         * part of this call — the mention-sanitised document actually
         * persisted, so an optimistic caller can re-sync its local mirror
         * to the authoritative (possibly-stripped) value without a second
         * fetch, same "return what was actually written" convention as
         * `toggleDescriptionChecklistItem`. */
        descriptionJson?: JSONContent | null;
        priority: string | null;
        dueDate: string | null;
        // F236 (AS-453): mirrors dueDate's own always-present convention
        // (not descriptionJson's conditional one) — a plain scalar field
        // with no server-side transform, same shape as dueDate.
        startDate: string | null;
        estimateMinutes: number | null;
        // F005 (missions/20260903-portal, AS-014): mirrors startDate's
        // own always-present convention above.
        pageSlug: string | null;
        pageOrder: number | null;
        // F006c (missions/20260903-portal, AS-013): mirrors pageSlug's
        // own always-present convention above.
        phaseId: string | null;
      };
    }
  | { ok: false; error: string };

// Edits a task's title/description/priority/due date (F037: AS-054,
// AS-061). Pattern mirrors assignTask above: Zod-validated partial input,
// membership re-checked server-side (defense in depth, AS-143), admin
// client used for the actual update, discriminated union return, generic
// user-facing errors with details only logged server-side (AS-146).
//
// AS-061: any active workspace member may edit any task in that workspace,
// regardless of whether they authored it or are assigned to it — there is
// no per-task ownership check here, only workspace membership.
//
// AS-060: `updates` is typed as `EditTaskUpdates`
// (lib/validation/tasks.ts), which has no `projectId` field. Moving a task
// between projects is out of scope for v1 — this isn't a runtime check
// that rejects a projectId, it's the absence of any field that could carry
// one, so there is no code path here that could move a task between
// projects even by accident. Do not add a projectId field to
// `EditTaskUpdates` or to this function's update payload.
//
// Only fields actually present in `updates` are applied — an omitted field
// leaves the existing column value untouched (unlike createTask, which
// always writes every column).
export async function editTask(
  taskId: string,
  updates: EditTaskUpdates,
): Promise<EditTaskResult> {
  const parsed = editTaskSchema.safeParse({ taskId, updates });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Enter valid task details.",
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
    return { ok: false, error: "You must be signed in to edit a task." };
  }

  const admin = createAdminClient();

  // Look up the task's owning workspace (via its project) so membership is
  // checked against the real workspace, never one supplied by the caller.
  // A soft-deleted task behaves as "not found", same convention as
  // assignTask's task lookup.
  const { data: taskRow, error: taskError } = await admin
    .from("tasks")
    .select(
      // F205 (AS-378): `description_json` (needed to diff against the new
      // document — see extractNewlyMentionedIds call below) and the
      // project's own `id`/`visibility` (needed by
      // sanitiseMentionsForVisibility, mirroring lib/actions/comments.ts's
      // addComment/editComment) are added here alongside the pre-existing
      // columns; nothing else about this select changes.
      "id, deleted_at, title, priority, due_date, start_date, estimate_minutes, description_json, projects!inner(id, workspace_id, visibility)",
    )
    .eq("id", parsed.data.taskId)
    .is("deleted_at", null)
    .maybeSingle();

  if (taskError || !taskRow) {
    return { ok: false, error: "Task not found." };
  }

  const project = Array.isArray(taskRow.projects)
    ? taskRow.projects[0]
    : taskRow.projects;
  const workspaceId = project?.workspace_id;

  if (!workspaceId) {
    return { ok: false, error: "Task not found." };
  }

  // Defense in depth (AS-143): re-check the caller is an active member of
  // the task's workspace, server-side. AS-061: any role, no per-task
  // ownership/authorship check.
  const membership = await requireActiveMembership(
    admin,
    workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to edit this task.",
    };
  }

  // F128 (AS-216, AS-217): viewers are read-only (canWrite deliberately
  // does not exclude guest — see its doc comment in lib/auth/permissions.ts;
  // guest write access is separately scoped by F134's AS-223). Uses
  // `canEditTask` (identical viewer/guest gating to `canWrite` here, since
  // editTask has no ownership restriction — AS-061) so this stays wired to
  // the same predicate the task-detail UI's edit controls already use.
  if (!canEditTask({ role: membership.role })) {
    return {
      ok: false,
      error: "Viewers don't have permission to edit tasks.",
    };
  }

  // F322 (AS-227, AS-228): the caller must be able to SEE this task's
  // project themselves, not just be an active workspace member — see
  // isProjectVisibleToCaller's doc comment above `loadTaskAssignContext`.
  // Same generic message as the role failure above so a private project's
  // existence is never disclosed to someone who can't see it.
  if (
    !(await isProjectVisibleToCaller(
      admin,
      {
        projectId: project.id,
        visibility: (project.visibility as ProjectVisibility) ?? "workspace",
      },
      user.id,
      membership.role,
    ))
  ) {
    return {
      ok: false,
      error: "Viewers don't have permission to edit tasks.",
    };
  }

  // Build the update payload from only the fields present in `updates`.
  // Never includes project_id (AS-060) — there is no source field for it.
  // F205 (AS-378): when `updates.descriptionJson` is present, every
  // mention in it is re-validated against this task's own project
  // visibility server-side — the exact same
  // `sanitiseMentionsForVisibility` call addComment/editComment already
  // make (lib/comments/mentions.ts), reused rather than reimplemented, so
  // "who's visible" stays defined in exactly one place regardless of
  // whether the mention lives in a comment or a description. A
  // hand-crafted descriptionJson bypassing the picker entirely (any raw
  // call to editTask, not just the wired-up UI) gets the same protection
  // AS-376 already gives comments — this is not skipped just because it's
  // a description.
  // F301: if the visibility check itself fails (transient DB error), the
  // whole description write fails rather than silently persisting every
  // mention rewritten to "@Former member" — same "fail the write rather
  // than corrupt it" handling as addComment/editComment
  // (lib/actions/comments.ts), see MentionVisibilityCheckError's doc
  // comment in lib/comments/mentions.ts.
  let sanitisedDescriptionJson: JSONContent | undefined;
  if ("descriptionJson" in parsed.data.updates) {
    const rawDescriptionJson = parsed.data.updates.descriptionJson;
    if (rawDescriptionJson) {
      try {
        sanitisedDescriptionJson = (await sanitiseMentionsForVisibility(
          admin,
          rawDescriptionJson as JSONContent,
          {
            projectId: project.id,
            workspaceId,
            projectVisibility: project.visibility ?? "workspace",
          },
        )) as JSONContent;
      } catch (visibilityError) {
        logger.error("editTask: mention visibility check failed", { error: visibilityError });
        return {
          ok: false,
          error: "Something went wrong saving your changes. Please try again.",
        };
      }
    } else {
      sanitisedDescriptionJson = { type: "doc", content: [] } as JSONContent;
    }
  }

  // F006c (missions/20260903-portal, AS-013): cross-project safety —
  // mirrors setTaskPhaseImpl's own resolveWorkspace check
  // (lib/actions/phases.ts:646-658, itself citing
  // removeColumnWithReassignment's destination-project check in
  // lib/actions/statuses.ts): a phase id supplied for a DIFFERENT
  // project than this task's own must be rejected, not silently
  // accepted. Not expressible in editTaskSchema (Zod has no cross-table
  // lookup), so it is re-checked here, same "the DB/business rule is
  // re-verified in the action body, not just the client-side schema"
  // convention this file already follows for every other constraint.
  if ("phaseId" in parsed.data.updates && parsed.data.updates.phaseId) {
    const { data: phaseRow } = await admin
      .from("project_phases")
      .select("id, project_id")
      .eq("id", parsed.data.updates.phaseId)
      .maybeSingle();
    if (!phaseRow || phaseRow.project_id !== project.id) {
      return {
        ok: false,
        error: "That phase does not belong to this task's project.",
      };
    }
  }

  const updatePayload: {
    title?: string;
    description?: string | null;
    // F205 (AS-378): written ALONE (never alongside `description` in the
    // same call — `EditTaskUpdates` has no code path that sets both at
    // once, since the description Textarea and the RichTextEditor are
    // mutually exclusive edit surfaces on the same field, see
    // task-detail-sheet.tsx) so the direct-write trigger condition in
    // 20260822130000_task_description_json_direct_write.sql ("description
    // changed is-distinct AND description did NOT change") is met and
    // description_text is derived FROM this document rather than this
    // write being silently discarded back to whatever `description`
    // (untouched) would otherwise re-derive.
    description_json?: Json;
    priority?: "urgent" | "high" | "medium" | "low" | "backlog" | null;
    due_date?: string | null;
    // F236 (AS-453): mirrors due_date's own field above.
    start_date?: string | null;
    estimate_minutes?: number | null;
    // F179 (AS-317, AS-318, AS-319): `null` clears the rule (AS-319: no
    // future occurrences generate — F177's generation logic already
    // checks `recurrence is not null` before generating, per that
    // feature's own skip-conditions list), a valid rule object sets/
    // replaces it.
    recurrence?: {
      freq: "daily" | "weekly" | "monthly" | "every_n_days";
      interval: number;
      until?: string | null;
    } | null;
    // F005 (missions/20260903-portal, AS-014): the portal Pages view's
    // slug/order for a `page`-type task, edited from the task detail
    // sheet's own inline fields — plain scalars, no server-side
    // transform, same shape as due_date/start_date above.
    page_slug?: string | null;
    page_order?: number | null;
    // F006c (missions/20260903-portal, AS-013): the task<->phase
    // assignment. `null` clears it; a validated (see the cross-project
    // check above) uuid sets it.
    phase_id?: string | null;
  } = {};
  if ("title" in parsed.data.updates) {
    updatePayload.title = parsed.data.updates.title;
  }
  if ("description" in parsed.data.updates) {
    updatePayload.description = parsed.data.updates.description;
  }
  if ("priority" in parsed.data.updates) {
    updatePayload.priority = parsed.data.updates.priority;
  }
  if ("dueDate" in parsed.data.updates) {
    updatePayload.due_date = parsed.data.updates.dueDate;
  }
  if ("startDate" in parsed.data.updates) {
    updatePayload.start_date = parsed.data.updates.startDate;
  }
  if ("estimateMinutes" in parsed.data.updates) {
    updatePayload.estimate_minutes = parsed.data.updates.estimateMinutes;
  }
  if ("recurrence" in parsed.data.updates) {
    updatePayload.recurrence = parsed.data.updates.recurrence;
  }
  if ("pageSlug" in parsed.data.updates) {
    updatePayload.page_slug = parsed.data.updates.pageSlug;
  }
  if ("pageOrder" in parsed.data.updates) {
    updatePayload.page_order = parsed.data.updates.pageOrder;
  }
  if ("phaseId" in parsed.data.updates) {
    updatePayload.phase_id = parsed.data.updates.phaseId;
  }
  if (sanitisedDescriptionJson !== undefined) {
    updatePayload.description_json = sanitisedDescriptionJson as Json;
  }

  const { data: updated, error: updateError } = await admin
    .from("tasks")
    .update(updatePayload)
    .eq("id", parsed.data.taskId)
    .select(
      "id, title, description, description_json, priority, due_date, start_date, estimate_minutes, recurrence, page_slug, page_order, phase_id",
    )
    .single();

  if (updateError || !updated) {
    // F166 (AS-299): the tasks_estimate_minutes_positive CHECK is the last
    // line of defense if this row is ever reached with an invalid value
    // (e.g. via a future direct-write path); map it to a field-level
    // message rather than the generic fallback, per this feature's
    // Clarified failure-handling answer.
    if (
      updateError?.message?.includes("tasks_estimate_minutes_positive")
    ) {
      return {
        ok: false,
        error: "Estimate must be greater than zero.",
      };
    }
    // F179 (AS-317, AS-318): last line of defense against
    // `tasks_recurrence_shape` (F175's migration) — the Zod schema above
    // already rejects the same malformed shapes client-side, so this
    // should only ever fire via a future direct-write path.
    if (updateError?.message?.includes("tasks_recurrence_shape")) {
      return {
        ok: false,
        error: "Enter a valid recurrence rule.",
      };
    }
    // F236 (AS-453): `tasks_start_date_not_after_due_date`
    // (supabase/migrations/20260828010000_tasks_start_date.sql) is the
    // last line of defense — the Zod cross-field refine above already
    // rejects the same combination client-side when both fields are
    // touched in the same call, so this should only ever fire when a
    // call sets only one of startDate/dueDate and the OTHER field's
    // existing DB value now conflicts with it.
    if (
      updateError?.message?.includes(
        "tasks_start_date_not_after_due_date",
      )
    ) {
      return {
        ok: false,
        error: "Start date must not be after the due date.",
      };
    }
    logger.error("editTask: update failed", { error: updateError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  // F195 (AS-354, AS-355): record one task_activity entry per diffably
  // changed field (title, priority, due date, estimate — status/assignee
  // are not editable through this action). Non-fatal on failure, same as
  // revalidatePath below — the edit itself already succeeded.
  try {
    const changes = diffTaskFields(
      {
        title: taskRow.title,
        priority: taskRow.priority,
        due_date: taskRow.due_date,
        start_date: taskRow.start_date,
        estimate_minutes: taskRow.estimate_minutes,
      },
      {
        title: updated.title,
        priority: updated.priority,
        due_date: updated.due_date,
        start_date: updated.start_date,
        estimate_minutes: updated.estimate_minutes,
      },
    );
    await writeTaskFieldChanges(supabase, parsed.data.taskId, changes);

    // F319 (AS-294): watchers are notified of a task's activity generally,
    // not just status changes (moveTaskStatus, above) and comments
    // (addComment) — a title/priority/due-date/estimate edit is exactly as
    // much "activity on a watched task" as those, per this feature's
    // Clarified implementation. Scoped to the SAME set of fields
    // diffTaskFields/writeTaskFieldChanges just activity-logged above (not
    // every possible internal field), and only fires when `changes` is
    // non-empty — a no-op save (re-saving identical values) produces zero
    // diffed changes and therefore zero notifications, matching this
    // codebase's "diff first, only act on real changes" convention.
    // Reuses the "status_changed" fan-out event (-> `watcher_update` kind)
    // rather than inventing a new NotificationKind: the notification's
    // purpose ("something about a task I'm watching changed") is identical
    // regardless of which specific field changed, same as moveTaskStatus's
    // block below. Non-fatal, same convention as writeTaskFieldChanges
    // itself.
    if (changes.length > 0) {
      try {
        const { data: watcherRows } = await admin
          .from("task_watchers")
          .select("user_id")
          .eq("task_id", parsed.data.taskId)
          .eq("is_watching", true);
        const watcherIds = (watcherRows ?? []).map(
          (row) => row.user_id as string,
        );

        const computedRecipients = computeFanoutRecipients({
          type: "status_changed",
          actorId: user.id,
          watcherIds,
        });
        // F211 (AS-391): drop recipients who have this kind's in-app
        // channel disabled before ever calling create_notification.
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
            },
            "editTask",
          );
        }
      } catch (fanoutError) {
        logger.error("editTask: notification fan-out failed (non-fatal)", { error: fanoutError });
      }
    }
  } catch (activityError) {
    logger.error("editTask: writeTaskFieldChanges failed (non-fatal)", { error: activityError });
  }

  // F205 (AS-378): "notify only newly added mentions, diffed against the
  // previous save" — the whole feature. Compares the document that was
  // ACTUALLY on the row before this call (`taskRow.description_json`)
  // against the document ACTUALLY written (`updated.description_json`,
  // post-sanitisation) — not the raw client input, so a mention that got
  // stripped by sanitiseMentionsForVisibility above is never notified
  // either. Non-fatal (same convention as writeTaskFieldChanges above) and
  // only runs when this call actually touched descriptionJson.
  if (sanitisedDescriptionJson !== undefined) {
    try {
      const newlyMentionedUserIds = extractNewlyMentionedIds(
        taskRow.description_json as JSONContent | null,
        updated.description_json as JSONContent | null,
      );
      await notifyNewlyMentionedUsers({
        taskId: parsed.data.taskId,
        workspaceId,
        authorId: user.id,
        newlyMentionedUserIds,
        supabase,
        admin,
      });
    } catch (notifyError) {
      logger.error("editTask: notifyNewlyMentionedUsers failed (non-fatal)", { error: notifyError });
    }
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
      // Non-fatal cache-freshness rationale, same as createTask above.
      logger.error("editTask: revalidatePath failed (non-fatal)", { error: revalidateError });
    }
  }

  return {
    ok: true,
    data: {
      id: updated.id,
      title: updated.title,
      description: updated.description,
      ...(sanitisedDescriptionJson !== undefined
        ? { descriptionJson: updated.description_json as JSONContent | null }
        : {}),
      priority: updated.priority,
      dueDate: updated.due_date,
      startDate: updated.start_date,
      estimateMinutes: updated.estimate_minutes,
      // F005 (missions/20260903-portal, AS-014): mirrors dueDate/
      // startDate's own always-present convention.
      pageSlug: updated.page_slug,
      pageOrder: updated.page_order,
      // F006c (missions/20260903-portal, AS-013): mirrors pageSlug/
      // pageOrder's own always-present convention above.
      phaseId: updated.phase_id,
    },
  };
}

export type DeleteTaskResult =
  | {
      ok: true;
      data: {
        id: string;
        deletedAt: string;
      };
    }
  | { ok: false; error: string };

// Soft-deletes a task (F038: AS-055, AS-056, AS-057; F149: AS-267 —
// cascades to children). Pattern mirrors editTask/assignTask above:
// Zod-validated input, membership re-checked server-side (defense in
// depth, AS-143), admin client used for the actual update, discriminated
// union return, generic user-facing errors with details only logged
// server-side (AS-146).
//
// AS-055: any active workspace member may delete a task, matching the same
// "no per-task ownership restriction, only workspace membership" model
// already established for editTask (AS-061) and assignTask.
//
// This is a soft delete only — sets `deleted_at = now()`, never issues a
// real DELETE. Deleting is therefore an UPDATE under RLS
// (supabase/migrations/20260818013805_rls_tasks.sql), consistent with that
// migration's comment that tasks have no DELETE policy at all and use
// soft-delete exclusively.
//
// AS-056: the tasks_select_active_members RLS policy already filters
// `deleted_at is null` (confirmed by reading the F034 migration directly,
// not assumed), so the instant this row's deleted_at is set, every
// existing SELECT-based view (board, list, search, dashboard) stops
// returning it — no separate "hide from views" logic is needed here
// beyond setting the column.
//
// AS-057: comments/attachments tables don't exist yet (M6 — F058
// comments, F064 attachments land later) — there is nothing to
// individually orphan-hide today. This is a structural deferral, not a
// gap: once those tables land, their own RLS will be scoped through the
// (now-deleted) task, and a deleted task's children won't be
// independently browsable without going through the task itself, which is
// already gone from every view per AS-056. No code path here needs to
// pre-emptively guard tables that don't exist.
//
// AS-267 (F149): if this task has live (one-level) children — F148's
// `tasks.parent_task_id` — they must be soft-deleted too, in the SAME
// transaction as the parent, so a crash or partial failure can never
// leave orphaned children still visible on the board while their parent
// is gone. Two independent `.update()` calls (parent, then children)
// would be two separate network round trips with no shared transaction,
// so this delegates the whole thing to the `cascade_delete_task` Postgres
// RPC (supabase/migrations/20260819071821_subtask_cascade_delete.sql), a
// single SECURITY DEFINER PL/pgSQL function body — atomic by
// construction. That RPC also stamps cascaded children's
// `deleted_via_task_id`, the provenance F189's future restore feature
// needs to reverse exactly this cascade without resurrecting a child that
// was already deleted independently beforehand. This function works
// identically whether `taskId` is a top-level task with children (cascade
// fires), a childless task (the RPC's second UPDATE matches zero rows,
// a harmless no-op), or a child task itself (children can't have their
// own children per F148, so the cascade branch is always a no-op there
// too) — no branching needed here on which kind of task this is.
// W11 (mission 20260828-hardening): migrated onto withAuthz — see
// lib/actions/authz.ts's doc comment for the pipeline this now runs
// (Zod -> getUser -> admin client -> resolveWorkspace -> membership ->
// canWrite -> isProjectVisibleToCaller) in place of the hand-written
// preamble every sibling action in this file still carries.
const deleteTaskImpl = withAuthz(
  deleteTaskSchema,
  {
    requireWrite: true,
    // AS-055: any role, no per-task ownership check — mirrors editTask's
    // membership check exactly. Deliberately `canWrite` (withAuthz's
    // default), not `canDeleteTask` — canDeleteTask additionally scopes
    // plain members to their own creations, which would regress AS-055.
    membershipError: "You don't have permission to delete this task.",
    writeError: "Viewers don't have permission to delete tasks.",
    requireVisibility: true,
    visibilityError: "Viewers don't have permission to delete tasks.",
    // Look up the task's owning workspace (via its project) so membership
    // is checked against the real workspace, never one supplied by the
    // caller. An already-deleted task behaves as "not found", same
    // convention as assignTask/editTask's task lookup — this also makes
    // deleteTask naturally idempotent-safe (a second delete call just
    // reports "not found" rather than re-touching the row).
    resolveWorkspace: async (input, admin) => {
      const { data: taskRow, error } = await admin
        .from("tasks")
        .select("id, deleted_at, projects!inner(id, workspace_id, visibility)")
        .eq("id", input.taskId)
        .is("deleted_at", null)
        .maybeSingle();

      if (error || !taskRow) return { ok: false, error: "Task not found." };

      const project = Array.isArray(taskRow.projects)
        ? taskRow.projects[0]
        : taskRow.projects;

      if (!project?.workspace_id) return { ok: false, error: "Task not found." };

      return {
        ok: true,
        workspaceId: project.workspace_id,
        projectId: project.id,
        visibility: (project.visibility as ProjectVisibility) ?? "workspace",
        extra: {},
      };
    },
  },
  async (input, ctx): Promise<DeleteTaskResult> => {
    // AS-267: single atomic RPC call — soft-deletes this task AND cascades
    // to any live children in one transaction (see doc comment above).
    // F188/AS-347: `p_deleted_by` is stamped inside the same RPC call (see
    // 20260822210000_cascade_delete_task_deleted_by.sql's doc comment) so
    // the trash view can show who deleted this task without a second write.
    const { data: cascadeRows, error: deleteError } = await ctx.admin.rpc(
      "cascade_delete_task",
      { p_task_id: input.taskId, p_deleted_by: ctx.user.id },
    );

    const deleted = cascadeRows?.[0];

    if (deleteError || !deleted || !deleted.deleted_at) {
      logger.error("deleteTask: cascade_delete_task failed", { error: deleteError });
      return {
        ok: false,
        error: "Something went wrong. Please try again in a moment.",
      };
    }

    const { data: workspaceRow } = await ctx.admin
      .from("workspaces")
      .select("slug")
      .eq("id", ctx.workspaceId)
      .maybeSingle();

    if (workspaceRow?.slug) {
      try {
        revalidatePath(`/w/${workspaceRow.slug}`, "layout");
      } catch (revalidateError) {
        // Non-fatal cache-freshness rationale, same as createTask above.
        logger.error("deleteTask: revalidatePath failed (non-fatal)", { error: revalidateError });
      }
    }

    return {
      ok: true,
      data: {
        id: deleted.id,
        deletedAt: deleted.deleted_at,
      },
    };
  },
);

export async function deleteTask(taskId: string): Promise<DeleteTaskResult> {
  return deleteTaskImpl({ taskId });
}

export type RestoreTaskResult =
  | {
      ok: true;
      data: {
        id: string;
        projectId: string;
        status: string;
        position: number;
        // AS-344's "status no longer exists" fallback edge case (see this
        // function's doc comment): true only when the task's recorded
        // status somehow wasn't a valid column and had to be reset to the
        // project's first not-started column, so the caller can surface a
        // "status was reset" notice. Always false today (status is a
        // fixed DB CHECK-constrained enum — see moveTaskStatusSchema —
        // this branch has no reachable trigger until a future
        // caller-defined-columns feature, F218, lands), but the field
        // exists so the UI never has to guess.
        statusWasReset: boolean;
      };
    }
  | { ok: false; error: string };

// Restores a soft-deleted task (F189: AS-344, AS-351). Pattern mirrors
// deleteTask/editTask above: Zod-validated input, membership re-checked
// server-side (defense in depth, AS-143), admin client used for the
// actual update, discriminated union return, generic user-facing errors
// with details only logged server-side (AS-146).
//
// AS-344: a restored task returns to its ORIGINAL project (project_id is
// never changed by this action — there is no field for it, same "no
// field to carry a destination" convention editTask's AS-060 doc comment
// already established) and its original status. Position is the one
// field that is NOT restored verbatim: this feature's own worker brief
// explicitly calls out that the task's old position may now collide with
// other tasks' positions since time has passed (new tasks may have been
// created or reordered into that same slot while this task sat deleted),
// so a brand-new valid position is computed here via
// lib/board/position.ts's calculatePosition, appended to the END of the
// task's (project, status) column — the exact same "append to the end"
// convention createTask already uses for a newly created task (see that
// function's own position doc comment above) — never the stale value
// read back from the row.
//
// Status fallback (per this feature's Files/Clarified implementation,
// "if the task's original status no longer exists, fall back to the
// project's first not-started column and say so"): `status` is a fixed,
// DB CHECK-constrained enum today (tasks_status_check,
// supabase/migrations/20260818013434_create_tasks.sql) — every row's
// `status` is therefore ALWAYS one of the four known values, so this
// fallback branch can never actually trigger yet (caller-defined board
// columns are a later feature, F218, not built). The fallback is still
// implemented per the spec's explicit instruction (defensive, and ready
// the day F218 lands): any status value that isn't one of the four known
// columns falls back to "todo" (the fixed set's first not-started
// column), and `statusWasReset: true` is returned so the caller can show
// a toast.
//
// AS-351: restoring into an ARCHIVED project (an archived project is
// simply a project with `deleted_at` set — F142/AS-249 reuses the same
// soft-delete column rather than a second, parallel "archived" flag, per
// that feature's own migration doc comment) must NOT un-archive the
// project. This function never reads OR writes any column on `projects`
// other than looking up `workspace_id` (for the membership check) and
// `deleted_at` is deliberately never part of that lookup's select list,
// and never appears anywhere in this function's write path — there is no
// code here that could touch `projects.deleted_at` even by accident. A
// task inside an archived project restores exactly like a task in any
// other project; it simply becomes visible again inside that (still
// archived) project's own task list, the same way any other live task in
// an archived project already behaves — archiving a project does not
// itself hide its own tasks from that project's own board (only from
// cross-project aggregates, per AS-129/AS-174's `p.deleted_at is null`
// exclusions), so a restored task inside an archived project is
// consistent with every other task already sitting in that project.
//
// Cascade restore (reverses F149's `cascade_delete_task` RPC precisely,
// per this feature's own instruction): a task cascade-deleted alongside
// ITS parent (F149's single-task `deleteTask` path — see that function's
// doc comment) has `deleted_via_task_id` stamped to the parent's id. When
// the parent is restored here, every still-deleted child whose
// `deleted_via_task_id` equals this task's id is restored too, each
// getting its own fresh end-of-column position in ITS OWN (project,
// status) column — a child's status is untouched by its parent's
// restore, it simply becomes visible again in whichever column it was
// in. This is deliberately NOT the same as F187's bulk-delete cascade:
// children soft-deleted as a side effect of `bulkDeleteTasks` never had
// `deleted_via_task_id` stamped in the first place (F187's own documented
// gap, restated in F188's handoff) — this function has no way to
// distinguish those from an independently-deleted child and does not try
// to; only rows whose `deleted_via_task_id` correctly points back to
// THIS task are restored. A task with no cascade-deleted children is
// unaffected by this step (the children query simply returns zero rows).
//
// Zero-state: a task that is not currently soft-deleted (already restored,
// or never deleted) behaves as "not found" here, mirroring every other
// action in this file's "deleted_at is null means not found for a
// delete-scoped lookup" convention, inverted for a restore-scoped lookup
// (`deleted_at is NOT null` required).
// W11: migrated onto withAuthz — see deleteTaskImpl above and
// lib/actions/authz.ts's doc comment.
const restoreTaskImpl = withAuthz(
  restoreTaskSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to restore this task.",
    writeError: "Viewers don't have permission to restore tasks.",
    requireVisibility: true,
    visibilityError: "Viewers don't have permission to restore tasks.",
    // Only a currently soft-deleted task is eligible — a live (never-
    // deleted or already-restored) task behaves as "not found", the
    // inverse of deleteTask's own lookup convention. AS-351:
    // `projects.deleted_at` is deliberately not selected here — this
    // function has no reason to branch on whether the project is
    // archived, and selecting it would invite a future edit to
    // accidentally start writing it.
    resolveWorkspace: async (input, admin) => {
      const { data: taskRow, error } = await admin
        .from("tasks")
        .select(
          "id, project_id, status, deleted_at, deleted_via_task_id, projects!inner(id, workspace_id, visibility)",
        )
        .eq("id", input.taskId)
        .not("deleted_at", "is", null)
        .maybeSingle();

      if (error || !taskRow) return { ok: false, error: "Task not found." };

      const project = Array.isArray(taskRow.projects)
        ? taskRow.projects[0]
        : taskRow.projects;

      if (!project?.workspace_id) return { ok: false, error: "Task not found." };

      return {
        ok: true,
        workspaceId: project.workspace_id,
        projectId: project.id,
        visibility: (project.visibility as ProjectVisibility) ?? "workspace",
        extra: {},
      };
    },
  },
  async (input, ctx): Promise<RestoreTaskResult> => {
    // Restore atomically: the parent's own update and the cascade restore
    // of its still-deleted children (see this function's doc comment)
    // happen in a single transaction via RPC, so a mid-sequence failure
    // can never leave a child still marked deleted under a now-restored,
    // live-looking parent.
    const { data: restoreRows, error: updateError } = await ctx.admin.rpc(
      "restore_task_atomic",
      { p_task_id: input.taskId },
    );

    const updated = restoreRows?.[0];

    if (updateError || !updated) {
      logger.error("restoreTask: update failed", { error: updateError });
      return {
        ok: false,
        error: "Something went wrong. Please try again in a moment.",
      };
    }

    const statusWasReset = updated.status_was_reset;

    // F306 (D9/FU-3 scrutiny fix, AS-353, AS-355): record the restore in
    // the task's activity feed. There is no dedicated "restored" kind in
    // F194's closed task_activity_kind vocabulary ('field_changed',
    // 'comment_added', 'comment_deleted') and no migration is in this
    // feature's Files scope (lib/actions/tasks.ts only), so this follows
    // the exact precedent
    // supabase/migrations/20260822231000_recurrence_scheduled_generation_
    // activity.sql's own doc comment sets for "no dedicated kind exists":
    // 'field_changed' on the closest-fitting real field. `status` is the
    // closest fit here — a restored task always ends up with a concrete,
    // visible status again, `p_old_value := null` (there was no visible
    // status while soft-deleted/in trash) and `p_new_value :=
    // resolvedStatus`. This is deliberately activity-only, NOT a watcher/
    // assignee notification — per this feature's own scoping note,
    // restoring a task from trash is not treated as a fan-out-worthy event
    // the way a live status/assignee change is; see the handoff's
    // Decisions Made. Non-fatal, same convention as every other post-write
    // activity write in this file.
    try {
      // diffTaskFields skips a key absent from `before` (no prior value to
      // diff against) — restore's "before" is genuinely absent (the task
      // had no visible status while in trash), so the change is built
      // directly here rather than through diffTaskFields's "both present"
      // comparison, matching the SQL-side precedent's own `p_old_value :=
      // null` choice referenced above.
      await writeTaskFieldChanges(ctx.supabase, input.taskId, [
        { field: "status", oldValue: null, newValue: updated.status },
      ]);
    } catch (activityError) {
      logger.error("restoreTask: writeTaskFieldChanges failed (non-fatal)", { error: activityError });
    }

    const { data: workspaceRow } = await ctx.admin
      .from("workspaces")
      .select("slug")
      .eq("id", ctx.workspaceId)
      .maybeSingle();

    if (workspaceRow?.slug) {
      try {
        revalidatePath(`/w/${workspaceRow.slug}`, "layout");
        revalidatePath(`/w/${workspaceRow.slug}/trash`);
      } catch (revalidateError) {
        // Non-fatal cache-freshness rationale, same as createTask above.
        logger.error("restoreTask: revalidatePath failed (non-fatal)", { error: revalidateError });
      }
    }

    return {
      ok: true,
      data: {
        id: updated.id,
        projectId: updated.project_id,
        status: updated.status,
        position: updated.position,
        statusWasReset,
      },
    };
  },
);

export async function restoreTask(taskId: string): Promise<RestoreTaskResult> {
  return restoreTaskImpl({ taskId });
}

export type PromoteSubtaskResult =
  | {
      ok: true;
      data: {
        id: string;
        parentTaskId: null;
      };
    }
  | { ok: false; error: string };

// Promotes a child task to a top-level task, detaching it from its
// parent (F149: AS-268). Pattern mirrors deleteTask/editTask above:
// Zod-validated input, membership re-checked server-side (defense in
// depth, AS-143), admin client used for the actual update, discriminated
// union return, generic user-facing errors with details only logged
// server-side (AS-146). Any active workspace member may promote any
// subtask in that workspace — no per-task ownership check, same "any
// role" model as deleteTask (AS-055) and editTask (AS-061).
//
// A promoted task's `position` and `status` are left completely
// untouched. A subtask is created through the same createTask code path
// as any top-level task (F149's createTask change above) and already
// carries a normal fractional-index `position` within its (project,
// status) column — the exact same axis a top-level task's position lives
// on. There is no separate "subtask position" to reconcile: clearing
// `parent_task_id` doesn't move the row to a different column or
// position space, so the row is already a valid, correctly-ordered board
// card the instant this UPDATE commits. (Verified, not assumed — see
// tests/integration/promote-subtask.test.ts's AS-268 position assertion.)
//
// Zero-state / no-op (per this feature's Clarified implementation,
// clarification question 6): a task that is already top-level
// (`parent_task_id` already null) is a no-op — this returns `ok: true`
// without writing to the database, so the caller doesn't have to special-
// case "already promoted" as an error.
// W11: migrated onto withAuthz — see deleteTaskImpl above and
// lib/actions/authz.ts's doc comment.
const promoteSubtaskImpl = withAuthz(
  promoteSubtaskSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to promote this task.",
    writeError: "Viewers don't have permission to promote tasks.",
    requireVisibility: true,
    visibilityError: "Viewers don't have permission to promote tasks.",
    // A soft-deleted task behaves as "not found", same convention as every
    // other action in this file. `parent_task_id` is threaded through as
    // `extra` so the handler's zero-state check below doesn't need a
    // second query.
    resolveWorkspace: async (input, admin) => {
      const { data: taskRow, error } = await admin
        .from("tasks")
        .select(
          "id, parent_task_id, deleted_at, projects!inner(id, workspace_id, visibility)",
        )
        .eq("id", input.taskId)
        .is("deleted_at", null)
        .maybeSingle();

      if (error || !taskRow) return { ok: false, error: "Task not found." };

      const project = Array.isArray(taskRow.projects)
        ? taskRow.projects[0]
        : taskRow.projects;

      if (!project?.workspace_id) return { ok: false, error: "Task not found." };

      return {
        ok: true,
        workspaceId: project.workspace_id,
        projectId: project.id,
        visibility: (project.visibility as ProjectVisibility) ?? "workspace",
        extra: {
          taskRow: { id: taskRow.id, parentTaskId: taskRow.parent_task_id as string | null },
        },
      };
    },
  },
  async (input, ctx): Promise<PromoteSubtaskResult> => {
    // Zero-state (Clarified implementation Q6): already top-level — no-op,
    // ok without writing.
    if (ctx.taskRow.parentTaskId === null) {
      return { ok: true, data: { id: ctx.taskRow.id, parentTaskId: null } };
    }

    const { data: updated, error: updateError } = await ctx.admin
      .from("tasks")
      .update({ parent_task_id: null })
      .eq("id", input.taskId)
      .select("id, parent_task_id")
      .single();

    if (updateError || !updated) {
      logger.error("promoteSubtask: update failed", { error: updateError });
      return {
        ok: false,
        error: "Something went wrong. Please try again in a moment.",
      };
    }

    const { data: workspaceRow } = await ctx.admin
      .from("workspaces")
      .select("slug")
      .eq("id", ctx.workspaceId)
      .maybeSingle();

    if (workspaceRow?.slug) {
      try {
        revalidatePath(`/w/${workspaceRow.slug}`, "layout");
      } catch (revalidateError) {
        // Non-fatal cache-freshness rationale, same as createTask above.
        logger.error("promoteSubtask: revalidatePath failed (non-fatal)", { error: revalidateError });
      }
    }

    return {
      ok: true,
      data: {
        id: updated.id,
        parentTaskId: null,
      },
    };
  },
);

export async function promoteSubtask(
  taskId: string,
): Promise<PromoteSubtaskResult> {
  return promoteSubtaskImpl({ taskId });
}

export type UpdateTaskTagsResult =
  | {
      ok: true;
      data: {
        id: string;
        tags: string[];
      };
    }
  | { ok: false; error: string };

// Updates a task's tag list (F041: AS-065, AS-066). Pattern mirrors
// editTask/assignTask above: Zod-validated input (array of non-empty
// trimmed strings), membership re-checked server-side (defense in depth,
// AS-143), admin client used for the actual update, discriminated union
// return, generic user-facing errors with details only logged server-side
// (AS-146).
//
// AS-065: `tags` is a plain string array — zero, one, or many tags, all
// optional in the sense that an empty array is a fully valid task state.
// AS-066: passing `[]` here writes an empty array to the `tags` column
// (which is `not null default '{}'`, per
// supabase/migrations/20260818013434_create_tasks.sql) — never `null`.
// There is no "omit tags to leave unchanged" branch the way editTask has
// for its optional fields; `tags` is always a required array argument, so
// every call is an explicit, full replacement of the tag list.
// W11: migrated onto withAuthz — see deleteTaskImpl above and
// lib/actions/authz.ts's doc comment.
const updateTaskTagsImpl = withAuthz(
  updateTaskTagsSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to update this task's tags.",
    writeError: "Viewers don't have permission to update tags.",
    requireVisibility: true,
    visibilityError: "Viewers don't have permission to update tags.",
    // A soft-deleted task behaves as "not found", same convention as
    // assignTask/editTask/deleteTask's task lookup.
    resolveWorkspace: async (input, admin) => {
      const { data: taskRow, error } = await admin
        .from("tasks")
        .select("id, deleted_at, projects!inner(id, workspace_id, visibility)")
        .eq("id", input.taskId)
        .is("deleted_at", null)
        .maybeSingle();

      if (error || !taskRow) return { ok: false, error: "Task not found." };

      const project = Array.isArray(taskRow.projects)
        ? taskRow.projects[0]
        : taskRow.projects;

      if (!project?.workspace_id) return { ok: false, error: "Task not found." };

      return {
        ok: true,
        workspaceId: project.workspace_id,
        projectId: project.id,
        visibility: (project.visibility as ProjectVisibility) ?? "workspace",
        extra: {},
      };
    },
  },
  async (input, ctx): Promise<UpdateTaskTagsResult> => {
    // AS-066: `input.tags` may legitimately be `[]` here — that is written
    // as-is, never coerced to null.
    const { data: updated, error: updateError } = await ctx.admin
      .from("tasks")
      .update({ tags: input.tags })
      .eq("id", input.taskId)
      .select("id, tags")
      .single();

    if (updateError || !updated) {
      logger.error("updateTaskTags: update failed", { error: updateError });
      return {
        ok: false,
        error: "Something went wrong. Please try again in a moment.",
      };
    }

    const { data: workspaceRow } = await ctx.admin
      .from("workspaces")
      .select("slug")
      .eq("id", ctx.workspaceId)
      .maybeSingle();

    if (workspaceRow?.slug) {
      try {
        revalidatePath(`/w/${workspaceRow.slug}`, "layout");
      } catch (revalidateError) {
        // Non-fatal cache-freshness rationale, same as createTask above.
        logger.error("updateTaskTags: revalidatePath failed (non-fatal)", { error: revalidateError });
      }
    }

    return {
      ok: true,
      data: {
        id: updated.id,
        tags: updated.tags ?? [],
      },
    };
  },
);

export async function updateTaskTags(
  taskId: string,
  tags: string[],
): Promise<UpdateTaskTagsResult> {
  return updateTaskTagsImpl({ taskId, tags });
}

export type MoveTaskStatusResult =
  | {
      ok: true;
      data: {
        id: string;
        status: string;
      };
    }
  | { ok: false; error: string };

// Updates a task's status when its card is dropped into a different board
// column (F045: AS-069). Pattern mirrors assignTask/editTask/deleteTask
// above: Zod-validated input against the fixed 4-value status set,
// membership re-checked server-side (defense in depth, AS-143), admin
// client used for the actual update, discriminated union return, generic
// user-facing errors with details only logged server-side (AS-146).
//
// AS-069 covers only the status-column update itself. Recomputing/
// persisting the task's `position` within its new (or same) column is
// F046's responsibility, layered on top of this same board.tsx onDragEnd
// handler — not duplicated here.
//
// Any active workspace member may move any task in that workspace,
// regardless of authorship/assignment — mirrors editTask (AS-061) and
// deleteTask (AS-055): no per-task ownership check, only workspace
// membership.
type MoveTaskStatusTaskRow = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  description_json: Json | null;
  priority: "urgent" | "high" | "medium" | "low" | "backlog" | null;
  estimate_minutes: number | null;
  due_date: string | null;
  recurrence: unknown;
  recurrence_parent_id: string | null;
  status: string;
};

// W11: migrated onto withAuthz — see deleteTaskImpl above and
// lib/actions/authz.ts's doc comment. The task row is threaded through as
// `extra` so the recurrence-generation step below doesn't need a second
// query for it.
const moveTaskStatusImpl = withAuthz(
  moveTaskStatusSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to move this task.",
    writeError: "Viewers don't have permission to move tasks.",
    requireVisibility: true,
    visibilityError: "Viewers don't have permission to move tasks.",
    // A soft-deleted task behaves as "not found", same convention as
    // assignTask/editTask/deleteTask's task lookup.
    resolveWorkspace: async (input, admin) => {
      const { data: taskRow, error } = await admin
        .from("tasks")
        .select(
          "id, deleted_at, project_id, title, description, description_json, priority, estimate_minutes, due_date, recurrence, recurrence_parent_id, status, projects!inner(id, workspace_id, visibility)",
        )
        .eq("id", input.taskId)
        .is("deleted_at", null)
        .maybeSingle();

      if (error || !taskRow) return { ok: false, error: "Task not found." };

      const project = Array.isArray(taskRow.projects)
        ? taskRow.projects[0]
        : taskRow.projects;

      if (!project?.workspace_id) return { ok: false, error: "Task not found." };

      const { projects: _ignoredProjects, deleted_at: _ignoredDeletedAt, ...taskFields } = taskRow;
      void _ignoredProjects;
      void _ignoredDeletedAt;

      return {
        ok: true,
        workspaceId: project.workspace_id,
        projectId: project.id,
        visibility: (project.visibility as ProjectVisibility) ?? "workspace",
        extra: { taskRow: taskFields as MoveTaskStatusTaskRow },
      };
    },
  },
  async (input, ctx): Promise<MoveTaskStatusResult> => {
    const taskRow = ctx.taskRow;

    // F221 (AS-409): `input.status` must name one of THIS project's real
    // board columns — the DB trigger that derives `status_id` from
    // `(project_id, name)` (F218's `sync_task_status_and_status_id`) fails
    // silently (leaves status_id null) for an unmatched name rather than
    // raising, so this check is the real guard against a stale/forged
    // column name reaching the DB.
    // F222 (AS-410): `category` selected alongside `id` so the recurrence
    // "moved into a done-category status" check below (isDoneStatus) can
    // use this SAME lookup instead of re-deriving/re-fetching it — no
    // second query, no second source of truth for "is the target column
    // done".
    const { data: columnMatch } = await ctx.admin
      .from("project_statuses")
      .select("id, category")
      .eq("project_id", ctx.projectId as string)
      .eq("name", input.status)
      .maybeSingle();

    if (!columnMatch) {
      return {
        ok: false,
        error: "That column no longer exists. Refresh the board and try again.",
      };
    }

    const { data: updated, error: updateError } = await ctx.admin
      .from("tasks")
      .update({ status: input.status })
      .eq("id", input.taskId)
      .select("id, status")
      .single();

    if (updateError || !updated) {
      logger.error("moveTaskStatus: update failed", { error: updateError });
      return {
        ok: false,
        error: "Something went wrong. Please try again in a moment.",
      };
    }

    // F195 (AS-354, AS-355): record the status change. Non-fatal, mirrors
    // editTask's own activity write above.
    try {
      const changes = diffTaskFields(
        { status: taskRow.status },
        { status: updated.status },
      );
      await writeTaskFieldChanges(ctx.supabase, input.taskId, changes);
    } catch (activityError) {
      logger.error("moveTaskStatus: writeTaskFieldChanges failed (non-fatal)", { error: activityError });
    }

    // F207 (AS-294, AS-382, AS-384): a status change notifies the task's
    // current active watchers (excluding the actor). Non-fatal, same
    // convention as writeTaskFieldChanges above. Uses the caller's own
    // session (`supabase`) so create_notification pins actor_id to
    // auth.uid() server-side — see setTaskAssigneesCore's identical
    // rationale above.
    try {
      const { data: watcherRows } = await ctx.admin
        .from("task_watchers")
        .select("user_id")
        .eq("task_id", input.taskId)
        .eq("is_watching", true);
      const watcherIds = (watcherRows ?? []).map((row) => row.user_id as string);

      const computedRecipients = computeFanoutRecipients({
        type: "status_changed",
        actorId: ctx.user.id,
        watcherIds,
      });
      // F211 (AS-391): drop recipients who have this kind's in-app channel
      // disabled before ever calling create_notification.
      const recipients = await filterRecipientsByInAppPreference(
        ctx.admin,
        computedRecipients ?? [],
      );
      for (const recipient of recipients ?? []) {
        await createNotification(
          ctx.supabase,
          {
            userId: recipient.userId,
            workspaceId: ctx.workspaceId,
            kind: recipient.kind,
            taskId: input.taskId,
          },
          "moveTaskStatus",
        );
      }
    } catch (fanoutError) {
      logger.error("moveTaskStatus: notification fan-out failed (non-fatal)", { error: fanoutError });
    }

    // F177 (AS-315, AS-320, AS-321): a recurring task that just
    // transitioned into a done-category status generates its next
    // occurrence, in the same logical unit as this status write
    // (immediately after it succeeds, same request). Per this feature's
    // Clarified implementation, this is purely additive — a failure or
    // legitimate no-op here (no recurrence, no due date, archived project,
    // already generated) never turns the status change itself into a
    // failure; the user's completion always succeeds.
    if (isDoneStatus(input.status, columnMatch.category) && taskRow.recurrence) {
      try {
        const timezone = await getCurrentUserTimezone(ctx.supabase);
        await generateNextOccurrence(
          ctx.admin,
          {
            id: taskRow.id,
            project_id: taskRow.project_id,
            title: taskRow.title,
            description: taskRow.description,
            description_json: taskRow.description_json,
            priority: taskRow.priority,
            estimate_minutes: taskRow.estimate_minutes,
            due_date: taskRow.due_date,
            recurrence: taskRow.recurrence,
            recurrence_parent_id: taskRow.recurrence_parent_id,
          },
          ctx.user.id,
          timezone,
        );
      } catch (recurrenceError) {
        // Non-fatal: the status change already succeeded above. Generation
        // is best-effort additive behavior, never a reason to fail the
        // user's completion action.
        logger.error("moveTaskStatus: generateNextOccurrence failed (non-fatal)", { error: recurrenceError });
      }
    }

    const { data: workspaceRow } = await ctx.admin
      .from("workspaces")
      .select("slug")
      .eq("id", ctx.workspaceId)
      .maybeSingle();

    if (workspaceRow?.slug) {
      try {
        revalidatePath(`/w/${workspaceRow.slug}`, "layout");
      } catch (revalidateError) {
        // Non-fatal cache-freshness rationale, same as createTask above.
        logger.error("moveTaskStatus: revalidatePath failed (non-fatal)", { error: revalidateError });
      }
    }

    return {
      ok: true,
      data: {
        id: updated.id,
        status: updated.status,
      },
    };
  },
);

export async function moveTaskStatus(
  taskId: string,
  // F221 (AS-409): any of the project's real `project_statuses` column
  // names, not just the original fixed four — see moveTaskStatusSchema's
  // doc comment.
  newStatus: string,
): Promise<MoveTaskStatusResult> {
  return moveTaskStatusImpl({ taskId, status: newStatus });
}

export type ReorderTaskResult =
  | {
      ok: true;
      data: {
        id: string;
        position: number;
      };
    }
  | { ok: false; error: string };

// Persists a task's new `position` after a drag-and-drop reorder (F046:
// AS-070, AS-078, AS-079, AS-080). Pattern mirrors moveTaskStatus above:
// Zod-validated input, membership re-checked server-side (defense in
// depth, AS-143), admin client used for the actual update, discriminated
// union return, generic user-facing errors with details only logged
// server-side (AS-146).
//
// AS-070/AS-078: this action updates ONLY the `position` column — it never
// touches `status`. board.tsx's onDragEnd (F045 + F046, same handler)
// calls calculatePosition (lib/board/position.ts) to compute the new
// fractional-index value from the dropped card's new neighbors, then calls
// this action with that value for a same-column reorder. If a drag ALSO
// changes the column, onDragEnd instead calls moveAndReorderTask (F102) —
// a single atomic action that sets both columns in one UPDATE — rather
// than calling this action and moveTaskStatus (F045) independently. Two
// independent UPDATEs against the same row previously left a window where
// one could succeed and the other fail, leaving status/position
// inconsistent with each other and with the client's rolled-back view; see
// moveAndReorderTask's doc comment (F102, fixing M5-scrutiny.md Finding 2)
// for the full history.
//
// AS-080: dragging must not change updated_at unless status also changed.
// Investigated the `tasks_set_updated_at` trigger
// (supabase/migrations/20260818013434_create_tasks.sql) — it originally
// fired unconditionally on every UPDATE, which would have bumped
// updated_at on this position-only write too. Fixed at the schema level
// in supabase/migrations/20260818023746_tasks_updated_at_exclude_position.sql,
// which adds a WHEN clause so the trigger only fires when a column other
// than `position` (and `updated_at` itself) actually changed. Nothing
// further is needed here in application code — the UPDATE below only ever
// sets `position`, and the trigger now leaves `updated_at` alone for that
// case.
//
// Any active workspace member may reorder any task in that workspace,
// regardless of authorship/assignment — mirrors moveTaskStatus/editTask/
// deleteTask: no per-task ownership check, only workspace membership.
// W11: migrated onto withAuthz — see deleteTaskImpl above and
// lib/actions/authz.ts's doc comment.
const reorderTaskImpl = withAuthz(
  reorderTaskSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to reorder this task.",
    writeError: "Viewers don't have permission to reorder tasks.",
    requireVisibility: true,
    visibilityError: "Viewers don't have permission to reorder tasks.",
    // A soft-deleted task behaves as "not found", same convention as
    // moveTaskStatus/editTask/deleteTask's task lookup.
    resolveWorkspace: async (input, admin) => {
      const { data: taskRow, error } = await admin
        .from("tasks")
        .select("id, deleted_at, projects!inner(id, workspace_id, visibility)")
        .eq("id", input.taskId)
        .is("deleted_at", null)
        .maybeSingle();

      if (error || !taskRow) return { ok: false, error: "Task not found." };

      const project = Array.isArray(taskRow.projects)
        ? taskRow.projects[0]
        : taskRow.projects;

      if (!project?.workspace_id) return { ok: false, error: "Task not found." };

      return {
        ok: true,
        workspaceId: project.workspace_id,
        projectId: project.id,
        visibility: (project.visibility as ProjectVisibility) ?? "workspace",
        extra: {},
      };
    },
  },
  async (input, ctx): Promise<ReorderTaskResult> => {
    // AS-070/AS-078: position only — status is deliberately absent from
    // this payload. AS-080: this UPDATE only ever sets `position`, and the
    // tasks_set_updated_at trigger's WHEN clause (see migration referenced
    // above) is what actually keeps updated_at untouched for this case.
    const { data: updated, error: updateError } = await ctx.admin
      .from("tasks")
      .update({ position: input.position })
      .eq("id", input.taskId)
      .select("id, position")
      .single();

    if (updateError || !updated) {
      logger.error("reorderTask: update failed", { error: updateError });
      return {
        ok: false,
        error: "Something went wrong. Please try again in a moment.",
      };
    }

    const { data: workspaceRow } = await ctx.admin
      .from("workspaces")
      .select("slug")
      .eq("id", ctx.workspaceId)
      .maybeSingle();

    if (workspaceRow?.slug) {
      try {
        revalidatePath(`/w/${workspaceRow.slug}`, "layout");
      } catch (revalidateError) {
        // Non-fatal cache-freshness rationale, same as createTask above.
        logger.error("reorderTask: revalidatePath failed (non-fatal)", { error: revalidateError });
      }
    }

    return {
      ok: true,
      data: {
        id: updated.id,
        position: updated.position,
      },
    };
  },
);

export async function reorderTask(
  taskId: string,
  newPosition: number,
): Promise<ReorderTaskResult> {
  return reorderTaskImpl({ taskId, position: newPosition });
}

export type MoveAndReorderTaskResult =
  | {
      ok: true;
      data: {
        id: string;
        status: string;
        position: number;
      };
    }
  | { ok: false; error: string };

// Atomically updates both `status` and `position` for a cross-column drag
// (F102: AS-077, follow-up on scrutiny-validator's M5-scrutiny.md Finding
// 2). Before this action existed, board.tsx's onDragEnd called
// moveTaskStatus and reorderTask as two independent, uncoordinated Server
// Actions on a cross-column drag. If the first succeeded and the second
// failed, the client rolled back visually but the server kept the
// already-committed status change with a stale (pre-move) position value —
// client and server permanently disagreed about what happened.
//
// Fix: a single UPDATE statement setting both `status` and `position`
// together. A single UPDATE against a single row is inherently atomic in
// Postgres (it either commits both column changes or neither) — there is no
// intermediate state where one column changed and the other didn't, so the
// partial-failure class of bug this exists to fix is impossible by
// construction. Callers that only need to change one of the two fields
// (same-column reorder, or a status-only change with no reposition) should
// keep calling reorderTask/moveTaskStatus individually — this action is
// specifically for drags that change both at once.
//
// Pattern otherwise mirrors moveTaskStatus/reorderTask above: Zod-validated
// input (both fields validated together, before either reaches the
// database — an invalid status or non-finite position fails validation and
// the UPDATE never runs), membership re-checked server-side (defense in
// depth, AS-143), admin client used for the actual update, discriminated
// union return, generic user-facing errors with details only logged
// server-side (AS-146). No per-task ownership check, only workspace
// membership, same as its two single-purpose siblings.
// W11: migrated onto withAuthz — see deleteTaskImpl above and
// lib/actions/authz.ts's doc comment. The pre-move `status` is threaded
// through as `extra` so the "did status actually change" diff below
// doesn't need a second query.
const moveAndReorderTaskImpl = withAuthz(
  moveAndReorderTaskSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to move this task.",
    writeError: "Viewers don't have permission to move tasks.",
    requireVisibility: true,
    visibilityError: "Viewers don't have permission to move tasks.",
    // A soft-deleted task behaves as "not found", same convention as
    // moveTaskStatus/reorderTask's task lookup.
    resolveWorkspace: async (input, admin) => {
      const { data: taskRow, error } = await admin
        .from("tasks")
        .select(
          "id, deleted_at, status, projects!inner(id, workspace_id, visibility)",
        )
        .eq("id", input.taskId)
        .is("deleted_at", null)
        .maybeSingle();

      if (error || !taskRow) return { ok: false, error: "Task not found." };

      const project = Array.isArray(taskRow.projects)
        ? taskRow.projects[0]
        : taskRow.projects;

      if (!project?.workspace_id) return { ok: false, error: "Task not found." };

      return {
        ok: true,
        workspaceId: project.workspace_id,
        projectId: project.id,
        visibility: (project.visibility as ProjectVisibility) ?? "workspace",
        extra: { previousStatus: taskRow.status as string },
      };
    },
  },
  async (input, ctx): Promise<MoveAndReorderTaskResult> => {
    // F221 (AS-409): same column-name guard as moveTaskStatus above — see
    // that function's doc comment for why this check (not just the DB
    // trigger) is the real backstop against an unmatched/stale column
    // name.
    const { data: columnMatch } = await ctx.admin
      .from("project_statuses")
      .select("id")
      .eq("project_id", ctx.projectId as string)
      .eq("name", input.status)
      .maybeSingle();

    if (!columnMatch) {
      return {
        ok: false,
        error: "That column no longer exists. Refresh the board and try again.",
      };
    }

    // Single UPDATE, both columns set together — atomic by construction.
    // If this fails (constraint violation, connection drop, etc.), NEITHER
    // status NOR position changes; there is no partial-commit state for
    // the client to be inconsistent with.
    const { data: updated, error: updateError } = await ctx.admin
      .from("tasks")
      .update({ status: input.status, position: input.position })
      .eq("id", input.taskId)
      .select("id, status, position")
      .single();

    if (updateError || !updated) {
      logger.error("moveAndReorderTask: update failed", { error: updateError });
      return {
        ok: false,
        error: "Something went wrong. Please try again in a moment.",
      };
    }

    // F306 (D9/FU-3 scrutiny fix, AS-353, AS-355): the board drag path was
    // the single most common way a task's status ever changes and had
    // ZERO activity entry — record the status change exactly like
    // moveTaskStatus does above, non-fatal. Guarded on an actual status
    // change (unlike a pure in-column reorder, which never touches
    // `status` at all) so a same-column drag doesn't fabricate a "status
    // changed" entry/notify.
    if (ctx.previousStatus !== updated.status) {
      try {
        const changes = diffTaskFields(
          { status: ctx.previousStatus },
          { status: updated.status },
        );
        await writeTaskFieldChanges(ctx.supabase, input.taskId, changes);
      } catch (activityError) {
        logger.error("moveAndReorderTask: writeTaskFieldChanges failed (non-fatal)", { error: activityError });
      }

      // F306 (D9/FU-3 scrutiny fix, AS-294, AS-382): notify the task's
      // current active watchers of the status change — same fan-out
      // moveTaskStatus performs, routed through the same shared helpers.
      // Non-fatal.
      try {
        const { data: watcherRows } = await ctx.admin
          .from("task_watchers")
          .select("user_id")
          .eq("task_id", input.taskId)
          .eq("is_watching", true);
        const watcherIds = (watcherRows ?? []).map(
          (row) => row.user_id as string,
        );

        const computedRecipients = computeFanoutRecipients({
          type: "status_changed",
          actorId: ctx.user.id,
          watcherIds,
        });
        const recipients = await filterRecipientsByInAppPreference(
          ctx.admin,
          computedRecipients ?? [],
        );
        for (const recipient of recipients ?? []) {
          await createNotification(
            ctx.supabase,
            {
              userId: recipient.userId,
              workspaceId: ctx.workspaceId,
              kind: recipient.kind,
              taskId: input.taskId,
            },
            "moveAndReorderTask",
          );
        }
      } catch (fanoutError) {
        logger.error("moveAndReorderTask: notification fan-out failed (non-fatal)", { error: fanoutError });
      }
    }

    const { data: workspaceRow } = await ctx.admin
      .from("workspaces")
      .select("slug")
      .eq("id", ctx.workspaceId)
      .maybeSingle();

    if (workspaceRow?.slug) {
      try {
        revalidatePath(`/w/${workspaceRow.slug}`, "layout");
      } catch (revalidateError) {
        // Non-fatal cache-freshness rationale, same as createTask above.
        logger.error("moveAndReorderTask: revalidatePath failed (non-fatal)", { error: revalidateError });
      }
    }

    return {
      ok: true,
      data: {
        id: updated.id,
        status: updated.status,
        position: updated.position,
      },
    };
  },
);

export async function moveAndReorderTask(
  taskId: string,
  // F221 (AS-409): any of the project's real `project_statuses` column
  // names — see moveAndReorderTaskSchema's doc comment.
  newStatus: string,
  newPosition: number,
): Promise<MoveAndReorderTaskResult> {
  return moveAndReorderTaskImpl({
    taskId,
    status: newStatus,
    position: newPosition,
  });
}

export type GetOpenBlockersResult =
  | { ok: true; data: DependencyRelatedTask[] }
  | { ok: false; error: string };

// F158 (AS-280, AS-281): the ONE server-side source of "which of this
// task's blockers are still open (not done, not soft-deleted)" — called
// by components/task/blocked-done-guard.tsx's useBlockedDoneGuard hook
// (see lib/tasks/blocked-guard.ts's isDoneStatus doc comment for the
// full list of callers: board drag-and-drop, the list view's inline
// status select, the task detail sheet's own status Select, and a
// future bulk update), never re-queried ad hoc from board.tsx/
// list-status-select.tsx/task-detail-sheet.tsx themselves.
//
// Mirrors getTaskDetail's own blockedByQuery below almost exactly (same
// FK-disambiguated embed via task_dependencies_blocking_task_id_fkey,
// same soft-delete filter) — deliberately NOT reused as a shared query
// function between the two. getTaskDetail fetches BOTH directions
// (blockedBy + blocks) plus seven other sections in a single big
// Promise.all for the whole task-detail sheet; this action's entire job
// is one fast lookup at the moment of an actual status-change attempt.
// Routing every caller of this guard through getTaskDetail's much
// heavier shape would cost board.tsx/list-status-select.tsx (which have
// no other use for a task's comments/attachments/checklist/subtasks) an
// unnecessary fetch of all of that, every single time a user tries to
// complete a task — the opposite of this feature's own performance
// budget ("no per-item network call" only holds if this stays a small,
// single-purpose lookup).
//
// "Open" here means the SAME thing lib/queries/tasks.ts's
// getProjectBoardTasks already established for the board card's AS-283
// indicator: a blocker whose own status isn't done (isDoneStatus,
// lib/tasks/blocked-guard.ts — the one place this comparison lives, per
// that file's F222 sweep note) and that hasn't been soft-deleted.
//
// Pattern otherwise mirrors moveTaskStatus/reorderTask above: Zod-
// validated input, membership re-checked server-side (defense in depth,
// AS-143), admin client for the read (RLS would also allow this same
// read for an active member, same rationale as getTaskDetail), generic
// user-facing errors with details only logged server-side (AS-146). Any
// active workspace member may check any task's blockers in that
// workspace — no per-task ownership check, same convention as every
// other read/write in this file.
// W11: migrated onto withAuthz — see deleteTaskImpl above and
// lib/actions/authz.ts's doc comment. A pure read, so `requireWrite` is
// left at its default `false`; only membership + F323 visibility gate it.
const getOpenBlockersImpl = withAuthz(
  getOpenBlockersSchema,
  {
    membershipError: "You don't have permission to view this task.",
    requireVisibility: true,
    // F323 (AS-227, AS-228, AS-229): read-path confidentiality — returns
    // the SAME "Task not found" message this function already uses for a
    // genuinely missing/deleted task (never a permission-denied message),
    // so a read-path leak never even confirms the task exists.
    visibilityError: "Task not found.",
    // Same task -> project -> workspace lookup convention as
    // moveTaskStatus/reorderTask/etc. — the real owning workspace is
    // resolved server-side, never trusted from the client. A soft-deleted
    // task behaves as "not found".
    resolveWorkspace: async (input, admin) => {
      const { data: taskRow, error } = await admin
        .from("tasks")
        .select("id, deleted_at, projects!inner(id, workspace_id, visibility)")
        .eq("id", input.taskId)
        .is("deleted_at", null)
        .maybeSingle();

      if (error || !taskRow) return { ok: false, error: "Task not found." };

      const project = Array.isArray(taskRow.projects)
        ? taskRow.projects[0]
        : taskRow.projects;

      if (!project?.workspace_id) return { ok: false, error: "Task not found." };

      return {
        ok: true,
        workspaceId: project.workspace_id,
        projectId: project.id,
        visibility: (project.visibility as ProjectVisibility) ?? "workspace",
        extra: {},
      };
    },
  },
  async (input, ctx): Promise<GetOpenBlockersResult> => {
    // Same blocked_task_id -> blocking task embed + FK disambiguation as
    // getTaskDetail's own blockedByQuery below (F155's two same-table FKs,
    // task_dependencies_blocking_task_id_fkey/_blocked_task_id_fkey).
    // F222 (AS-410): `status_id, project_statuses(category)` added to the
    // embedded `blocking` task so "is this blocker still open" is decided
    // by the blocker's own column CATEGORY, not the literal string "done"
    // — same fallback rule as every other call site
    // (lib/tasks/status-category.ts's isDoneStatus).
    const { data: rows, error: blockersError } = await ctx.admin
      .from("task_dependencies")
      .select(
        "id, blocking:tasks!task_dependencies_blocking_task_id_fkey(id, title, status, status_id, number, deleted_at, projects(key), project_statuses(category))",
      )
      .eq("blocked_task_id", input.taskId);

    if (blockersError) {
      logger.error("getOpenBlockers: dependency fetch failed", { error: blockersError });
      return {
        ok: false,
        error:
          "Something went wrong checking this task's blockers. Please try again.",
      };
    }

    const openBlockers: DependencyRelatedTask[] = (rows ?? [])
      .map((row) => {
        const blocking = Array.isArray(row.blocking)
          ? row.blocking[0]
          : row.blocking;
        const blockingStatusCategory = Array.isArray(blocking?.project_statuses)
          ? blocking.project_statuses[0]?.category
          : blocking?.project_statuses?.category;
        if (
          !blocking ||
          blocking.deleted_at ||
          isDoneStatus(blocking.status, blockingStatusCategory)
        ) {
          return null;
        }
        const blockingProject = Array.isArray(blocking.projects)
          ? blocking.projects[0]
          : blocking.projects;
        const related: DependencyRelatedTask = {
          dependencyId: row.id,
          taskId: blocking.id,
          title: blocking.title,
          status: blocking.status as DependencyRelatedTask["status"],
          projectKey: blockingProject?.key,
          number: blocking.number,
        };
        return related;
      })
      .filter((row): row is DependencyRelatedTask => row !== null);

    return { ok: true, data: openBlockers };
  },
);

export async function getOpenBlockers(
  taskId: string,
): Promise<GetOpenBlockersResult> {
  return getOpenBlockersImpl({ taskId });
}

// BUGFIX (TaskDetailSheet was fully built but never rendered anywhere):
// on-demand fetch of one task's full detail — every field
// TaskDetailSheet's props interface needs beyond what the board/list's
// summary queries (getProjectBoardTasks/getProjectListTasks,
// lib/queries/tasks.ts) already carry, plus its comments and attachments —
// in a single round trip, called from the client the moment a TaskCard is
// clicked and the sheet opens. Mirrors this file's other Server Actions:
// Zod-validated input (deleteTaskSchema's shape — just a task id — is
// reused since this action takes the identical single-field input),
// admin client for the reads (RLS would also allow these same reads for an
// active member, per the same rationale documented on editTask/addComment/
// etc.), discriminated-union return, generic user-facing errors with
// details only logged server-side (AS-146).
//
// Unlike the mutating actions in this file, this is a pure read — but it
// still independently re-verifies the caller is an active member of the
// task's owning workspace (defense in depth, AS-143) before returning any
// task/comment/attachment data, exactly like every other action here.
//
// Comments/attachments are fetched non-deleted-only and ordered the same
// way their respective components' doc comments already assume:
// CommentList expects oldest-first (AS-096); AttachmentList has no
// ordering assertion of its own, so created_at ascending (upload order) is
// used for the same "oldest/first-uploaded first" consistency.
//
// Attachment signed URLs (AS-108: never a permanent public URL) are minted
// here for every attachment up front, same bucket/TTL convention as
// lib/actions/attachments.ts's uploadAttachment/getAttachmentSignedUrl —
// re-exported from that file rather than duplicated. AttachmentList's
// per-row "Open" click still re-mints its own fresh signed URL on demand
// (unchanged), so a URL returned here going stale after
// SIGNED_URL_TTL_SECONDS while the sheet stays open is not a functional
// problem — it's read once for the initial render's implicit "did this
// file resolve" info and is not otherwise exercised by this codebase's
// existing components (both TaskDetailSheet and AttachmentList only ever
// call getAttachmentSignedUrl for actually opening a file).
export type GetTaskDetailResult =
  | {
      ok: true;
      data: {
        task: TaskDetailSheetTask;
        comments: TaskComment[];
        attachments: TaskAttachment[];
        currentUserId: string;
        // F128 (AS-216): widened from "owner" | "admin" | "member" to the
        // full WorkspaceRole (adds "viewer" | "guest") — see
        // lib/auth/require-membership.ts's matching widening.
        currentUserRole: WorkspaceRole;
      };
    }
  | { ok: false; error: string };

export async function getTaskDetail(
  taskId: string,
): Promise<GetTaskDetailResult> {
  const parsed = deleteTaskSchema.safeParse({ taskId });

  if (!parsed.success) {
    return { ok: false, error: "Invalid task." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to view this task." };
  }

  const admin = createAdminClient();

  // Same task-scoped -> project -> workspace lookup convention as every
  // other action in this file (editTask, deleteTask, etc.) — the real
  // owning workspace is resolved server-side, never trusted from the
  // client. A soft-deleted task behaves as "not found".
  const { data: taskRow, error: taskError } = await admin
    .from("tasks")
    .select(
      // F146 (AS-258): `number` and the joined `key` are selected here
      // via this action's existing task+project fetch — no second round
      // trip for the detail header's task-key badge.
      // F150 (AS-263, AS-264): `project_id` (needed by the Subtasks
      // section's add-subtask form to call createTask) and
      // `parent_task_id` (drives whether the parent-lookup query below
      // runs at all) are selected here for the exact same "one query,
      // not a second round trip" reason.
      // F167 follow-up: `estimate_minutes` added here so
      // TaskDetailSheetTask.estimateMinutes (F167's UI, previously always
      // undefined on this path) actually receives real data — see this
      // function's mapping below.
      // F171 (AS-307, AS-309): `description_json` added here so the detail
      // sheet can render the safe, formatted Tiptap document via
      // RichTextRenderer instead of only ever showing the plain-text
      // `description` column — same "one query, no second round trip"
      // convention as every other field on this select. F170 backfills
      // and keeps this column in sync via a DB trigger, so it always
      // exists (an empty `{ type: "doc", content: [] }` doc for
      // null/empty descriptions), never null-vs-column-missing.
      // F179 (AS-317, AS-318, AS-319): `recurrence`/`recurrence_parent_id`
      // added here so the detail sheet's recurrence picker/remove control
      // and the occurrence-to-source link both read real data instead of
      // always-undefined — same "one query, no second round trip"
      // convention as every other field on this select.
      // F222 (AS-410): `status_id, project_statuses(category)` added so
      // TaskDetailSheetTask.statusCategory (isOverdue's category-aware
      // check) gets real data — same "one query, no second round trip"
      // convention as every other field on this select.
      // F005 (missions/20260903-portal, AS-014): `page_slug`/`page_order`
      // (this task's own portal-Pages-view ordering/identity) and
      // `task_types(name, system_key)` (this task's TYPE, both its
      // display name AND its stable `system_key` — F006c/AS-014 gates
      // the detail sheet's page fields on `system_key = 'page'`, NOT the
      // name, so a workspace whose page type is named "Sida" still shows
      // and orders them; `name` is kept for display/logging elsewhere)
      // — one extra join, no second round trip, same convention as
      // every other field on this select.
      // F006c (missions/20260903-portal, AS-013): `phase_id` — this
      // task's own phase assignment. Selected here for the first time;
      // `setTaskPhase` (lib/actions/phases.ts) has written this column
      // since F002, but nothing ever read it back until now, which is
      // exactly why AS-013 never actually held (see this feature's
      // spec/handoff).
      "id, title, description, description_json, status, status_id, priority, assignee_id, due_date, start_date, tags, number, project_id, parent_task_id, deleted_at, estimate_minutes, recurrence, recurrence_parent_id, client_visible, pending_client_approval, page_slug, page_order, phase_id, task_types(name, system_key), projects!inner(key, workspace_id, visibility), project_statuses(category)",
    )
    .eq("id", parsed.data.taskId)
    .is("deleted_at", null)
    .maybeSingle();

  if (taskError || !taskRow) {
    return { ok: false, error: "Task not found." };
  }

  const project = taskRow.projects as
    | { key: string; workspace_id: string; visibility: ProjectVisibility | null }
    | { key: string; workspace_id: string; visibility: ProjectVisibility | null }[]
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

  // F323 (AS-227, AS-228, AS-229): read-path confidentiality — the caller
  // must be able to SEE this task's project themselves, not just be an
  // active workspace member (see isProjectVisibleToCaller's doc comment in
  // lib/actions/project-visibility.ts). Returns the SAME "Task not found"
  // message this function already uses for a genuinely missing/deleted
  // task (never a permission-denied message), so a read-path leak never
  // even confirms the task exists.
  if (
    !(await isProjectVisibleToCaller(
      admin,
      {
        projectId: taskRow.project_id,
        visibility: projectRow?.visibility ?? "workspace",
      },
      user.id,
      membership.role,
    ))
  ) {
    return { ok: false, error: "Task not found." };
  }

  // F150 (AS-264): this task's own live children (subtasks), fetched here
  // — inside getTaskDetail's existing single detail-fetch — rather than a
  // per-child round trip once the Subtasks section renders. A task that
  // is itself a child can never have children of its own (F148's
  // one-level nesting limit, enforced by enforce_task_parent_rules()), so
  // this query harmlessly returns zero rows for a child task rather than
  // needing its own conditional branch.
  // F222 (AS-410): `status_id, project_statuses(category)` added so the
  // Subtasks section's "N of M done" count (countSubtaskProgress) is
  // category-aware — see this feature's status-category.ts.
  const childrenQuery = admin
    .from("tasks")
    .select(
      "id, title, status, status_id, assignee_id, number, project_statuses(category)",
    )
    .eq("parent_task_id", parsed.data.taskId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  // F153 (AS-269 UI half): this task's own checklist items, fetched here
  // in getTaskDetail's existing single detail-fetch, same convention as
  // `childrenQuery` immediately above — the checklist UI (components/
  // task/checklist.tsx) never queries Supabase directly, it only renders
  // whatever this Server Action hands it (Clarified implementation's
  // Data shape answer). Position-ascending, since that's the order
  // AS-269/AS-271 expect the checklist to render and reorder in — the
  // same `(task_id, position)` composite index F151's migration created
  // for exactly this query shape.
  const checklistQuery = admin
    .from("checklist_items")
    .select("id, content, is_checked, position")
    .eq("task_id", parsed.data.taskId)
    .order("position", { ascending: true });

  // F150 (AS-263): only run the parent lookup when this task actually
  // has one — a top-level task's parent_task_id is null, so there is
  // nothing to look up (`parentQuery` stays null and the resolved
  // `parentResult.data` below stays null too).
  const parentQuery = taskRow.parent_task_id
    ? admin
        .from("tasks")
        .select("id, title, number")
        .eq("id", taskRow.parent_task_id)
        .is("deleted_at", null)
        .maybeSingle()
    : null;

  // F179 (AS-318): only run the recurrence-source lookup when this task
  // is itself a GENERATED OCCURRENCE (`recurrence_parent_id` set, F177's
  // handoff: it always points at the series ROOT, never an intermediate
  // occurrence) — a top-level/root recurring task's own
  // `recurrence_parent_id` is null, so there is nothing to look up, same
  // "conditional query" convention as `parentQuery` immediately above.
  const recurrenceSourceQuery = taskRow.recurrence_parent_id
    ? admin
        .from("tasks")
        .select("id, title, number")
        .eq("id", taskRow.recurrence_parent_id)
        .is("deleted_at", null)
        .maybeSingle()
    : null;

  // F157 (AS-277): this task's own dependency rows, in BOTH directions,
  // fetched here in getTaskDetail's existing single detail-fetch — same
  // "one query per section, no per-row round trip" convention as
  // `childrenQuery`/`checklistQuery` above. `task_dependencies` has TWO
  // foreign keys to `tasks` (blocking_task_id, blocked_task_id), so each
  // embedded `tasks` relation below is disambiguated with PostgREST's
  // `!constraint_name` hint (the auto-generated FK names from F155's
  // migration: task_dependencies_blocking_task_id_fkey/
  // _blocked_task_id_fkey — confirmed against
  // lib/supabase/database.types.ts's own Relationships entries for this
  // table) and aliased so the result shape is self-describing.
  //
  // The related task's OWN project key is fetched via its own nested
  // `projects(key)` join, NOT assumed to equal this task's projectKey —
  // unlike a subtask/parent pair (always the same project,
  // enforce_task_parent_rules()), a dependency's two tasks are only
  // guaranteed to share a WORKSPACE (AS-285), not a project, so the
  // related task can carry a different key.
  const blockedByQuery = admin
    .from("task_dependencies")
    .select(
      "id, blocking:tasks!task_dependencies_blocking_task_id_fkey(id, title, status, number, deleted_at, projects(key))",
    )
    .eq("blocked_task_id", parsed.data.taskId)
    .order("created_at", { ascending: true });

  const blocksQuery = admin
    .from("task_dependencies")
    .select(
      "id, blocked:tasks!task_dependencies_blocked_task_id_fkey(id, title, status, number, deleted_at, projects(key))",
    )
    .eq("blocking_task_id", parsed.data.taskId)
    .order("created_at", { ascending: true });

  // F161 follow-through (AS-287, AS-288): this task's full current
  // assignee set, oldest-first — same ordering `setTaskAssigneesCore`'s
  // mirror rule and the board RPC's `assignee_ids` column both use (see
  // that RPC's migration for the identical tie-break), so the detail
  // sheet's assignee picker shows the same set/order as the card it was
  // opened from. Fetched here in getTaskDetail's existing single
  // detail-fetch, same "one query per section, no per-row round trip"
  // convention as every other section above.
  const assigneesQuery = admin
    .from("task_assignees")
    .select("user_id")
    .eq("task_id", parsed.data.taskId)
    .order("created_at", { ascending: true });

  // F165 (AS-297): this task's CURRENT watcher set — `is_watching = true`
  // only, per F164's own durability rule (a row can exist with
  // `is_watching: false` for an explicit opt-out; that must never surface
  // as "watching" here). Same "one query per section, fetched once with
  // the task" convention as `assigneesQuery` immediately above — no
  // second round trip from the Watchers component below.
  const watchersQuery = admin
    .from("task_watchers")
    .select("user_id")
    .eq("task_id", parsed.data.taskId)
    .eq("is_watching", true)
    .order("created_at", { ascending: true });

  const [
    commentsResult,
    attachmentsResult,
    childrenResult,
    parentResult,
    recurrenceSourceResult,
    checklistResult,
    blockedByResult,
    blocksResult,
    assigneesResult,
    watchersResult,
  ] = await Promise.all([
    admin
      .from("comments")
      // F303 follow-up (D3/FU-1, AS-363): `edited_at` and `body_json`
      // added — previously omitted, which is why the "(edited)" marker and
      // rich-text body only ever survived within the posting session and
      // silently reverted on reload (getTaskDetail never carried them).
      .select("id, task_id, user_id, text, body_json, created_at, edited_at")
      .eq("task_id", parsed.data.taskId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true }),
    admin
      .from("attachments")
      .select("id, task_id, file_url, file_name, uploaded_by, created_at, mime_type")
      .eq("task_id", parsed.data.taskId)
      .order("created_at", { ascending: true }),
    childrenQuery,
    parentQuery ?? Promise.resolve({ data: null, error: null }),
    recurrenceSourceQuery ?? Promise.resolve({ data: null, error: null }),
    checklistQuery,
    blockedByQuery,
    blocksQuery,
    assigneesQuery,
    watchersQuery,
  ]);

  if (commentsResult.error) {
    logger.error("getTaskDetail: comments fetch failed", { error: commentsResult.error });
    return {
      ok: false,
      error: "Something went wrong loading this task. Please try again.",
    };
  }

  // F303 follow-up (D3/FU-1, AS-365, AS-366): batched fetch of every
  // comment's reactions in ONE query (not one query per comment — same
  // batch-then-group-in-TS convention as
  // lib/comments/mentions.ts's resolveVisibleMentionIds and
  // lib/queries/notifications.ts's actor/task batching), grouped here by
  // `comment_id` then `emoji` into exactly `CommentReactionSummary`'s
  // shape (components/task/comment-reactions.tsx) so `TaskComment.reactions`
  // is directly assignable with no second, incompatible shape. Skipped
  // entirely when this task has no comments (nothing to react to).
  const commentIds = (commentsResult.data ?? []).map((row) => row.id);
  const reactionsByCommentId = new Map<string, Map<string, string[]>>();
  if (commentIds.length > 0) {
    const { data: reactionRows, error: reactionsError } = await admin
      .from("comment_reactions")
      .select("comment_id, user_id, emoji")
      .in("comment_id", commentIds)
      .order("created_at", { ascending: true });

    if (reactionsError) {
      logger.error("getTaskDetail: reactions fetch failed", { error: reactionsError });
      return {
        ok: false,
        error: "Something went wrong loading this task. Please try again.",
      };
    }

    for (const row of reactionRows ?? []) {
      let byEmoji = reactionsByCommentId.get(row.comment_id);
      if (!byEmoji) {
        byEmoji = new Map<string, string[]>();
        reactionsByCommentId.set(row.comment_id, byEmoji);
      }
      const userIds = byEmoji.get(row.emoji);
      if (userIds) {
        userIds.push(row.user_id);
      } else {
        byEmoji.set(row.emoji, [row.user_id]);
      }
    }
  }

  if (attachmentsResult.error) {
    logger.error("getTaskDetail: attachments fetch failed", { error: attachmentsResult.error });
    return {
      ok: false,
      error: "Something went wrong loading this task. Please try again.",
    };
  }

  if (childrenResult.error) {
    logger.error("getTaskDetail: children fetch failed", { error: childrenResult.error });
    return {
      ok: false,
      error: "Something went wrong loading this task. Please try again.",
    };
  }

  if (parentResult.error) {
    logger.error("getTaskDetail: parent fetch failed", { error: parentResult.error });
    return {
      ok: false,
      error: "Something went wrong loading this task. Please try again.",
    };
  }

  if (recurrenceSourceResult.error) {
    logger.error("getTaskDetail: recurrence source fetch failed", { error: recurrenceSourceResult.error });
    return {
      ok: false,
      error: "Something went wrong loading this task. Please try again.",
    };
  }

  if (checklistResult.error) {
    logger.error("getTaskDetail: checklist fetch failed", { error: checklistResult.error });
    return {
      ok: false,
      error: "Something went wrong loading this task. Please try again.",
    };
  }

  if (blockedByResult.error) {
    logger.error("getTaskDetail: blocked-by dependencies fetch failed", { error: blockedByResult.error });
    return {
      ok: false,
      error: "Something went wrong loading this task. Please try again.",
    };
  }

  if (blocksResult.error) {
    logger.error("getTaskDetail: blocks dependencies fetch failed", { error: blocksResult.error });
    return {
      ok: false,
      error: "Something went wrong loading this task. Please try again.",
    };
  }

  if (assigneesResult.error) {
    logger.error("getTaskDetail: assignees fetch failed", { error: assigneesResult.error });
    return {
      ok: false,
      error: "Something went wrong loading this task. Please try again.",
    };
  }

  if (watchersResult.error) {
    logger.error("getTaskDetail: watchers fetch failed", { error: watchersResult.error });
    return {
      ok: false,
      error: "Something went wrong loading this task. Please try again.",
    };
  }

  // F157 (AS-277): a soft-deleted related task (deleted_at set, but the
  // row not physically removed — task_dependencies' `on delete cascade`
  // only fires on a genuine hard DELETE, per F155's own handoff note)
  // must not surface as a live-looking row here. Filtered in TypeScript
  // rather than a PostgREST embedded-resource filter, since this is a
  // single whole-task query either way (no per-row round trip either
  // way) and a plain `.filter()` is simpler than an `!inner` join plus
  // dot-path filter for a two-row-shape (object-or-array) embed.
  const blockedBy: DependencyRelatedTask[] = (blockedByResult.data ?? [])
    .map((row) => {
      const blocking = Array.isArray(row.blocking)
        ? row.blocking[0]
        : row.blocking;
      if (!blocking || blocking.deleted_at) return null;
      const blockingProject = Array.isArray(blocking.projects)
        ? blocking.projects[0]
        : blocking.projects;
      const related: DependencyRelatedTask = {
        dependencyId: row.id,
        taskId: blocking.id,
        title: blocking.title,
        status: blocking.status as DependencyRelatedTask["status"],
        projectKey: blockingProject?.key,
        number: blocking.number,
      };
      return related;
    })
    .filter((row): row is DependencyRelatedTask => row !== null);

  const blocks: DependencyRelatedTask[] = (blocksResult.data ?? [])
    .map((row) => {
      const blocked = Array.isArray(row.blocked)
        ? row.blocked[0]
        : row.blocked;
      if (!blocked || blocked.deleted_at) return null;
      const blockedProject = Array.isArray(blocked.projects)
        ? blocked.projects[0]
        : blocked.projects;
      const related: DependencyRelatedTask = {
        dependencyId: row.id,
        taskId: blocked.id,
        title: blocked.title,
        status: blocked.status as DependencyRelatedTask["status"],
        projectKey: blockedProject?.key,
        number: blocked.number,
      };
      return related;
    })
    .filter((row): row is DependencyRelatedTask => row !== null);

  const attachmentRows = attachmentsResult.data ?? [];

  // AS-106/AS-108: `fileUrl` here is the Storage object path (the same
  // value uploadAttachment inserts into the `attachments.file_url`
  // column), never a permanent public URL — this component's "Open"
  // action (AttachmentList.handleOpen) always mints its own fresh signed
  // URL on demand via getAttachmentSignedUrl before opening a file, so
  // this list-population fetch doesn't need to (and per AS-108's "don't
  // cache a stale one" intent, shouldn't) pre-mint one per row here.
  const attachments: TaskAttachment[] = attachmentRows.map((row) => ({
    id: row.id,
    taskId: row.task_id,
    fileName: row.file_name,
    fileUrl: row.file_url,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    mimeType: row.mime_type,
  }));

  return {
    ok: true,
    data: {
      task: {
        id: taskRow.id,
        title: taskRow.title,
        description: taskRow.description,
        // F171 (AS-307, AS-309): passed straight through as the Tiptap
        // `JSONContent` shape — the `Json` DB type is a structural
        // superset of `JSONContent`; RichTextRenderer/sanitiseDocument
        // validate/allow-list this at render time rather than trusting
        // the column's shape, since this is untrusted, previously-stored
        // content (AS-309 exists precisely because this can't be assumed
        // safe).
        descriptionJson: taskRow.description_json as
          | TaskDetailSheetTask["descriptionJson"]
          | undefined,
        status: taskRow.status as TaskDetailSheetTask["status"],
        // F222 (AS-410): see this function's select above.
        statusCategory: (
          Array.isArray(taskRow.project_statuses)
            ? taskRow.project_statuses[0]
            : taskRow.project_statuses
        )?.category,
        priority: taskRow.priority as TaskDetailSheetTask["priority"],
        assigneeId: taskRow.assignee_id,
        // F161 follow-through (AS-287, AS-288): see assigneesQuery above
        // — feeds the detail sheet's UserAvatarGroup header and its
        // multi-select assignee picker (both read/write this same set via
        // setTaskAssignees, never the deprecated single `assigneeId`
        // directly, once this field is populated).
        assigneeIds: (assigneesResult.data ?? []).map((row) => row.user_id),
        // F165 (AS-297): this task's current watcher set (is_watching:
        // true only, see watchersQuery above) plus whether the CALLING
        // user specifically is among them — the toggle button's
        // label/icon reflects `isWatching` for this signed-in caller,
        // never a generic "N people are watching" count (clarified
        // spec's own wording).
        watcherIds: (watchersResult.data ?? []).map((row) => row.user_id),
        isWatching: (watchersResult.data ?? []).some(
          (row) => row.user_id === user.id,
        ),
        dueDate: taskRow.due_date,
        // C2: whether this task is shared with the workspace's clients —
        // drives the detail sheet's share toggle. Selected on the same
        // query as everything else here, no second round trip.
        clientVisible: taskRow.client_visible ?? false,
        // F1 (docs/client-dashboard-features-plan.md): whether this task
        // is waiting on a client decision — same select, same reasoning.
        pendingClientApproval: taskRow.pending_client_approval ?? false,
        // F236 (AS-453): see this function's task select above.
        startDate: taskRow.start_date,
        // F005 (missions/20260903-portal, AS-014): see this function's
        // task select above — feeds the detail sheet's Page slug/order
        // inline fields directly, no local re-derivation.
        pageSlug: taskRow.page_slug,
        pageOrder: taskRow.page_order,
        taskTypeName:
          (Array.isArray(taskRow.task_types)
            ? taskRow.task_types[0]
            : taskRow.task_types
          )?.name ?? null,
        // F006c (missions/20260903-portal, AS-014): this task's type's
        // stable role, independent of its human-editable name — the
        // detail sheet gates the page fields on THIS, not taskTypeName
        // (see that gate's own doc comment in task-detail-sheet.tsx).
        taskTypeSystemKey:
          (Array.isArray(taskRow.task_types)
            ? taskRow.task_types[0]
            : taskRow.task_types
          )?.system_key ?? null,
        // F006c (missions/20260903-portal, AS-013): this task's current
        // phase assignment — see this function's task select above for
        // why this was never returned before this feature.
        phaseId: taskRow.phase_id,
        tags: taskRow.tags ?? [],
        // F146 (AS-258): see this function's task+project select above.
        number: taskRow.number,
        projectKey: projectRow?.key,
        // F167 follow-up: see this function's task select above — threads
        // the estimate through to TimeTracking via TaskDetailSheetTask.
        estimateMinutes: taskRow.estimate_minutes,
        // F150 (AS-263, AS-264): see this function's task select above —
        // `projectId` feeds the Subtasks section's add-subtask form,
        // `parentTaskId`/`parent` feed the "Subtask of ..." breadcrumb,
        // and `children` feeds the Subtasks section's list + completion
        // count. A subtask and its parent always share the SAME project
        // (F148's invariant), so both reuse this task's own
        // `projectRow?.key` for their task-key badges rather than a
        // second per-row join.
        projectId: taskRow.project_id,
        parentTaskId: taskRow.parent_task_id,
        parent: parentResult.data
          ? {
              id: parentResult.data.id,
              title: parentResult.data.title,
              projectKey: projectRow?.key,
              number: parentResult.data.number,
            }
          : null,
        // F179 (AS-317, AS-318, AS-319): the task's own recurrence rule
        // (null means no active rule) — feeds the RecurrenceEditor
        // picker's live summary/remove control below.
        recurrence: taskRow.recurrence as TaskDetailSheetTask["recurrence"],
        recurrenceParentId: taskRow.recurrence_parent_id,
        // F179 (AS-318): only populated when this task is itself a
        // GENERATED OCCURRENCE (see recurrenceSourceQuery above) — the
        // detail view's "View source task" link.
        recurrenceSource: recurrenceSourceResult.data
          ? {
              id: recurrenceSourceResult.data.id,
              title: recurrenceSourceResult.data.title,
              projectKey: projectRow?.key,
              number: recurrenceSourceResult.data.number,
            }
          : null,
        children: (childrenResult.data ?? []).map(
          (row): SubtaskListChildTask => ({
            id: row.id,
            title: row.title,
            status: row.status as SubtaskListChildTask["status"],
            // F222 (AS-410): see childrenQuery above. Same
            // array-or-object PostgREST embed normalization this file
            // uses everywhere else (e.g. taskRow.projects above).
            statusCategory: (
              Array.isArray(row.project_statuses)
                ? row.project_statuses[0]
                : row.project_statuses
            )?.category,
            assigneeId: row.assignee_id,
            projectKey: projectRow?.key,
            number: row.number,
          }),
        ),
        // F153 (AS-269 UI half): see checklistQuery above.
        checklistItems: (checklistResult.data ?? []).map(
          (row): ChecklistListItem => ({
            id: row.id,
            content: row.content,
            isChecked: row.is_checked,
            position: row.position,
          }),
        ),
        // F157 (AS-277): see blockedByQuery/blocksQuery above — both
        // directions, computed once here, never a per-section round trip
        // from components/task/dependencies.tsx.
        dependencies: { blockedBy, blocks },
      },
      comments: (commentsResult.data ?? []).map((row) => ({
        id: row.id,
        taskId: row.task_id,
        userId: row.user_id,
        text: row.text,
        // F303 follow-up (D3/FU-1, AS-363): body_json/edited_at now
        // actually selected above — this is the read-path fix that makes
        // the "(edited)" marker and rich-text body survive a reload.
        bodyJson: row.body_json as TaskComment["bodyJson"],
        createdAt: row.created_at,
        editedAt: row.edited_at,
        // F303 follow-up (D3/FU-1, AS-365, AS-366): from the batched fetch
        // above, converted into CommentReactionSummary's exact shape.
        // Falls back to [] for a comment with no reactions, same
        // "always an array" convention as assigneeIds/watcherIds above.
        reactions: Array.from(
          reactionsByCommentId.get(row.id)?.entries() ?? [],
        ).map(([emoji, userIds]) => ({ emoji, userIds })),
      })),
      attachments,
      currentUserId: user.id,
      currentUserRole: membership.role,
    },
  };
}

// F173 (AS-311): recursively finds the `taskItem` node carrying `itemId`
// (its `id` attr, assigned client-side by
// components/editor/rich-text-editor.tsx's `TaskItemWithId`) inside a
// Tiptap JSON document and returns a NEW document with only that node's
// `checked` attr flipped — every other node/array in the tree is reused
// by reference (not cloned) except along the path down to the match, so
// this stays cheap even for a long description. Returns `null` if no node
// with that id exists (already-deleted item, stale client, or a document
// stored before ids existed) so the caller can distinguish "nothing to
// toggle" from "toggled".
function setTaskItemChecked(
  node: JSONContent,
  itemId: string,
  checked: boolean,
): JSONContent | null {
  if (
    node.type === "taskItem" &&
    (node.attrs as { id?: unknown } | undefined)?.id === itemId
  ) {
    return { ...node, attrs: { ...node.attrs, checked } };
  }
  if (!Array.isArray(node.content)) return null;
  for (let i = 0; i < node.content.length; i++) {
    const updatedChild = setTaskItemChecked(node.content[i], itemId, checked);
    if (updatedChild) {
      const content = node.content.slice();
      content[i] = updatedChild;
      return { ...node, content };
    }
  }
  return null;
}

export type ToggleDescriptionChecklistItemResult =
  | { ok: true; data: { descriptionJson: JSONContent } }
  | { ok: false; error: string };

// F173 (AS-311): toggles a single checkbox inside a task description's
// rich-text content WITHOUT opening the full editor and without the
// caller round-tripping the entire document through editTask/description
// — this is deliberately its own narrow action, not a call to editTask,
// for two reasons documented in this feature's handoff:
//
//   1. editTask's `updates.description` is the LEGACY plain-text column
//      (AS-054's original contract) — there is no field on
//      `EditTaskUpdates` for description_json at all, and adding one
//      would reopen the "which column is the source of truth" question
//      20260822090000_task_description_json.sql's header comment
//      explicitly deferred to a later feature. This action writes
//      `description_json` ONLY, leaving `description` untouched, which is
//      exactly the shape
//      20260822130000_task_description_json_direct_write.sql's trigger
//      condition (`description_json` changed, `description` did not)
//      detects to keep the direct write instead of overwriting it back
//      from the legacy column.
//   2. Concurrency: re-fetching the CURRENT description_json here (not
//      trusting whatever stale copy the client had open) and writing back
//      a full-document copy with only the target node's `checked` flipped
//      is a deliberate, documented last-write-wins tradeoff — two
//      concurrent toggles of DIFFERENT checkboxes on the same task within
//      the same read-modify-write window can still race (the second
//      write's read predates the first write's commit), overwriting one
//      of the two toggles. This is accepted as the simpler option (no new
//      dependency, no optimistic-concurrency version column, no second
//      source of truth) per this feature's clarified ambiguity-resolution
//      answer — see the handoff's Decisions Made for the full rationale,
//      including why this differs from F153's structured checklist (whose
//      items are separate rows, so concurrent toggles of different items
//      never collide at the row level).
// W11: migrated onto withAuthz — see deleteTaskImpl above and
// lib/actions/authz.ts's doc comment. Uses `canEditTask` (via
// `writeCheck`), not the default `canWrite` — same narrower gate
// editTask itself uses, since this is a write to the same row.
const toggleDescriptionChecklistItemImpl = withAuthz(
  toggleDescriptionChecklistItemSchema,
  {
    requireWrite: true,
    writeCheck: canEditTask,
    membershipError: "You don't have permission to edit this task.",
    writeError: "Viewers don't have permission to edit tasks.",
    requireVisibility: true,
    visibilityError: "Viewers don't have permission to edit tasks.",
    // Same task lookup as editTask above — this action is a narrower
    // write to the same row, so it is permission-checked identically
    // (AS-061: any active member, no ownership restriction; viewers/
    // guests cannot edit, mirroring editTask's own gate).
    // `description_json` is threaded through as `extra` so the handler
    // doesn't need a second query.
    resolveWorkspace: async (input, admin) => {
      const { data: taskRow, error } = await admin
        .from("tasks")
        .select(
          "id, deleted_at, description_json, projects!inner(id, workspace_id, visibility)",
        )
        .eq("id", input.taskId)
        .is("deleted_at", null)
        .maybeSingle();

      if (error || !taskRow) return { ok: false, error: "Task not found." };

      const project = Array.isArray(taskRow.projects)
        ? taskRow.projects[0]
        : taskRow.projects;

      if (!project?.workspace_id) return { ok: false, error: "Task not found." };

      return {
        ok: true,
        workspaceId: project.workspace_id,
        projectId: project.id,
        visibility: (project.visibility as ProjectVisibility) ?? "workspace",
        extra: {
          descriptionJson: taskRow.description_json as JSONContent | null,
        },
      };
    },
  },
  async (input, ctx): Promise<ToggleDescriptionChecklistItemResult> => {
    const currentDoc = ctx.descriptionJson ?? {
      type: "doc",
      content: [],
    };

    const updatedDoc = setTaskItemChecked(
      currentDoc,
      input.itemId,
      input.checked,
    );

    if (!updatedDoc) {
      return {
        ok: false,
        error:
          "This checklist item no longer exists. Reload the task to see the latest description.",
      };
    }

    const { data: updated, error: updateError } = await ctx.admin
      .from("tasks")
      // Only description_json is written — description is deliberately
      // absent from this payload (see this function's doc comment, point 1
      // above).
      .update({ description_json: updatedDoc })
      .eq("id", input.taskId)
      .select("description_json")
      .single();

    if (updateError || !updated) {
      logger.error("toggleDescriptionChecklistItem: update failed", { error: updateError });
      return {
        ok: false,
        error: "Something went wrong. Please try again in a moment.",
      };
    }

    const { data: workspaceRow } = await ctx.admin
      .from("workspaces")
      .select("slug")
      .eq("id", ctx.workspaceId)
      .maybeSingle();

    if (workspaceRow?.slug) {
      try {
        revalidatePath(`/w/${workspaceRow.slug}`, "layout");
      } catch (revalidateError) {
        console.warn(
          "toggleDescriptionChecklistItem: revalidatePath failed (non-fatal):",
          revalidateError,
        );
      }
    }

    return {
      ok: true,
      data: { descriptionJson: updated.description_json as JSONContent },
    };
  },
);

export async function toggleDescriptionChecklistItem(
  taskId: string,
  itemId: string,
  checked: boolean,
): Promise<ToggleDescriptionChecklistItemResult> {
  return toggleDescriptionChecklistItemImpl({ taskId, itemId, checked });
}

export type DuplicateTaskResult =
  | {
      ok: true;
      data: {
        id: string;
        projectId: string;
        title: string;
        status: string;
        position: number;
        number: number;
      };
    }
  | { ok: false; error: string };

// Duplicates a task (F180: AS-324, AS-325, AS-326, AS-327). Reuses F176's
// `cloneTaskFields` (lib/recurrence/clone-fields.ts) verbatim for the
// title/description/description_json/assignees/priority/checklist/estimate
// copy rules, per this feature's own spec ("reusing F176's clone-fields
// allow-list so copy rules exist in exactly one place") — this function
// does NOT re-derive which fields are copied vs excluded; it only adds the
// two things `cloneTaskFields` deliberately has no I/O to do itself: `tags`
// (a plain column copy, not part of the recurrence allow-list — recurrence
// occurrences don't carry tags forward, but a duplicate explicitly should
// per AS-325) and the actual database writes (new task row + checklist
// items + task_assignees rows), including generating the new task's own
// key/number via the SAME atomic mechanism (F145's `assign_task_key`
// trigger, which fires on any `tasks` insert that doesn't supply `number`)
// every other task-creation path in this file already relies on — never a
// manually computed number.
//
// Title marking (Clarified implementation's one open question, resolved
// per the clarification's "take the simpler option, record it"): "Copy of
// <original title>" — matches this mission's project-duplication feature's
// own convention (see that feature's handoff) so both duplication features
// share one convention rather than inventing two.
//
// Same project, same status (AS-327): the duplicate is never re-parented
// to a different project/status — both are read straight from the source
// row and never accepted as caller input (duplicateTaskSchema takes only
// `taskId`).
//
// Position (AS-327): "positioned right after the original" is computed via
// the same lib/board/position.ts `calculatePosition` every other
// reposition path in this codebase (board drag-and-drop) already uses —
// the source task's own position is the `prevPosition` neighbor, and the
// source's current next sibling in that (project, status) column (by
// position ascending) is the `nextPosition` neighbor, so the new row's
// position always lands strictly between the two (or after the source with
// the boundary gap, if the source was already last in its column).
//
// Excluded (AS-326, per cloneTaskFields's own contract): comments,
// attachments, logged time entries are never read from the source task at
// all — this function has no query against `comments`/`attachments`/
// `time_entries` for the source. The new task's key/number is freshly
// assigned by the DB trigger, never copied from the source row.
type DuplicateTaskSourceRow = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  description_json: Json | null;
  status: string;
  priority: "urgent" | "high" | "medium" | "low" | "backlog" | null;
  tags: string[] | null;
  position: number;
  estimate_minutes: number | null;
};

// W11: migrated onto withAuthz — see deleteTaskImpl above and
// lib/actions/authz.ts's doc comment. The source row is threaded through
// as `extra` so the handler doesn't need a second query for it.
const duplicateTaskImpl = withAuthz(
  duplicateTaskSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to duplicate this task.",
    // Same gate createTask/editTask use: viewers/guests are read-only
    // (AS-216/AS-217) — duplicating a task creates a new one, so it's a
    // write, gated the same way createTask's own write is.
    writeError: "Viewers don't have permission to duplicate tasks.",
    requireVisibility: true,
    visibilityError: "Viewers don't have permission to duplicate tasks.",
    resolveWorkspace: async (input, admin) => {
      const { data: sourceRow, error } = await admin
        .from("tasks")
        .select(
          "id, project_id, title, description, description_json, status, priority, tags, position, estimate_minutes, deleted_at, projects(workspace_id, visibility)",
        )
        .eq("id", input.taskId)
        .is("deleted_at", null)
        .maybeSingle();

      if (error || !sourceRow) return { ok: false, error: "Task not found." };

      const project = sourceRow.projects as
        | { workspace_id: string; visibility: string | null }
        | { workspace_id: string; visibility: string | null }[]
        | null;
      const projectRow = Array.isArray(project) ? project[0] : project;

      if (!projectRow?.workspace_id) return { ok: false, error: "Task not found." };

      return {
        ok: true,
        workspaceId: projectRow.workspace_id,
        // F322 (AS-227, AS-228): uses `sourceRow.project_id` (already
        // selected as a top-level column) rather than the embedded
        // `projects` row's own id, which isn't selected here.
        projectId: sourceRow.project_id,
        visibility:
          (projectRow?.visibility as ProjectVisibility) ?? "workspace",
        extra: { sourceRow: sourceRow as unknown as DuplicateTaskSourceRow },
      };
    },
  },
  async (input, ctx): Promise<DuplicateTaskResult> => {
    const sourceRow = ctx.sourceRow;

    const [assigneesResult, checklistResult] = await Promise.all([
      ctx.admin
        .from("task_assignees")
        .select("user_id, created_at")
        .eq("task_id", input.taskId)
        .order("created_at", { ascending: true }),
      ctx.admin
        .from("checklist_items")
        .select("content, position")
        .eq("task_id", input.taskId)
        .order("position", { ascending: true }),
    ]);

    const cloned = cloneTaskFields({
      title: sourceRow.title,
      description: sourceRow.description,
      description_json: sourceRow.description_json,
      assigneeIds: (assigneesResult.data ?? []).map((row) => row.user_id as string),
      priority: sourceRow.priority,
      checklistItems: (checklistResult.data ?? []).map((row) => ({
        content: row.content as string,
        position: row.position as number,
      })),
      estimate_minutes: sourceRow.estimate_minutes,
    });

    // AS-327: land in the SAME status as the original, never the
    // recurrence allow-list's "todo" reset — cloneTaskFields.status is
    // deliberately ignored here (that reset is specific to recurring
    // occurrences, not duplication), and the source's own current status
    // is used instead.
    const targetStatus = sourceRow.status;

    // AS-327: positioned right after the original in its current column.
    // The source's own position is the previous-sibling anchor; its
    // current next sibling by position (same project + status column) is
    // the next-sibling anchor.
    const { data: nextSibling } = await ctx.admin
      .from("tasks")
      .select("position")
      .eq("project_id", sourceRow.project_id)
      .eq("status", targetStatus)
      .is("deleted_at", null)
      .gt("position", sourceRow.position)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();

    const newPosition = calculatePosition(
      sourceRow.position,
      nextSibling?.position ?? null,
    );

    const { data: inserted, error: insertError } = await ctx.admin
      .from("tasks")
      .insert({
        project_id: sourceRow.project_id,
        // AS-324: the duplicate's title is distinctly marked, never an
        // exact copy of the source's title.
        title: `Copy of ${cloned.title}`,
        description: cloned.description,
        description_json: cloned.description_json as Json,
        status: targetStatus,
        priority: cloned.priority,
        tags: sourceRow.tags ?? [],
        estimate_minutes: cloned.estimate_minutes,
        author_id: ctx.user.id,
        position: newPosition,
        // No `number`/key supplied: F145's assign_task_key trigger assigns
        // this new row its OWN project-sequential number on insert, exactly
        // like every other task-creation path in this file
        // (createTaskForUser above never supplies one either) — never
        // copied from the source.
      })
      .select("id, project_id, title, status, position, number")
      .single();

    if (insertError || !inserted) {
      logger.error("duplicateTask: insert failed", { error: insertError });
      return {
        ok: false,
        error: "Something went wrong. Please try again in a moment.",
      };
    }

    // Atomicity fix (W7b): checklist items and assignees are copied inside
    // a single database transaction via RPC. Previously these were two
    // independent inserts whose failures were only logged, leaving an
    // orphan task on the board with a missing checklist and/or assignees
    // while the caller still saw ok:true. If the RPC fails, the newly-
    // inserted task is rolled back too, so the caller never sees a
    // partially-duplicated task.
    if (cloned.checklistItems.length > 0 || cloned.assigneeIds.length > 0) {
      const { error: atomicError } = await ctx.admin.rpc(
        "duplicate_task_atomic",
        { p_source_task_id: input.taskId, p_new_task_id: inserted.id },
      );
      if (atomicError) {
        logger.error("duplicateTask: duplicate_task_atomic failed", { error: atomicError });
        // Roll back the task insert too — don't leave a task with no
        // checklist/assignees.
        await ctx.admin.from("tasks").delete().eq("id", inserted.id);
        return {
          ok: false,
          error: "Something went wrong. Please try again in a moment.",
        };
      }

      if (cloned.assigneeIds.length > 0) {
        await syncMirrorAssigneeId(ctx.admin, inserted.id);

        // F306 (D9/FU-3 scrutiny fix, AS-380): the duplicate carries over
        // the source's assignees but never notified them — routed through
        // the same shared helpers every other fan-out call site uses. Like
        // createTaskForUser above, this is a creation, not a *change*, so
        // no task_activity entry is written for it, only the notification.
        // Non-fatal.
        try {
          const computedRecipients = computeFanoutRecipients({
            type: "assigned",
            actorId: ctx.user.id,
            assigneeIds: cloned.assigneeIds,
          });
          const recipients = await filterRecipientsByInAppPreference(
            ctx.admin,
            computedRecipients ?? [],
          );
          for (const recipient of recipients ?? []) {
            await createNotification(
              ctx.supabase,
              {
                userId: recipient.userId,
                workspaceId: ctx.workspaceId,
                kind: recipient.kind,
                taskId: inserted.id,
              },
              "duplicateTask",
            );
          }
        } catch (fanoutError) {
          logger.error("duplicateTask: notification fan-out failed (non-fatal)", { error: fanoutError });
        }
      }
    }

    const { data: workspaceRow } = await ctx.admin
      .from("workspaces")
      .select("slug")
      .eq("id", ctx.workspaceId)
      .maybeSingle();

    if (workspaceRow?.slug) {
      try {
        revalidatePath(`/w/${workspaceRow.slug}`, "layout");
      } catch (revalidateError) {
        // Non-fatal cache-freshness rationale, same as createTask above.
        logger.error("duplicateTask: revalidatePath failed (non-fatal)", { error: revalidateError });
      }
    }

    return {
      ok: true,
      data: {
        id: inserted.id,
        projectId: inserted.project_id,
        title: inserted.title,
        status: inserted.status,
        position: inserted.position,
        number: inserted.number,
      },
    };
  },
);

export async function duplicateTask(
  taskId: string,
): Promise<DuplicateTaskResult> {
  return duplicateTaskImpl({ taskId });
}

// ---------------------------------------------------------------------
// F186 (AS-337, AS-338, AS-341): bulk field updates from the list view's
// multi-select (F185's <TaskListTable> row checkboxes + <BulkActionBar>).
// ---------------------------------------------------------------------

export type BulkUpdateTasksResult =
  | {
      ok: true;
      data: {
        // Ids the update actually applied to. AS-337/AS-338's "N tasks all
        // get updated via one call" is proven by this list matching the
        // caller-permitted subset of the input, not by every input id
        // necessarily appearing here.
        succeededIds: string[];
        // AS-341: a task the caller isn't authorized to edit (not found,
        // soft-deleted, or in a private project they have no access to)
        // is excluded from the update and reported here with a reason —
        // it does NOT fail the whole batch. Every OTHER selected task the
        // caller can edit still succeeds in the same call. This is the
        // clarification's resolved answer to "does one forbidden task
        // fail the whole batch, or just itself": just itself. See this
        // feature's handoff Decisions Made for the full rationale.
        failedIds: { id: string; reason: string }[];
      };
    }
  | { ok: false; error: string };

type BulkTaskAuthContext = {
  workspaceId: string;
  projectId: string;
  visibility: ProjectVisibility;
};

// Loads (id -> {workspaceId, projectId, visibility}) for every requested
// task id in one query, excluding soft-deleted rows outright (a
// soft-deleted task is treated identically to "not found" everywhere else
// in this file — deleteTask's own doc comment). One round trip regardless
// of how many ids were requested, matching this feature's Clarified
// performance-budget answer ("never a per-row loop of network calls").
async function loadBulkTaskAuthContexts(
  admin: ReturnType<typeof createAdminClient>,
  taskIds: string[],
): Promise<Map<string, BulkTaskAuthContext>> {
  const { data: rows } = await admin
    .from("tasks")
    .select("id, deleted_at, projects!inner(id, workspace_id, visibility)")
    .in("id", taskIds)
    .is("deleted_at", null);

  const contexts = new Map<string, BulkTaskAuthContext>();
  for (const row of rows ?? []) {
    const project = Array.isArray(row.projects)
      ? row.projects[0]
      : row.projects;
    if (!project?.workspace_id) continue;
    contexts.set(row.id, {
      workspaceId: project.workspace_id,
      projectId: project.id,
      visibility: (project.visibility as ProjectVisibility) ?? "workspace",
    });
  }
  return contexts;
}

// Bulk-updates status/assigneeId/priority/dueDate on a caller-supplied set
// of tasks in a single UPDATE statement, per this feature's Clarified
// performance-budget answer ("one statement ... never a per-row loop of
// network calls"). Every task in the input list gets its OWN
// authorization check (AS-341) — some selected tasks may belong to a
// private project the caller has no access to even though they're an
// active member of the same workspace as other, permitted tasks in the
// same call (mirrors AS-290's exact scenario for assignee candidates,
// re-implemented here the same way: `is_project_visible_to`'s rule,
// re-checked in application code because this action uses the admin
// client, which bypasses RLS by design — see loadTaskAssignContext's
// sibling doc comment above).
//
// AS-341's resolved behaviour: a forbidden task is excluded from the
// UPDATE and reported in `failedIds`; it never fails the whole batch —
// every other, permitted task in the same call still succeeds. This
// mirrors this codebase's own precedent for "some items in a batch are
// invalid" (setTaskAssigneesCore is the one exception, by contrast,
// because assignment there is a single task's own field, not a
// cross-task batch — there is no batch to partially fail).
//
// Blocked-task confirmation (F158): per this feature's own draft scope,
// resolved BEFORE this action is called, once for the whole selection —
// this server action does not call getOpenBlockers/isDoneStatus itself.
// The list view's bulk status control (components/task/
// task-list-table.tsx) is responsible for calling
// useBlockedDoneGuard().confirmIfMovingToDone for each task in the
// selection (skipping ones the user cancels) and passing only the
// confirmed ids through to this action, exactly as F158's own doc
// comment on useBlockedDoneGuard anticipates.
//
// assigneeId (AS-338): writes ONLY the deprecated `tasks.assignee_id`
// single-assignee mirror column, not `task_assignees` (F160's
// multi-assignee table). Routing a bulk call through
// setTaskAssigneesCore per task would be a per-row loop of network calls
// (diff-then-write per task), which this feature's performance budget
// explicitly forbids; writing the mirror column directly keeps the whole
// operation a single statement. This means a bulk assignee change
// replaces a task's single mirrored assignee but does not touch any
// OTHER existing multi-assignee rows that task might already have via
// `task_assignees` — see this feature's handoff Out-of-scope note.
export async function bulkUpdateTasks(
  taskIds: string[],
  updates: BulkUpdateTasksUpdates,
): Promise<BulkUpdateTasksResult> {
  const parsed = bulkUpdateTasksSchema.safeParse({ taskIds, updates });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid bulk update.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to update tasks." };
  }

  const admin = createAdminClient();
  const contexts = await loadBulkTaskAuthContexts(admin, parsed.data.taskIds);

  const failedIds: { id: string; reason: string }[] = [];
  for (const id of parsed.data.taskIds) {
    if (!contexts.has(id)) {
      failedIds.push({ id, reason: "Task not found." });
    }
  }

  // One membership check per distinct workspace touched by this call
  // (typically one — the list view a selection is made from is always
  // scoped to a single project/workspace — but this does not assume
  // that), never per task (AS-341's performance budget).
  const distinctWorkspaceIds = new Set(
    [...contexts.values()].map((c) => c.workspaceId),
  );
  const roleByWorkspace = new Map<string, WorkspaceRole>();
  for (const workspaceId of distinctWorkspaceIds) {
    const membership = await requireActiveMembership(
      admin,
      workspaceId,
      user.id,
    );
    if (membership.ok) {
      roleByWorkspace.set(workspaceId, membership.role);
    }
  }

  // Private-project visibility (AS-290's rule, re-applied here): only
  // needed for tasks whose project is actually private — one extra query
  // covering every such project in this call, not one per task.
  const privateProjectIds = new Set(
    [...contexts.values()]
      .filter((c) => c.visibility === "private")
      .map((c) => c.projectId),
  );
  const explicitMemberProjectIds = new Set<string>();
  if (privateProjectIds.size > 0) {
    const { data: memberRows } = await admin
      .from("project_members")
      .select("project_id")
      .in("project_id", [...privateProjectIds])
      .eq("user_id", user.id);
    for (const row of memberRows ?? []) {
      explicitMemberProjectIds.add(row.project_id as string);
    }
  }

  const allowedIds: string[] = [];
  for (const [id, context] of contexts) {
    const role = roleByWorkspace.get(context.workspaceId);
    if (!role) {
      failedIds.push({ id, reason: "You are not a member of this workspace." });
      continue;
    }
    if (!canEditTask({ role })) {
      failedIds.push({
        id,
        reason: "You don't have permission to edit this task.",
      });
      continue;
    }
    if (
      context.visibility === "private" &&
      role !== "owner" &&
      role !== "admin" &&
      !explicitMemberProjectIds.has(context.projectId)
    ) {
      failedIds.push({
        id,
        reason: "You don't have access to this task's project.",
      });
      continue;
    }
    allowedIds.push(id);
  }

  if (allowedIds.length === 0) {
    return { ok: true, data: { succeededIds: [], failedIds } };
  }

  // Build the update payload from only the fields present in `updates` —
  // same "only present fields are applied" convention as editTask.
  const updatePayload: {
    status?: "todo" | "in_progress" | "in_review" | "done";
    assignee_id?: string | null;
    priority?: "urgent" | "high" | "medium" | "low" | "backlog" | null;
    due_date?: string | null;
  } = {};
  if ("status" in parsed.data.updates) {
    updatePayload.status = parsed.data.updates.status;
  }
  if ("assigneeId" in parsed.data.updates) {
    updatePayload.assignee_id = parsed.data.updates.assigneeId;
  }
  if ("priority" in parsed.data.updates) {
    updatePayload.priority = parsed.data.updates.priority;
  }
  if ("dueDate" in parsed.data.updates) {
    updatePayload.due_date = parsed.data.updates.dueDate;
  }

  // F195 (AS-354, AS-355): "before" snapshot of every allowed task's
  // diffable fields, read in ONE query covering the whole batch (not a
  // per-task query) — the per-task activity entries below are diffed
  // against this, matching this feature's clarified "one entry per task,
  // not one per batch" resolution (see the handoff's Decisions Made).
  const { data: beforeRows } = await admin
    .from("tasks")
    .select("id, status, assignee_id, priority, due_date")
    .in("id", allowedIds);
  const beforeById = new Map(
    (beforeRows ?? []).map((row) => [row.id as string, row]),
  );

  // The one real write: a single `UPDATE ... WHERE id = ANY(allowedIds)`
  // statement, per this feature's Clarified performance-budget answer.
  const { data: updatedRows, error: updateError } = await admin
    .from("tasks")
    .update(updatePayload)
    .in("id", allowedIds)
    .select("id, status, assignee_id, priority, due_date");

  if (updateError) {
    logger.error("bulkUpdateTasks: update failed", { error: updateError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const succeededIds = (updatedRows ?? []).map((row) => row.id as string);

  // F195 (AS-354, AS-355): one task_activity entry per changed field, PER
  // TASK — each task in this bulk update gets its own diffed entries, not
  // one collapsed entry for the whole batch (this feature's clarified
  // ambiguity resolution). Non-fatal: the bulk update itself already
  // succeeded above.
  try {
    for (const row of updatedRows ?? []) {
      const before = beforeById.get(row.id as string);
      if (!before) continue;
      const changes = diffTaskFields(
        {
          status: before.status,
          assignee_id: before.assignee_id,
          priority: before.priority,
          due_date: before.due_date,
        },
        {
          status: row.status,
          assignee_id: row.assignee_id,
          priority: row.priority,
          due_date: row.due_date,
        },
      );
      await writeTaskFieldChanges(supabase, row.id as string, changes);
    }
  } catch (activityError) {
    logger.error("bulkUpdateTasks: writeTaskFieldChanges failed (non-fatal)", { error: activityError });
  }

  // F306 (D9/FU-3 scrutiny fix, AS-294, AS-380, AS-382): fan out
  // notifications for every task in this batch whose status or assignee
  // actually changed. Watchers are read in ONE batched query covering
  // every status-changed task (not one query per task), matching this
  // action's own "batch, don't loop network calls per row" convention
  // used above for the before/after snapshot reads. `createNotification`
  // itself is still called once per (task, recipient) pair — the same
  // "one RPC call per affected row" the single-task paths and this
  // feature's own bulk-performance guidance accept as reasonable, since
  // there is no bulk variant of `create_notification`/
  // `filterRecipientsByInAppPreference` to route through instead. Non-
  // fatal: the bulk update itself already succeeded above.
  try {
    const statusChangedIds = (updatedRows ?? [])
      .filter((row) => {
        const before = beforeById.get(row.id as string);
        return before && before.status !== row.status;
      })
      .map((row) => row.id as string);

    const watchersByTask = new Map<string, string[]>();
    if (statusChangedIds.length > 0) {
      const { data: watcherRows } = await admin
        .from("task_watchers")
        .select("task_id, user_id")
        .in("task_id", statusChangedIds)
        .eq("is_watching", true);
      for (const row of watcherRows ?? []) {
        const list = watchersByTask.get(row.task_id as string) ?? [];
        list.push(row.user_id as string);
        watchersByTask.set(row.task_id as string, list);
      }
    }

    for (const taskId of statusChangedIds) {
      const context = contexts.get(taskId);
      if (!context) continue;
      const computedRecipients = computeFanoutRecipients({
        type: "status_changed",
        actorId: user.id,
        watcherIds: watchersByTask.get(taskId) ?? [],
      });
      const recipients = await filterRecipientsByInAppPreference(
        admin,
        computedRecipients ?? [],
      );
      for (const recipient of recipients ?? []) {
        await createNotification(
          supabase,
          {
            userId: recipient.userId,
            workspaceId: context.workspaceId,
            kind: recipient.kind,
            taskId,
          },
          "bulkUpdateTasks",
        );
      }
    }

    const assigneeChangedRows = (updatedRows ?? [])
      .map((row) => {
        const before = beforeById.get(row.id as string);
        return {
          id: row.id as string,
          assigneeId: row.assignee_id as string | null,
          changed: Boolean(
            before && before.assignee_id !== row.assignee_id,
          ),
        };
      })
      .filter((row) => row.changed && row.assigneeId);

    for (const row of assigneeChangedRows) {
      const context = contexts.get(row.id);
      if (!context || !row.assigneeId) continue;
      const computedRecipients = computeFanoutRecipients({
        type: "assigned",
        actorId: user.id,
        assigneeIds: [row.assigneeId],
      });
      const recipients = await filterRecipientsByInAppPreference(
        admin,
        computedRecipients ?? [],
      );
      for (const recipient of recipients ?? []) {
        await createNotification(
          supabase,
          {
            userId: recipient.userId,
            workspaceId: context.workspaceId,
            kind: recipient.kind,
            taskId: row.id,
          },
          "bulkUpdateTasks",
        );
      }
    }
  } catch (fanoutError) {
    logger.error("bulkUpdateTasks: notification fan-out failed (non-fatal)", { error: fanoutError });
  }

  for (const workspaceId of distinctWorkspaceIds) {
    if (!roleByWorkspace.has(workspaceId)) continue;
    await revalidateWorkspaceForTaskAssignment(
      admin,
      workspaceId,
      "bulkUpdateTasks",
    );
  }

  return { ok: true, data: { succeededIds, failedIds } };
}

// ---------------------------------------------------------------------
// F187 (AS-339, AS-340): bulk soft-delete from the list view's multi-select
// (F185's <TaskListTable> row checkboxes + <BulkActionBar>). Sibling action
// to bulkUpdateTasks above — same shape, same per-task authorization
// pattern (loadBulkTaskAuthContexts, one membership check per distinct
// workspace, one extra project_members query covering every private
// project in the call), same "a forbidden task is excluded and reported,
// never fails the whole batch" resolution (AS-340 is this feature's
// version of AS-341's precedent — see this feature's handoff Decisions
// Made for why this deliberately reuses that exact pattern rather than
// inventing a new one).
// ---------------------------------------------------------------------

export type BulkDeleteTasksResult =
  | {
      ok: true;
      data: {
        // Ids actually soft-deleted (deleted_at set). AS-339's "N tasks
        // all get deleted via one action" is proven by this list matching
        // the caller-permitted subset of the input, not by every input id
        // necessarily appearing here.
        succeededIds: string[];
        // AS-340: a task the caller isn't authorized to delete (not
        // found, already soft-deleted, or in a private project they have
        // no access to) is excluded from the delete and reported here —
        // it does NOT fail the whole batch. Every other, permitted task
        // in the same call is still deleted. The UI (bulk-delete-action.tsx)
        // resolves these ids to "PROJECTKEY-number" via formatTaskKey
        // before showing them to the user — never a raw uuid.
        failedIds: { id: string; reason: string }[];
      };
    }
  | { ok: false; error: string };

// This is a SOFT delete only — sets `deleted_at`, never issues a real
// DELETE, exactly matching deleteTask's existing single-task convention
// (see that function's doc comment above) and this feature's own
// Clarified-implementation instruction (confirmation copy must say
// "trash", not "delete forever").
//
// AS-267 cascade parity (F149): deleteTask cascades to a task's live
// children via the single-task `cascade_delete_task` RPC (one atomic
// transaction). This action deliberately does NOT call that RPC per
// selected task — doing so would be a per-row loop of network calls,
// which this feature's Clarified performance-budget answer explicitly
// forbids ("never a per-row loop of network calls"). Instead, cascading
// to children of every deleted task in this call is done as a SECOND
// batch UPDATE (`parent_task_id = ANY(allowedIds)`), covering every
// affected child in one statement regardless of how many parents were in
// the selection — two statements total for the whole call, not two per
// task. This is not wrapped in a single database transaction the way
// cascade_delete_task's PL/pgSQL body is (no new migration/RPC is in this
// feature's Files scope — see the handoff's Out-of-scope section), so a
// crash between the two UPDATEs is a narrower window than the equivalent
// risk cascade_delete_task's own doc comment describes for the
// single-task path, but is not fully eliminated here; flagged in the
// handoff rather than silently left undocumented.
export async function bulkDeleteTasks(
  taskIds: string[],
): Promise<BulkDeleteTasksResult> {
  const parsed = bulkDeleteTasksSchema.safeParse({ taskIds });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid bulk delete.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to delete tasks." };
  }

  const admin = createAdminClient();
  const contexts = await loadBulkTaskAuthContexts(admin, parsed.data.taskIds);

  const failedIds: { id: string; reason: string }[] = [];
  for (const id of parsed.data.taskIds) {
    if (!contexts.has(id)) {
      failedIds.push({ id, reason: "Task not found." });
    }
  }

  // One membership check per distinct workspace touched by this call,
  // never per task (same performance-budget rationale as
  // bulkUpdateTasks).
  const distinctWorkspaceIds = new Set(
    [...contexts.values()].map((c) => c.workspaceId),
  );
  const roleByWorkspace = new Map<string, WorkspaceRole>();
  for (const workspaceId of distinctWorkspaceIds) {
    const membership = await requireActiveMembership(
      admin,
      workspaceId,
      user.id,
    );
    if (membership.ok) {
      roleByWorkspace.set(workspaceId, membership.role);
    }
  }

  // Private-project visibility (AS-290's rule, re-applied here exactly as
  // bulkUpdateTasks does): one extra query covering every private project
  // touched by this call, not one per task.
  const privateProjectIds = new Set(
    [...contexts.values()]
      .filter((c) => c.visibility === "private")
      .map((c) => c.projectId),
  );
  const explicitMemberProjectIds = new Set<string>();
  if (privateProjectIds.size > 0) {
    const { data: memberRows } = await admin
      .from("project_members")
      .select("project_id")
      .in("project_id", [...privateProjectIds])
      .eq("user_id", user.id);
    for (const row of memberRows ?? []) {
      explicitMemberProjectIds.add(row.project_id as string);
    }
  }

  const allowedIds: string[] = [];
  for (const [id, context] of contexts) {
    const role = roleByWorkspace.get(context.workspaceId);
    if (!role) {
      failedIds.push({ id, reason: "You are not a member of this workspace." });
      continue;
    }
    // AS-055/F128 (AS-216, AS-217): viewers are read-only — deliberately
    // `canWrite`, not `canEditTask`, matching deleteTask's own permission
    // gate above exactly (delete has no per-task ownership restriction,
    // only "not a viewer").
    if (!canWrite({ role })) {
      failedIds.push({
        id,
        reason: "You don't have permission to delete this task.",
      });
      continue;
    }
    if (
      context.visibility === "private" &&
      role !== "owner" &&
      role !== "admin" &&
      !explicitMemberProjectIds.has(context.projectId)
    ) {
      failedIds.push({
        id,
        reason: "You don't have access to this task's project.",
      });
      continue;
    }
    allowedIds.push(id);
  }

  if (allowedIds.length === 0) {
    return { ok: true, data: { succeededIds: [], failedIds } };
  }

  const deletedAt = new Date().toISOString();

  // The soft-delete of the requested tasks and the cascade soft-delete of
  // their direct children now happen atomically inside a single RPC
  // (F188/AS-347, AS-267 cascade parity), so a mid-sequence failure can
  // never leave children visible on the board under a now-deleted parent.
  const { data: rpcDeletedIds, error: rpcError } = await admin.rpc(
    "bulk_delete_tasks_atomic",
    {
      p_task_ids: allowedIds,
      p_deleted_by: user.id,
      p_deleted_at: deletedAt,
    },
  );

  if (rpcError) {
    logger.error("bulkDeleteTasks: bulk_delete_tasks_atomic failed", { error: rpcError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const succeededIds = (rpcDeletedIds as string[] | null) ?? [];

  for (const workspaceId of distinctWorkspaceIds) {
    if (!roleByWorkspace.has(workspaceId)) continue;
    await revalidateWorkspaceForTaskAssignment(
      admin,
      workspaceId,
      "bulkDeleteTasks",
    );
  }

  return { ok: true, data: { succeededIds, failedIds } };
}

export type BulkRestoreTasksResult =
  | {
      ok: true;
      data: {
        succeededIds: string[];
        failedIds: { id: string; reason: string }[];
      };
    }
  | { ok: false; error: string };

// Restores a batch of soft-deleted tasks in a single Server Action call
// (F190/AS-345: "Bulk deletes undo the whole batch in one call" — the
// requirement is that the CLIENT makes one call, not a per-row loop of
// its own; it does not require a brand-new batch-UPDATE SQL statement).
//
// Per this feature's own Clarified "ambiguity resolution" default (take
// the simpler option that adds no new dependency and no second source of
// truth), this delegates to the existing, already-correct `restoreTask`
// per id rather than re-implementing restoreTask's position recompute,
// status-fallback, and cascade-children-restore logic a second time as a
// parallel batch code path — that logic is intricate (see restoreTask's
// own doc comment above) and duplicating it here would create exactly the
// "second source of truth" divergence risk the clarified default says to
// avoid. The calls run concurrently (Promise.all) so the batch completes
// in one round trip's worth of wall-clock time from the caller's
// perspective, matching this feature's UI contract of "one Undo click
// restores the whole batch."
//
// Each id's outcome is independent — one task failing (already restored
// by someone else, no longer found, permission revoked mid-flight) does
// not fail the rest of the batch, mirroring bulkDeleteTasks's own
// succeededIds/failedIds contract exactly.
export async function bulkRestoreTasks(
  taskIds: string[],
): Promise<BulkRestoreTasksResult> {
  const parsed = bulkDeleteTasksSchema.safeParse({ taskIds });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid bulk restore.",
    };
  }

  const results = await Promise.all(
    parsed.data.taskIds.map(async (id) => {
      const result = await restoreTask(id);
      return { id, result };
    }),
  );

  const succeededIds: string[] = [];
  const failedIds: { id: string; reason: string }[] = [];
  for (const { id, result } of results) {
    if (result.ok) {
      succeededIds.push(id);
    } else {
      failedIds.push({ id, reason: result.error });
    }
  }

  return { ok: true, data: { succeededIds, failedIds } };
}
