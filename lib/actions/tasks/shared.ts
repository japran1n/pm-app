import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/observability/logger";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import {
  canEditTask,
  type WorkspaceRole,
} from "@/lib/auth/permissions";
import {
  isProjectVisibleToCaller,
  type ProjectVisibility,
} from "@/lib/actions/project-visibility";
import {
  writeTaskFieldChanges,
  type TaskFieldChange,
} from "@/lib/activity/task-activity";
import { computeFanoutRecipients } from "@/lib/notifications/fanout";
import { filterRecipientsByInAppPreference } from "@/lib/notifications/preferences";
import { createNotification } from "@/lib/notifications/create-notification";

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

export type TaskAssignContext = {
  workspaceId: string;
  projectId: string;
  visibility: ProjectVisibility;
};

// Loads task -> project -> workspace context for assignment actions.
// Mirrors the "deleted_at is null, else not found" convention every
// sibling action in this file already uses for its own task lookup.
export async function loadTaskAssignContext(
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
export async function filterProjectVisibleUserIds(
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
export function resolveMirrorAssigneeId(
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
export async function syncMirrorAssigneeId(
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

export type TaskAssigneesData = {
  taskId: string;
  assigneeIds: string[];
  mirrorAssigneeId: string | null;
};

export type TaskAssigneesActionResult =
  | { ok: true; data: TaskAssigneesData }
  | { ok: false; error: string };

// Shared preflight for every multi-assignee action: resolves the caller's
// identity, the task's owning project/workspace (not-found for a missing
// or soft-deleted task), re-verifies workspace membership + edit
// permission server-side (AS-143's defense-in-depth convention, same as
// every sibling action in this file), and hands back the admin client plus
// resolved context so each caller only has to run its own specific write.
export async function requireAssignActionContext(taskId: string): Promise<
  | {
      ok: true;
      admin: ReturnType<typeof createAdminClient>;
      supabase: Awaited<ReturnType<typeof createClient>>;
      userId: string;
      context: TaskAssignContext;
    }
  | { ok: false; error: string }
> {
  const { supabase, user } = await getCurrentUser();

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

export async function revalidateWorkspaceForTaskAssignment(
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
export async function setTaskAssigneesCore(
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

