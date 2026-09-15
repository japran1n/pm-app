"use server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  bulkUpdateTasksSchema,
  bulkDeleteTasksSchema,
  type BulkUpdateTasksUpdates,
} from "@/lib/validation/tasks";
import { logger } from "@/lib/observability/logger";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { canWrite, canEditTask, type WorkspaceRole } from "@/lib/auth/permissions";
import { type ProjectVisibility } from "@/lib/actions/project-visibility";
import {
  diffTaskFields,
  writeTaskFieldChanges,
} from "@/lib/activity/task-activity";
import { computeFanoutRecipients } from "@/lib/notifications/fanout";
import { filterRecipientsByInAppPreference } from "@/lib/notifications/preferences";
import { createNotification } from "@/lib/notifications/create-notification";
import { isDoneStatus } from "@/lib/tasks/blocked-guard";
import { generateNextOccurrence } from "@/lib/recurrence/generate-next-occurrence";
import { getCurrentUserTimezone } from "@/lib/queries/profile";
import { revalidateWorkspaceForTaskAssignment } from "./shared";
import { restoreTask } from "./lifecycle";
import {
  revalidatePortalProject,
  extractWorkspaceSlug,
} from "@/lib/actions/portal-revalidate";
import type { ActionResult } from "@/lib/actions/authz";

// ---------------------------------------------------------------------
// F186 (AS-337, AS-338, AS-341): bulk field updates from the list view's
// multi-select (F185's <TaskListTable> row checkboxes + <BulkActionBar>).
// ---------------------------------------------------------------------

export type BulkUpdateTasksResult = ActionResult<{
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
      }>;

type BulkTaskAuthContext = {
  workspaceId: string;
  projectId: string;
  visibility: ProjectVisibility;
  clientVisible: boolean;
  workspaceSlug?: string;
};

// F004c (AS-006): after a bulk action's writes succeed, revalidate the
// portal layout once per DISTINCT (workspaceSlug, projectId) pair touched
// by any succeeded, client-visible task in this call — never once per
// task, matching this file's own "one statement/call per batch, not a
// per-row loop" performance convention.
function revalidatePortalForBulkContexts(
  contexts: Map<string, BulkTaskAuthContext>,
  succeededIds: string[],
) {
  const seen = new Set<string>();
  for (const id of succeededIds) {
    const context = contexts.get(id);
    if (!context?.clientVisible || !context.workspaceSlug) continue;
    const key = `${context.workspaceSlug}:${context.projectId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    revalidatePortalProject(context.workspaceSlug, context.projectId);
  }
}

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
    .select(
      "id, deleted_at, client_visible, projects!inner(id, workspace_id, visibility, workspaces(slug))",
    )
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
      clientVisible: Boolean(row.client_visible),
      workspaceSlug: extractWorkspaceSlug(
        (project as { workspaces?: { slug: string } | { slug: string }[] })
          .workspaces,
      ),
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

  const { supabase, user } = await getCurrentUser();

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

  // F1 (status-sitemap-audit mission, AS-2): before writing a status
  // change, verify the target name exists in EACH affected task's own
  // project's `project_statuses` — mirrors moveTaskStatus's own existence
  // check (lib/actions/tasks/ordering.ts), which exists because the DB
  // trigger that derives `status_id` from `(project_id, name)`
  // (`sync_task_status_and_status_id`) fails silently (leaves status_id
  // null) for an unmatched name rather than raising. Batched per DISTINCT
  // project id touched by this call (never one query per task) — the
  // target name is the SAME single value for the whole batch (`updates`
  // has one `status` field, not one per task), so the only thing that can
  // vary per task is which project it belongs to.
  const targetStatusName =
    "status" in parsed.data.updates ? parsed.data.updates.status : undefined;
  // projectId -> the matched column's category, only for projects where
  // `targetStatusName` actually exists. A task whose project's id is NOT a
  // key of this map gets excluded below instead of silently orphaning
  // `status_id`.
  const categoryByProjectIdForTargetStatus = new Map<string, string | null>();
  if (targetStatusName !== undefined) {
    const distinctProjectIdsForStatus = new Set(
      allowedIds
        .map((id) => contexts.get(id)?.projectId)
        .filter((id): id is string => Boolean(id)),
    );
    if (distinctProjectIdsForStatus.size > 0) {
      const { data: matchingStatusRows } = await admin
        .from("project_statuses")
        .select("project_id, category")
        .in("project_id", [...distinctProjectIdsForStatus])
        .eq("name", targetStatusName);
      for (const row of matchingStatusRows ?? []) {
        categoryByProjectIdForTargetStatus.set(
          row.project_id as string,
          (row.category as string | null) ?? null,
        );
      }
    }
    for (let i = allowedIds.length - 1; i >= 0; i -= 1) {
      const id = allowedIds[i];
      const context = contexts.get(id);
      if (!context || !categoryByProjectIdForTargetStatus.has(context.projectId)) {
        allowedIds.splice(i, 1);
        failedIds.push({
          id,
          reason: "That status doesn't exist on this task's project.",
        });
      }
    }
  }

  if (allowedIds.length === 0) {
    return { ok: true, data: { succeededIds: [], failedIds } };
  }

  // Build the update payload from only the fields present in `updates` —
  // same "only present fields are applied" convention as editTask.
  const updatePayload: {
    status?: string;
    assignee_id?: string | null;
    priority?: "urgent" | "high" | "medium" | "low" | "backlog" | null;
    due_date?: string | null;
  } = {};
  if (targetStatusName !== undefined) {
    updatePayload.status = targetStatusName;
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
  // F1 (AS-3): the extra columns beyond status/assignee_id/priority/
  // due_date (project_id, title, description, description_json,
  // estimate_minutes, recurrence, recurrence_parent_id, task_type_id) are
  // exactly `SourceTaskForRecurrence`'s shape — selected here, in the SAME
  // round trip as the write itself, so the recurrence side effect below
  // never needs a second per-task fetch.
  const { data: updatedRows, error: updateError } = await admin
    .from("tasks")
    .update(updatePayload)
    .in("id", allowedIds)
    .select(
      "id, status, assignee_id, priority, due_date, project_id, title, description, description_json, estimate_minutes, recurrence, recurrence_parent_id, task_type_id",
    );

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

  // F1 (status-sitemap-audit mission, AS-3): a recurring task that just
  // transitioned into a done-category status generates its next
  // occurrence, exactly like moveTaskStatus does (lib/actions/tasks/
  // ordering.ts) — same helpers (`isDoneStatus` + `generateNextOccurrence`),
  // no reimplementation. Purely additive: a failure or legitimate no-op
  // here never turns the bulk update itself into a failure, and this
  // never blocks/queries per row beyond the one-time timezone lookup
  // below plus one insert per ACTUALLY-recurring task that ACTUALLY moved
  // into a done column (inherent to generating N new task rows, not a
  // violation of this file's "batch, don't loop" convention for its own
  // reads/writes).
  if (targetStatusName !== undefined) {
    try {
      const recurringDoneRows = (updatedRows ?? []).filter((row) => {
        const context = contexts.get(row.id as string);
        if (!context) return false;
        const category = categoryByProjectIdForTargetStatus.get(
          context.projectId,
        );
        return (
          Boolean(row.recurrence) &&
          isDoneStatus(row.status as string, category ?? undefined)
        );
      });

      if (recurringDoneRows.length > 0) {
        const timezone = await getCurrentUserTimezone(supabase);
        for (const row of recurringDoneRows) {
          try {
            await generateNextOccurrence(
              admin,
              {
                id: row.id as string,
                project_id: row.project_id as string,
                title: row.title as string,
                description: row.description as string | null,
                description_json: row.description_json,
                priority: row.priority as string | null,
                estimate_minutes: row.estimate_minutes as number | null,
                due_date: row.due_date as string | null,
                recurrence: row.recurrence,
                recurrence_parent_id: row.recurrence_parent_id as
                  | string
                  | null,
                task_type_id: row.task_type_id as string,
              },
              user.id,
              timezone,
            );
          } catch (recurrenceError) {
            logger.error(
              "bulkUpdateTasks: generateNextOccurrence failed (non-fatal)",
              { error: recurrenceError, taskId: row.id },
            );
          }
        }
      }
    } catch (recurrenceBatchError) {
      logger.error(
        "bulkUpdateTasks: recurrence side effect failed (non-fatal)",
        { error: recurrenceBatchError },
      );
    }
  }

  for (const workspaceId of distinctWorkspaceIds) {
    if (!roleByWorkspace.has(workspaceId)) continue;
    await revalidateWorkspaceForTaskAssignment(
      admin,
      workspaceId,
      "bulkUpdateTasks",
    );
  }

  revalidatePortalForBulkContexts(contexts, succeededIds);

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

export type BulkDeleteTasksResult = ActionResult<{
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
      }>;

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

  const { user } = await getCurrentUser();

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

  revalidatePortalForBulkContexts(contexts, succeededIds);

  return { ok: true, data: { succeededIds, failedIds } };
}

export type BulkRestoreTasksResult = ActionResult<{
        succeededIds: string[];
        failedIds: { id: string; reason: string }[];
      }>;

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

// ---------------------------------------------------------------------
// setTaskBlockedReason — free-text "why is this blocked" reason
// (`tasks.blocked_reason`, 20261115020000_tasks_blocked_reason.sql).
// A dedicated action rather than folding this into `editTask`'s
// `EditTaskUpdates` set: this is a single, narrowly-scoped column shown
// only while the task's own `status` reads "blocked", not a general task
// edit field. Built on `withAuthz` (lib/actions/authz.ts), same
// membership/write/visibility pipeline every other migrated action in
// this file already uses.
// ---------------------------------------------------------------------

