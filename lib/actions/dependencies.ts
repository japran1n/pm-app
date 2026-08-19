"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createDependencySchema } from "@/lib/validation/dependencies";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { formatTaskKey } from "@/lib/tasks/task-key";

// F156: createDependency (AS-278). Mirrors lib/actions/checklist.ts's
// shape: Zod-validated input, membership re-checked server-side (defense
// in depth), the project's discriminated-union result, generic
// user-facing errors with details only logged server-side (AS-146).
//
// Permission model note (same as F152's checklist.ts): lib/auth/
// permissions.ts does not exist yet (M11's F127 hasn't landed). This file
// follows the membership-guard convention already established by
// comments.ts/checklist.ts (requireActiveMembership from
// lib/auth/require-membership.ts) rather than inventing an early,
// throwaway version of the future permissions predicate.
//
// The INSERT itself runs through the request-scoped, RLS-respecting
// client (`supabase`), never the admin client — RLS (F155's
// task_dependencies_insert_active_members policy) plus this feature's own
// no-cycle trigger are the real, exercised enforcement boundary. The
// admin client is used ONLY for read-only lookups that need to resolve
// real data (each task's true owning workspace/project/number/title)
// regardless of the caller's own RLS visibility, same convention every
// other action file in this codebase uses.
//
// TOCTOU note (the reason this feature exists): this action performs NO
// pre-insert "would this cycle?" check of its own. It always attempts the
// real insert and lets the database's BEFORE INSERT trigger
// (`enforce_task_dependency_no_cycle`, this feature's migration) be the
// single place a cycle is ever detected, under its own transaction-scoped
// advisory lock. Pre-checking here — even just to build a nicer error
// message before attempting the write — would reintroduce exactly the
// race two concurrent calls to this same action could exploit. The
// lookups below (for the error message) only ever run AFTER the insert
// has already failed, purely to describe what already happened, not to
// decide anything.

type TaskLookup = {
  id: string;
  title: string;
  number: number;
  deletedAt: string | null;
  workspaceId: string;
  projectKey: string;
};

async function loadTaskLookup(
  admin: ReturnType<typeof createAdminClient>,
  taskId: string,
): Promise<TaskLookup | null> {
  const { data: row, error } = await admin
    .from("tasks")
    .select("id, title, number, deleted_at, projects(workspace_id, key)")
    .eq("id", taskId)
    .maybeSingle();

  if (error || !row) {
    return null;
  }

  const project = row.projects as
    | { workspace_id: string; key: string }
    | { workspace_id: string; key: string }[]
    | null;
  const projectRow = Array.isArray(project) ? project[0] : project;

  if (!projectRow) {
    return null;
  }

  return {
    id: row.id,
    title: row.title,
    number: row.number,
    deletedAt: row.deleted_at,
    workspaceId: projectRow.workspace_id,
    projectKey: projectRow.key,
  };
}

function describeTask(task: TaskLookup): string {
  const key = formatTaskKey(task.projectKey, task.number);
  return key ? `${key} — "${task.title}"` : `"${task.title}"`;
}

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
      console.error(
        `${actionLabel}: revalidatePath failed (non-fatal):`,
        revalidateError,
      );
    }
  }
}

export type CreateDependencyResult =
  | {
      ok: true;
      data: {
        id: string;
        blockingTaskId: string;
        blockedTaskId: string;
      };
    }
  | { ok: false; error: string };

// Creates a "blocking task blocks blocked task" dependency (AS-276's
// write path, extended here with AS-278's cycle guard). See this file's
// header comment for why no cycle check runs before the insert.
export async function createDependency(
  blockingTaskId: string,
  blockedTaskId: string,
): Promise<CreateDependencyResult> {
  const parsed = createDependencySchema.safeParse({
    blockingTaskId,
    blockedTaskId,
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid dependency.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      error: "You must be signed in to create a dependency.",
    };
  }

  const admin = createAdminClient();

  // Resolve both tasks up front, through the admin client so a bad id
  // reads as "not found" rather than an ambiguous RLS-filtered result
  // (same convention checklist.ts's loadChecklistItemContext uses), and
  // so this action already has each task's key/title on hand for a good
  // error message if the insert is later rejected for any reason.
  const [blockingTask, blockedTask] = await Promise.all([
    loadTaskLookup(admin, parsed.data.blockingTaskId),
    loadTaskLookup(admin, parsed.data.blockedTaskId),
  ]);

  if (!blockingTask || blockingTask.deletedAt) {
    return { ok: false, error: "Task not found." };
  }
  if (!blockedTask || blockedTask.deletedAt) {
    return { ok: false, error: "Task not found." };
  }

  // AS-285 (F155): a dependency cannot cross workspaces. The database
  // trigger (task_dependencies_enforce_same_workspace) is the real
  // enforcement, but per this codebase's defense-in-depth convention this
  // is re-checked here too, and reported the same generic way an unknown
  // task is ("not found") so this action never itself becomes a way to
  // discover which workspace an id you're not a member of belongs to.
  if (blockingTask.workspaceId !== blockedTask.workspaceId) {
    return { ok: false, error: "Task not found." };
  }

  const membership = await requireActiveMembership(
    admin,
    blockingTask.workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to create a dependency on this task.",
    };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("task_dependencies")
    .insert({
      blocking_task_id: parsed.data.blockingTaskId,
      blocked_task_id: parsed.data.blockedTaskId,
      created_by: user.id,
    })
    .select("id, blocking_task_id, blocked_task_id")
    .single();

  if (insertError || !inserted) {
    // AS-278: the database's `enforce_task_dependency_no_cycle` trigger
    // (this feature's migration) is the single source of truth for cycle
    // rejection — see this file's header comment for why. Its raised
    // message always starts with the literal marker
    // "task_dependency_cycle:", which is the one thing this action
    // pattern-matches on to decide whether to build the named-conflict
    // message below; every other insert failure (uniqueness, RLS denial,
    // an id that vanished between the lookups above and this insert)
    // falls through to the generic message.
    if (insertError?.message?.includes("task_dependency_cycle")) {
      return {
        ok: false,
        error: `Adding this dependency would create a cycle: ${describeTask(
          blockedTask,
        )} already blocks ${describeTask(blockingTask)}.`,
      };
    }

    if (insertError?.code === "23505") {
      return { ok: false, error: "This dependency already exists." };
    }

    console.error("createDependency: insert failed:", insertError);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  await revalidateWorkspace(
    admin,
    blockingTask.workspaceId,
    "createDependency",
  );

  return {
    ok: true,
    data: {
      id: inserted.id,
      blockingTaskId: inserted.blocking_task_id,
      blockedTaskId: inserted.blocked_task_id,
    },
  };
}
