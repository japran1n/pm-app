"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createTaskSchema,
  assignTaskSchema,
  editTaskSchema,
  deleteTaskSchema,
  updateTaskTagsSchema,
  moveTaskStatusSchema,
  reorderTaskSchema,
  moveAndReorderTaskSchema,
  promoteSubtaskSchema,
  type EditTaskUpdates,
} from "@/lib/validation/tasks";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { calculatePosition } from "@/lib/board/position";
import type { TaskDetailSheetTask } from "@/components/task/task-detail-sheet";
import type { TaskComment } from "@/components/task/comment-list";
import type { TaskAttachment } from "@/components/task/attachment-list";
import type { SubtaskListChildTask } from "@/components/task/subtask-list";
import type { ChecklistListItem } from "@/components/task/checklist";

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
export async function createTask(
  projectId: string,
  title: string,
  description?: string | null,
  status?: "todo" | "in_progress" | "in_review" | "done",
  priority?: "urgent" | "high" | "medium" | "low" | "backlog" | null,
  assigneeId?: string | null,
  dueDate?: string | null,
  parentTaskId?: string | null,
): Promise<CreateTaskResult> {
  const parsed = createTaskSchema.safeParse({
    projectId,
    title,
    description: description ?? null,
    status,
    priority: priority ?? null,
    assigneeId: assigneeId ?? null,
    dueDate: dueDate ?? null,
    parentTaskId: parentTaskId ?? null,
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Enter valid task details.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to create a task." };
  }

  const admin = createAdminClient();

  // Look up the project's owning workspace so membership is checked
  // against the real workspace, not one supplied by the caller. Only
  // non-deleted projects are eligible — a soft-deleted project should
  // behave as "not found" for task creation, same as editProject's
  // existing-row lookup convention.
  const { data: projectRow, error: projectError } = await admin
    .from("projects")
    .select("id, workspace_id, deleted_at")
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
    .eq("status", parsed.data.status)
    .is("deleted_at", null)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const newTaskPosition = calculatePosition(
    lastInColumn?.position ?? null,
    null,
  );

  const { data: inserted, error: insertError } = await admin
    .from("tasks")
    .insert({
      project_id: parsed.data.projectId,
      title: parsed.data.title,
      description: parsed.data.description,
      status: parsed.data.status,
      priority: parsed.data.priority,
      assignee_id: parsed.data.assigneeId,
      due_date: parsed.data.dueDate,
      author_id: user.id,
      position: newTaskPosition,
      parent_task_id: parsed.data.parentTaskId ?? null,
    })
    .select(
      "id, project_id, title, description, status, priority, assignee_id, due_date, author_id, position, created_at, parent_task_id",
    )
    .single();

  if (insertError || !inserted) {
    console.error("createTask: insert failed:", insertError);
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
      console.error(
        "createTask: revalidatePath failed (non-fatal):",
        revalidateError,
      );
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
    },
  };
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

// Assigns (or unassigns) a task (F036: AS-051, AS-052, AS-053). Pattern
// mirrors createTask above: Zod-validated input, membership re-checked
// server-side (defense in depth, AS-143), admin client used for the
// actual update (RLS on `tasks` would also allow this same update for an
// active member; the admin client is used here only because this action
// has already independently re-verified membership itself), discriminated
// union return, generic user-facing errors with details only logged
// server-side (AS-146).
//
// assigneeId === null means "unassign" (AS-053) and is a valid, explicit
// input — never treated as "no change".
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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to assign a task." };
  }

  const admin = createAdminClient();

  // Look up the task's owning workspace (via its project) so membership is
  // checked against the real workspace, never one supplied by the caller.
  // A soft-deleted task behaves as "not found", same convention as
  // createTask's project lookup.
  const { data: taskRow, error: taskError } = await admin
    .from("tasks")
    .select("id, assignee_id, deleted_at, projects!inner(id, workspace_id)")
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
  // the task's workspace, server-side.
  const membership = await requireActiveMembership(
    admin,
    workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to assign this task.",
    };
  }

  // AS-052: a task cannot be assigned to a user who is not a member of the
  // task's workspace — verified server-side via a real DB query against
  // the *task's own* workspace, never trusted from client input, and never
  // skipped when assigneeId is non-null.
  if (parsed.data.assigneeId !== null) {
    const assigneeMembership = await requireActiveMembership(
      admin,
      workspaceId,
      parsed.data.assigneeId,
    );
    if (!assigneeMembership.ok) {
      return {
        ok: false,
        error: "The selected assignee is not a member of this workspace.",
      };
    }
  }

  // AS-053: assigneeId === null unassigns the task.
  const { data: updated, error: updateError } = await admin
    .from("tasks")
    .update({ assignee_id: parsed.data.assigneeId })
    .eq("id", parsed.data.taskId)
    .select("id, assignee_id")
    .single();

  if (updateError || !updated) {
    console.error("assignTask: update failed:", updateError);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
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
      console.error(
        "assignTask: revalidatePath failed (non-fatal):",
        revalidateError,
      );
    }
  }

  return {
    ok: true,
    data: {
      id: updated.id,
      assigneeId: updated.assignee_id,
    },
  };
}

export type EditTaskResult =
  | {
      ok: true;
      data: {
        id: string;
        title: string;
        description: string | null;
        priority: string | null;
        dueDate: string | null;
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
    .select("id, deleted_at, projects!inner(id, workspace_id)")
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

  // Build the update payload from only the fields present in `updates`.
  // Never includes project_id (AS-060) — there is no source field for it.
  const updatePayload: {
    title?: string;
    description?: string | null;
    priority?: "urgent" | "high" | "medium" | "low" | "backlog" | null;
    due_date?: string | null;
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

  const { data: updated, error: updateError } = await admin
    .from("tasks")
    .update(updatePayload)
    .eq("id", parsed.data.taskId)
    .select("id, title, description, priority, due_date")
    .single();

  if (updateError || !updated) {
    console.error("editTask: update failed:", updateError);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
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
      console.error(
        "editTask: revalidatePath failed (non-fatal):",
        revalidateError,
      );
    }
  }

  return {
    ok: true,
    data: {
      id: updated.id,
      title: updated.title,
      description: updated.description,
      priority: updated.priority,
      dueDate: updated.due_date,
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
export async function deleteTask(taskId: string): Promise<DeleteTaskResult> {
  const parsed = deleteTaskSchema.safeParse({ taskId });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid task.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to delete a task." };
  }

  const admin = createAdminClient();

  // Look up the task's owning workspace (via its project) so membership is
  // checked against the real workspace, never one supplied by the caller.
  // An already-deleted task behaves as "not found", same convention as
  // assignTask/editTask's task lookup — this also makes deleteTask
  // naturally idempotent-safe (a second delete call just reports "not
  // found" rather than re-touching the row).
  const { data: taskRow, error: taskError } = await admin
    .from("tasks")
    .select("id, deleted_at, projects!inner(id, workspace_id)")
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
  // the task's workspace, server-side. AS-055: any role, no per-task
  // ownership check — mirrors editTask's membership check exactly.
  const membership = await requireActiveMembership(
    admin,
    workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to delete this task.",
    };
  }

  // AS-267: single atomic RPC call — soft-deletes this task AND cascades
  // to any live children in one transaction (see doc comment above).
  const { data: cascadeRows, error: deleteError } = await admin.rpc(
    "cascade_delete_task",
    { p_task_id: parsed.data.taskId },
  );

  const deleted = cascadeRows?.[0];

  if (deleteError || !deleted || !deleted.deleted_at) {
    console.error("deleteTask: cascade_delete_task failed:", deleteError);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
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
      console.error(
        "deleteTask: revalidatePath failed (non-fatal):",
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
export async function promoteSubtask(
  taskId: string,
): Promise<PromoteSubtaskResult> {
  const parsed = promoteSubtaskSchema.safeParse({ taskId });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid task.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to promote a task." };
  }

  const admin = createAdminClient();

  // Look up the task's owning workspace (via its project) so membership is
  // checked against the real workspace, never one supplied by the caller.
  // A soft-deleted task behaves as "not found", same convention as every
  // other action in this file.
  const { data: taskRow, error: taskError } = await admin
    .from("tasks")
    .select("id, parent_task_id, deleted_at, projects!inner(id, workspace_id)")
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
  // the task's workspace, server-side.
  const membership = await requireActiveMembership(
    admin,
    workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to promote this task.",
    };
  }

  // Zero-state (Clarified implementation Q6): already top-level — no-op,
  // ok without writing.
  if (taskRow.parent_task_id === null) {
    return { ok: true, data: { id: taskRow.id, parentTaskId: null } };
  }

  const { data: updated, error: updateError } = await admin
    .from("tasks")
    .update({ parent_task_id: null })
    .eq("id", parsed.data.taskId)
    .select("id, parent_task_id")
    .single();

  if (updateError || !updated) {
    console.error("promoteSubtask: update failed:", updateError);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
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
      console.error(
        "promoteSubtask: revalidatePath failed (non-fatal):",
        revalidateError,
      );
    }
  }

  return {
    ok: true,
    data: {
      id: updated.id,
      parentTaskId: null,
    },
  };
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
export async function updateTaskTags(
  taskId: string,
  tags: string[],
): Promise<UpdateTaskTagsResult> {
  const parsed = updateTaskTagsSchema.safeParse({ taskId, tags });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Enter valid tags.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to update tags." };
  }

  const admin = createAdminClient();

  // Look up the task's owning workspace (via its project) so membership is
  // checked against the real workspace, never one supplied by the caller.
  // A soft-deleted task behaves as "not found", same convention as
  // assignTask/editTask/deleteTask's task lookup.
  const { data: taskRow, error: taskError } = await admin
    .from("tasks")
    .select("id, deleted_at, projects!inner(id, workspace_id)")
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
  // the task's workspace, server-side. Any role, no per-task ownership
  // check — mirrors editTask's (AS-061) and deleteTask's membership model.
  const membership = await requireActiveMembership(
    admin,
    workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to update this task's tags.",
    };
  }

  // AS-066: `parsed.data.tags` may legitimately be `[]` here — that is
  // written as-is, never coerced to null.
  const { data: updated, error: updateError } = await admin
    .from("tasks")
    .update({ tags: parsed.data.tags })
    .eq("id", parsed.data.taskId)
    .select("id, tags")
    .single();

  if (updateError || !updated) {
    console.error("updateTaskTags: update failed:", updateError);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
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
      console.error(
        "updateTaskTags: revalidatePath failed (non-fatal):",
        revalidateError,
      );
    }
  }

  return {
    ok: true,
    data: {
      id: updated.id,
      tags: updated.tags ?? [],
    },
  };
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
export async function moveTaskStatus(
  taskId: string,
  newStatus: "todo" | "in_progress" | "in_review" | "done",
): Promise<MoveTaskStatusResult> {
  const parsed = moveTaskStatusSchema.safeParse({
    taskId,
    status: newStatus,
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid status.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to move a task." };
  }

  const admin = createAdminClient();

  // Look up the task's owning workspace (via its project) so membership is
  // checked against the real workspace, never one supplied by the caller.
  // A soft-deleted task behaves as "not found", same convention as
  // assignTask/editTask/deleteTask's task lookup.
  const { data: taskRow, error: taskError } = await admin
    .from("tasks")
    .select("id, deleted_at, projects!inner(id, workspace_id)")
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
  // the task's workspace, server-side.
  const membership = await requireActiveMembership(
    admin,
    workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to move this task.",
    };
  }

  const { data: updated, error: updateError } = await admin
    .from("tasks")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.taskId)
    .select("id, status")
    .single();

  if (updateError || !updated) {
    console.error("moveTaskStatus: update failed:", updateError);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
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
      console.error(
        "moveTaskStatus: revalidatePath failed (non-fatal):",
        revalidateError,
      );
    }
  }

  return {
    ok: true,
    data: {
      id: updated.id,
      status: updated.status,
    },
  };
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
export async function reorderTask(
  taskId: string,
  newPosition: number,
): Promise<ReorderTaskResult> {
  const parsed = reorderTaskSchema.safeParse({
    taskId,
    position: newPosition,
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid position.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to reorder a task." };
  }

  const admin = createAdminClient();

  // Look up the task's owning workspace (via its project) so membership is
  // checked against the real workspace, never one supplied by the caller.
  // A soft-deleted task behaves as "not found", same convention as
  // moveTaskStatus/editTask/deleteTask's task lookup.
  const { data: taskRow, error: taskError } = await admin
    .from("tasks")
    .select("id, deleted_at, projects!inner(id, workspace_id)")
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
  // the task's workspace, server-side.
  const membership = await requireActiveMembership(
    admin,
    workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to reorder this task.",
    };
  }

  // AS-070/AS-078: position only — status is deliberately absent from this
  // payload. AS-080: this UPDATE only ever sets `position`, and the
  // tasks_set_updated_at trigger's WHEN clause (see migration referenced
  // above) is what actually keeps updated_at untouched for this case.
  const { data: updated, error: updateError } = await admin
    .from("tasks")
    .update({ position: parsed.data.position })
    .eq("id", parsed.data.taskId)
    .select("id, position")
    .single();

  if (updateError || !updated) {
    console.error("reorderTask: update failed:", updateError);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
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
      console.error(
        "reorderTask: revalidatePath failed (non-fatal):",
        revalidateError,
      );
    }
  }

  return {
    ok: true,
    data: {
      id: updated.id,
      position: updated.position,
    },
  };
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
export async function moveAndReorderTask(
  taskId: string,
  newStatus: "todo" | "in_progress" | "in_review" | "done",
  newPosition: number,
): Promise<MoveAndReorderTaskResult> {
  const parsed = moveAndReorderTaskSchema.safeParse({
    taskId,
    status: newStatus,
    position: newPosition,
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid status or position.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to move a task." };
  }

  const admin = createAdminClient();

  // Look up the task's owning workspace (via its project) so membership is
  // checked against the real workspace, never one supplied by the caller.
  // A soft-deleted task behaves as "not found", same convention as
  // moveTaskStatus/reorderTask's task lookup.
  const { data: taskRow, error: taskError } = await admin
    .from("tasks")
    .select("id, deleted_at, projects!inner(id, workspace_id)")
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
  // the task's workspace, server-side.
  const membership = await requireActiveMembership(
    admin,
    workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to move this task.",
    };
  }

  // Single UPDATE, both columns set together — atomic by construction. If
  // this fails (constraint violation, connection drop, etc.), NEITHER
  // status NOR position changes; there is no partial-commit state for the
  // client to be inconsistent with.
  const { data: updated, error: updateError } = await admin
    .from("tasks")
    .update({ status: parsed.data.status, position: parsed.data.position })
    .eq("id", parsed.data.taskId)
    .select("id, status, position")
    .single();

  if (updateError || !updated) {
    console.error("moveAndReorderTask: update failed:", updateError);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
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
      console.error(
        "moveAndReorderTask: revalidatePath failed (non-fatal):",
        revalidateError,
      );
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
        currentUserRole: "owner" | "admin" | "member";
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
      "id, title, description, status, priority, assignee_id, due_date, tags, number, project_id, parent_task_id, deleted_at, projects!inner(key, workspace_id)",
    )
    .eq("id", parsed.data.taskId)
    .is("deleted_at", null)
    .maybeSingle();

  if (taskError || !taskRow) {
    return { ok: false, error: "Task not found." };
  }

  const project = taskRow.projects as
    | { key: string; workspace_id: string }
    | { key: string; workspace_id: string }[]
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

  // F150 (AS-264): this task's own live children (subtasks), fetched here
  // — inside getTaskDetail's existing single detail-fetch — rather than a
  // per-child round trip once the Subtasks section renders. A task that
  // is itself a child can never have children of its own (F148's
  // one-level nesting limit, enforced by enforce_task_parent_rules()), so
  // this query harmlessly returns zero rows for a child task rather than
  // needing its own conditional branch.
  const childrenQuery = admin
    .from("tasks")
    .select("id, title, status, assignee_id, number")
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

  const [
    commentsResult,
    attachmentsResult,
    childrenResult,
    parentResult,
    checklistResult,
  ] = await Promise.all([
    admin
      .from("comments")
      .select("id, task_id, user_id, text, created_at")
      .eq("task_id", parsed.data.taskId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true }),
    admin
      .from("attachments")
      .select("id, task_id, file_url, file_name, uploaded_by, created_at")
      .eq("task_id", parsed.data.taskId)
      .order("created_at", { ascending: true }),
    childrenQuery,
    parentQuery ?? Promise.resolve({ data: null, error: null }),
    checklistQuery,
  ]);

  if (commentsResult.error) {
    console.error(
      "getTaskDetail: comments fetch failed:",
      commentsResult.error,
    );
    return {
      ok: false,
      error: "Something went wrong loading this task. Please try again.",
    };
  }

  if (attachmentsResult.error) {
    console.error(
      "getTaskDetail: attachments fetch failed:",
      attachmentsResult.error,
    );
    return {
      ok: false,
      error: "Something went wrong loading this task. Please try again.",
    };
  }

  if (childrenResult.error) {
    console.error(
      "getTaskDetail: children fetch failed:",
      childrenResult.error,
    );
    return {
      ok: false,
      error: "Something went wrong loading this task. Please try again.",
    };
  }

  if (parentResult.error) {
    console.error(
      "getTaskDetail: parent fetch failed:",
      parentResult.error,
    );
    return {
      ok: false,
      error: "Something went wrong loading this task. Please try again.",
    };
  }

  if (checklistResult.error) {
    console.error(
      "getTaskDetail: checklist fetch failed:",
      checklistResult.error,
    );
    return {
      ok: false,
      error: "Something went wrong loading this task. Please try again.",
    };
  }

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
  }));

  return {
    ok: true,
    data: {
      task: {
        id: taskRow.id,
        title: taskRow.title,
        description: taskRow.description,
        status: taskRow.status as TaskDetailSheetTask["status"],
        priority: taskRow.priority as TaskDetailSheetTask["priority"],
        assigneeId: taskRow.assignee_id,
        dueDate: taskRow.due_date,
        tags: taskRow.tags ?? [],
        // F146 (AS-258): see this function's task+project select above.
        number: taskRow.number,
        projectKey: projectRow?.key,
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
        children: (childrenResult.data ?? []).map(
          (row): SubtaskListChildTask => ({
            id: row.id,
            title: row.title,
            status: row.status as SubtaskListChildTask["status"],
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
      },
      comments: (commentsResult.data ?? []).map((row) => ({
        id: row.id,
        taskId: row.task_id,
        userId: row.user_id,
        text: row.text,
        createdAt: row.created_at,
      })),
      attachments,
      currentUserId: user.id,
      currentUserRole: membership.role,
    },
  };
}
