import { logger } from "@/lib/observability/logger";

// Plain (non-"use server") module holding the shared task-creation
// implementation. This file MUST NOT carry a "use server" directive: every
// exported async function inside a "use server" module is auto-registered
// as a client-invocable Server Action endpoint, reachable by any caller who
// can reach the app regardless of whether any UI ever calls it — that is
// exactly the bug fixed here (F334's follow-up, identical class to M17
// scrutiny BLOCKER-3, which fixed the same shape for
// lib/attachments/upload.ts's uploadAttachmentForUser). By living in a
// plain module, `createTaskForUser` is only reachable via a real import,
// not a network-addressable action ID.
//
// Callers:
//   - lib/actions/tasks.ts's `createTask` Server Action, which resolves
//     `userId` itself from the caller's authenticated cookie session
//     (never accepts it as an argument from outside this module).
//   - app/api/extension/tasks/route.ts, which resolves `userId` itself
//     from a verified bearer JWT before calling this function directly
//     (bypassing the Server Action layer entirely, since a Route Handler
//     is already not client-invocable-by-ID the way a Server Action is).
//
// Nothing in this module's exported signature should ever be re-exported,
// wrapped, or aliased from a "use server" file with the same parameter
// shape (a raw, trusted `userId` argument) — doing so reopens this class
// of bug.
import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { createTaskSchema } from "@/lib/validation/tasks";
import { resolveProjectStatusName } from "@/lib/tasks/resolve-status";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { canEditTask } from "@/lib/auth/permissions";
import {
  isProjectVisibleToCaller,
  type ProjectVisibility,
} from "@/lib/actions/project-visibility";
import { calculatePosition } from "@/lib/board/position";
import { computeFanoutRecipients } from "@/lib/notifications/fanout";
import { filterRecipientsByInAppPreference } from "@/lib/notifications/preferences";
import { createNotification } from "@/lib/notifications/create-notification";
import type { Database } from "@/lib/supabase/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CreateTaskResult } from "@/lib/actions/tasks";

// F292 (AS-558, AS-561, AS-562): the shared create-task code path, factored
// out so app/api/extension/tasks/route.ts (the QA feedback extension's
// task-creation endpoint) can create a task through the exact same
// validation/defaults/authorization logic the web app's Server Action
// uses, without a parallel implementation. The only difference between
// callers is *how the caller's identity is resolved* — the web app
// resolves it from the cookie session (createClient().auth.getUser()), the
// extension route resolves it from a bearer JWT
// (supabase.auth.getUser(token)) — both hand this function an already-
// verified userId and nothing else about identity is ever taken from
// caller-supplied input.
//
// `userId` here MUST already be a verified identity resolved by the caller
// from a real session/JWT — this function performs no identity
// verification of its own, by design, so it must never be reachable from a
// context where `userId` could be an unverified, caller-supplied value
// (that is the whole point of moving it out of the "use server" module —
// see this file's header comment).
export async function createTaskForUser(
  userId: string,
  input: {
    projectId: string;
    title: string;
    description?: string | null;
    // F248 (AS-479): `status` is any string naming a project's own board
    // column, not a fixed four-value union — see createTaskSchema's own
    // doc comment in lib/validation/tasks.ts.
    status?: string;
    priority?: "urgent" | "high" | "medium" | "low" | "backlog" | null;
    assigneeId?: string | null;
    dueDate?: string | null;
    parentTaskId?: string | null;
    // F116 (AS-058): optional here — omitted means "let the database's
    // own `tasks_default_task_type` trigger resolve this workspace's
    // `delivery` type", exactly as every other insert path that doesn't
    // (yet) offer a picker already relies on.
    taskTypeId?: string | null;
    // F020 (TT-051): a task's initial start date, estimate, tags, and
    // billable flag — all written on the SAME insert as every other field
    // above, rather than through a follow-up editTask/updateTaskTags call.
    // Optional/nullable/omittable, same conventions as their sibling
    // fields in createTaskSchema.
    startDate?: string | null;
    estimateMinutes?: number | null;
    tags?: string[];
    billable?: boolean;
  },
  // F306 (D9/FU-3 scrutiny fix, AS-380): optional caller-session client,
  // used ONLY to fan out a `task_assigned` notification when this call
  // creates a task with an initial assignee. Optional because
  // createTaskForUser's other caller (app/api/extension/tasks/route.ts)
  // authenticates via a bearer JWT validated one-off against a fresh
  // anon-key client with no persisted session — that client cannot
  // authenticate a `create_notification` RPC call as this user. When
  // omitted, the notification fan-out below is skipped (logged, non-fatal)
  // and the create still succeeds.
  notifyClient?: SupabaseClient<Database>,
): Promise<CreateTaskResult> {
  const parsed = createTaskSchema.safeParse({
    projectId: input.projectId,
    title: input.title,
    description: input.description ?? null,
    status: input.status,
    priority: input.priority ?? null,
    assigneeId: input.assigneeId ?? null,
    dueDate: input.dueDate ?? null,
    parentTaskId: input.parentTaskId ?? null,
    taskTypeId: input.taskTypeId ?? undefined,
    startDate: input.startDate ?? null,
    estimateMinutes: input.estimateMinutes ?? null,
    tags: input.tags ?? undefined,
    billable: input.billable ?? undefined,
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Enter valid task details.",
    };
  }

  const user = { id: userId };

  const admin = createAdminClient();

  // Look up the project's owning workspace so membership is checked
  // against the real workspace, not one supplied by the caller. Only
  // non-deleted projects are eligible — a soft-deleted project should
  // behave as "not found" for task creation, same as editProject's
  // existing-row lookup convention.
  const { data: projectRow, error: projectError } = await admin
    .from("projects")
    .select("id, workspace_id, deleted_at, visibility")
    .eq("id", parsed.data.projectId)
    .is("deleted_at", null)
    .maybeSingle();

  if (projectError || !projectRow) {
    return { ok: false, error: "Project not found." };
  }

  // Defense in depth (AS-143): re-check the caller is an active member of
  // the project's workspace, server-side, rather than trusting that the UI
  // only shows the create-task form to members of the active workspace.
  const membership = await requireActiveMembership(
    admin,
    projectRow.workspace_id,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to create a task in this project.",
    };
  }

  // Creating a task is gated exactly like editing one (`canEditTask`:
  // owner/admin/member). Viewer, guest and client are refused server-side
  // regardless of whether the UI hid the create-task control; a guest's
  // task-level writes are comments, reactions, attachments and time
  // entries (AS-223), which go through their own gates.
  if (!canEditTask({ role: membership.role })) {
    return {
      ok: false,
      error: "You don't have permission to create tasks.",
    };
  }

  // F322 (AS-227, AS-228): same class of bug as the single-task mutation
  // actions below — an active workspace member who is not an explicit
  // member of a PRIVATE project could otherwise create a task directly
  // inside that project, even though they can't see it. See
  // isProjectVisibleToCaller's doc comment above `loadTaskAssignContext`.
  if (
    !(await isProjectVisibleToCaller(
      admin,
      {
        projectId: projectRow.id,
        visibility: (projectRow.visibility as ProjectVisibility) ?? "workspace",
      },
      user.id,
      membership.role,
    ))
  ) {
    return {
      ok: false,
      error: "You don't have permission to create a task in this project.",
    };
  }

  // AS-052: a task cannot be assigned to a user who is not a member of the
  // task's workspace — re-checked server-side even though the UI would
  // only ever offer workspace members as assignee choices.
  if (parsed.data.assigneeId) {
    const assigneeMembership = await requireActiveMembership(
      admin,
      projectRow.workspace_id,
      parsed.data.assigneeId,
    );
    if (!assigneeMembership.ok) {
      return {
        ok: false,
        error: "The selected assignee is not a member of this workspace.",
      };
    }
  }

  // F149 (AS-267/AS-268 setup): validate the proposed parent server-side
  // before attempting the insert, so a bad parentTaskId maps to a
  // specific message rather than the database trigger's raw exception
  // text. Mirrors F148's enforce_task_parent_rules() invariants exactly:
  // the parent must exist, be live (not soft-deleted), belong to the SAME
  // project as the new child, and itself be top-level (a child cannot
  // itself have children — F148's deliberate one-level limit).
  if (parsed.data.parentTaskId) {
    const { data: parentRow, error: parentError } = await admin
      .from("tasks")
      .select("id, project_id, parent_task_id, deleted_at")
      .eq("id", parsed.data.parentTaskId)
      .is("deleted_at", null)
      .maybeSingle();

    if (parentError || !parentRow) {
      return { ok: false, error: "Parent task not found." };
    }

    if (parentRow.project_id !== parsed.data.projectId) {
      return {
        ok: false,
        error: "A subtask must be in the same project as its parent.",
      };
    }

    if (parentRow.parent_task_id !== null) {
      return {
        ok: false,
        error: "A subtask cannot itself have subtasks.",
      };
    }
  }

  // F116: when a caller DOES supply a task_type_id, it must belong to
  // this task's own workspace — same cross-tenant guard setTaskType
  // already applies (lib/actions/task-types.ts). Its
  // `default_client_visible` is also resolved here so it can seed the
  // new task's OWN `client_visible` at insert (AS-060: initial value
  // only — never read again after this).
  let defaultClientVisible: boolean | null = null;
  if (parsed.data.taskTypeId) {
    const { data: taskTypeRow } = await admin
      .from("task_types")
      .select("workspace_id, default_client_visible")
      .eq("id", parsed.data.taskTypeId)
      .maybeSingle();
    if (!taskTypeRow || taskTypeRow.workspace_id !== projectRow.workspace_id) {
      return { ok: false, error: "Task type not found." };
    }
    defaultClientVisible = taskTypeRow.default_client_visible;
  }

  // F248 (AS-479): `parsed.data.status` must name one of THIS project's
  // real board columns — same guard moveTaskStatus already applies (see
  // that action's own doc comment above its matching lookup), now shared
  // by the create path too since createTaskSchema's `status` was widened
  // from a fixed four-value enum to any project column name. Prevents a
  // stale/forged column name (e.g. a column deleted after the quick-add
  // control rendered) from reaching the insert with `status_id` silently
  // left null by the DB trigger.
  // status_set_v2 renamed the legacy default columns (todo -> To Do,
  // etc.) on every project, while several callers still arrive with
  // createTaskSchema's legacy "todo" default (AS-045) — see
  // lib/tasks/resolve-status.ts. A stale/forged CUSTOM name still
  // hard-fails exactly as F248/AS-479 requires.
  const resolvedStatus = await resolveProjectStatusName(
    admin,
    parsed.data.projectId,
    parsed.data.status,
  );

  if (!resolvedStatus) {
    return {
      ok: false,
      error: "That column no longer exists. Refresh the board and try again.",
    };
  }

  // AS-058: author_id is set here from the server-verified caller id, never
  // trusted from client input. created_at is left to the column default
  // (supabase/migrations/20260818013434_create_tasks.sql sets `default
  // now()`), also never accepted from the client.
  //
  // position (AS-079): append to the end of the (project, status) column
  // this task is being created into — look up the current last task's
  // position in that column and hand it to calculatePosition as the
  // `prevPosition` neighbor, with no `nextPosition` (null = "becoming the
  // last card"). An empty column falls back to calculatePosition's own
  // DEFAULT_POSITION.
  const { data: lastInColumn } = await admin
    .from("tasks")
    .select("position")
    .eq("project_id", parsed.data.projectId)
    .eq("status", resolvedStatus)
    .is("deleted_at", null)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const newTaskPosition = calculatePosition(
    lastInColumn?.position ?? null,
    null,
  );

  // F116 (AS-058): `task_type_id` is required at the database level. When
  // a caller doesn't (yet) supply one, this resolves (or lazily creates,
  // for a workspace that predates the seed) the workspace's own
  // `delivery` row explicitly, via the same `ensure_task_type` helper
  // `tasks_default_task_type` uses internally — done here rather than
  // left to that trigger only so the value is known and can seed
  // `client_visible` correctly below.
  let resolvedTaskTypeId = parsed.data.taskTypeId ?? null;
  if (!resolvedTaskTypeId) {
    const { data: ensuredId, error: ensureError } = await admin.rpc(
      "ensure_task_type",
      {
        p_workspace_id: projectRow.workspace_id,
        p_system_key: "delivery",
        p_name: "Delivery",
        p_color: "#6b7280",
        p_is_billable: true,
        p_default_client_visible: false,
      },
    );
    if (ensureError || !ensuredId) {
      logger.error("createTaskForUser: failed to resolve default task type", { error: ensureError });
      return {
        ok: false,
        error: "Something went wrong. Please try again in a moment.",
      };
    }
    resolvedTaskTypeId = ensuredId;
  }

  const { data: inserted, error: insertError } = await admin
    .from("tasks")
    .insert({
      project_id: parsed.data.projectId,
      title: parsed.data.title,
      description: parsed.data.description,
      status: resolvedStatus,
      priority: parsed.data.priority,
      assignee_id: parsed.data.assigneeId,
      due_date: parsed.data.dueDate,
      author_id: user.id,
      position: newTaskPosition,
      parent_task_id: parsed.data.parentTaskId ?? null,
      task_type_id: resolvedTaskTypeId,
      // AS-060: a real F116 client_visible default is applied only when
      // a type IS explicitly supplied by the caller, per "as its initial
      // value only" — an insert that fell through to the generic
      // `delivery` default above keeps `client_visible`'s own plain
      // column default (false), same as every pre-F116 insert already
      // did.
      ...(defaultClientVisible !== null ? { client_visible: defaultClientVisible } : {}),
      // F020 (TT-051): start date, estimate, tags, and billable are all
      // written directly on this insert now, rather than requiring a
      // follow-up editTask/updateTaskTags call. Each stays omitted from
      // the insert payload when not supplied, so the column's own DB
      // default (billable/tags) or NULL (start_date/estimate_minutes)
      // applies exactly as before this feature.
      ...(parsed.data.startDate !== undefined
        ? { start_date: parsed.data.startDate }
        : {}),
      ...(parsed.data.estimateMinutes !== undefined
        ? { estimate_minutes: parsed.data.estimateMinutes }
        : {}),
      ...(parsed.data.tags !== undefined ? { tags: parsed.data.tags } : {}),
      ...(parsed.data.billable !== undefined
        ? { billable: parsed.data.billable }
        : {}),
    })
    .select(
      "id, project_id, title, description, status, priority, assignee_id, due_date, author_id, position, created_at, parent_task_id, number, start_date, estimate_minutes, tags, billable",
    )
    .single();

  if (insertError || !inserted) {
    logger.error("createTaskForUser: insert failed", { error: insertError });
    // F149: the app-level parent checks above already cover the common
    // cases, but a race (parent deleted/re-parented between the check and
    // this insert) can still hit enforce_task_parent_rules()'s trigger
    // (F148) directly. That trigger raises a plain-text exception with no
    // custom error code (see F148's handoff notes), so it's matched here
    // by message content rather than surfacing the raw database error to
    // the user (AS-146).
    if (
      parsed.data.parentTaskId &&
      /parent|nesting/i.test(insertError?.message ?? "")
    ) {
      return {
        ok: false,
        error:
          "This task can't be added as a subtask right now. Please refresh and try again.",
      };
    }
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  // F306 (D9/FU-3 scrutiny fix, AS-380): a task created WITH an initial
  // assignee never fired a `task_assigned` notification — only a later
  // setTaskAssigneesCore call did. Routed through the same
  // computeFanoutRecipients/filterRecipientsByInAppPreference/
  // createNotification helpers every other fan-out call site uses. No
  // task_activity entry is written for this initial assignee (per
  // diffTaskFields's own documented "no prior value to diff against"
  // rule — creation is not a *change*, there is no "before"), only the
  // notification. Non-fatal, and silently skipped (logged) when no
  // `notifyClient` was supplied (see this parameter's doc comment above).
  if (parsed.data.assigneeId) {
    if (notifyClient) {
      try {
        const computedRecipients = computeFanoutRecipients({
          type: "assigned",
          actorId: user.id,
          assigneeIds: [parsed.data.assigneeId],
        });
        const recipients = await filterRecipientsByInAppPreference(
          admin,
          computedRecipients ?? [],
        );
        for (const recipient of recipients ?? []) {
          await createNotification(
            notifyClient,
            {
              userId: recipient.userId,
              workspaceId: projectRow.workspace_id,
              kind: recipient.kind,
              taskId: inserted.id,
            },
            "createTaskForUser",
          );
        }
      } catch (fanoutError) {
        logger.error("createTaskForUser: notification fan-out failed (non-fatal)", { error: fanoutError });
      }
    } else {
      logger.error("createTaskForUser: no notifyClient supplied, skipping task_assigned fan-out (non-fatal)", { taskId: inserted.id });
    }
  }

  const { data: workspaceRow } = await admin
    .from("workspaces")
    .select("slug")
    .eq("id", projectRow.workspace_id)
    .maybeSingle();

  if (workspaceRow?.slug) {
    try {
      revalidatePath(`/w/${workspaceRow.slug}`, "layout");
    } catch (revalidateError) {
      // Same non-fatal cache-freshness rationale as
      // lib/actions/projects.ts: revalidatePath throws outside an active
      // request/render context (e.g. this action invoked from a test
      // harness). The insert itself already succeeded, so this is not an
      // action failure.
      logger.error("createTaskForUser: revalidatePath failed (non-fatal)", { error: revalidateError });
    }
  }

  return {
    ok: true,
    data: {
      id: inserted.id,
      projectId: inserted.project_id,
      title: inserted.title,
      description: inserted.description,
      status: inserted.status,
      priority: inserted.priority,
      assigneeId: inserted.assignee_id,
      dueDate: inserted.due_date,
      authorId: inserted.author_id,
      position: inserted.position,
      createdAt: inserted.created_at,
      parentTaskId: inserted.parent_task_id,
      number: inserted.number,
      startDate: inserted.start_date,
      estimateMinutes: inserted.estimate_minutes,
      tags: inserted.tags,
      billable: inserted.billable,
    },
  };
}
