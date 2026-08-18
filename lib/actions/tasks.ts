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
  type EditTaskUpdates,
} from "@/lib/validation/tasks";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { calculatePosition } from "@/lib/board/position";

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
// in that (project, status) column — never a hardcoded constant.
export async function createTask(
  projectId: string,
  title: string,
  description?: string | null,
  status?: "todo" | "in_progress" | "in_review" | "done",
  priority?: "urgent" | "high" | "medium" | "low" | "backlog" | null,
  assigneeId?: string | null,
  dueDate?: string | null,
): Promise<CreateTaskResult> {
  const parsed = createTaskSchema.safeParse({
    projectId,
    title,
    description: description ?? null,
    status,
    priority: priority ?? null,
    assigneeId: assigneeId ?? null,
    dueDate: dueDate ?? null,
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
    })
    .select(
      "id, project_id, title, description, status, priority, assignee_id, due_date, author_id, position, created_at",
    )
    .single();

  if (insertError || !inserted) {
    console.error("createTask: insert failed:", insertError);
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

// Soft-deletes a task (F038: AS-055, AS-056, AS-057). Pattern mirrors
// editTask/assignTask above: Zod-validated input, membership re-checked
// server-side (defense in depth, AS-143), admin client used for the
// actual update, discriminated union return, generic user-facing errors
// with details only logged server-side (AS-146).
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

  const { data: deleted, error: deleteError } = await admin
    .from("tasks")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", parsed.data.taskId)
    .select("id, deleted_at")
    .single();

  if (deleteError || !deleted || !deleted.deleted_at) {
    console.error("deleteTask: update failed:", deleteError);
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
