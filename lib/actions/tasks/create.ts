"use server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { createTaskForUser } from "@/lib/tasks/create";
import type { ActionResult } from "@/lib/actions/authz";

export type CreateTaskResult = ActionResult<{
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
        // F020 (TT-051): the same "additive, backward compatible" fields
        // as `number` above — every existing caller destructures only what
        // it needs.
        startDate: string | null;
        estimateMinutes: number | null;
        tags: string[];
        billable: boolean;
      }>;

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
  // F118 (AS-064): optional — omitted means "let createTaskForUser/the
  // DB trigger resolve this workspace's delivery type", exactly as every
  // pre-F118 caller (quick-add, templates, recurrence, the extension
  // route) already relies on. Only the New Task dialog supplies this.
  taskTypeId?: string | null,
  // F020 (TT-051): new trailing optional params — appended after
  // taskTypeId so every existing positional caller (quick-add, subtask
  // list, seed script, tests) keeps compiling unchanged.
  startDate?: string | null,
  estimateMinutes?: number | null,
  tags?: string[],
  billable?: boolean,
): Promise<CreateTaskResult> {
  const { supabase, user } = await getCurrentUser();

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
      taskTypeId,
      startDate,
      estimateMinutes,
      tags,
      billable,
    },
    // F306 (D9/FU-3 scrutiny fix, AS-380): the caller's own authenticated
    // session, so a task created with an initial assignee can notify that
    // assignee (create_notification pins actor_id via auth.uid()).
    supabase,
  );
}

