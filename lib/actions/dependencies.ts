"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createDependencySchema,
  deleteDependencySchema,
} from "@/lib/validation/dependencies";
import { logger } from "@/lib/observability/logger";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { formatTaskKey, parseTaskKeyQuery } from "@/lib/tasks/task-key";
import { isProjectVisibleToCaller } from "@/lib/actions/project-visibility";
import type { ActionOutcome, ActionResult } from "@/lib/actions/authz";

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
      logger.error(`${actionLabel}: revalidatePath failed (non-fatal)`, { error: revalidateError });
    }
  }
}

export type CreateDependencyResult = ActionResult<{
        id: string;
        blockingTaskId: string;
        blockedTaskId: string;
      }>;

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

  const { supabase, user } = await getCurrentUser();

  if (!user) {
    return {
      ok: false,
      error: "You must be signed in to create a dependency.",
    };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
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

    logger.error("createDependency: insert failed", { error: insertError });
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

export type DeleteDependencyResult = ActionOutcome;

// F157 (AS-282): a dependency can be removed by EITHER side of the
// relationship. This action takes only the dependency row's own id — it
// never takes "which task initiated the removal" — so the exact same
// call serves both the "Blocked by" and "Blocks" sections of either
// task's Dependencies UI (components/task/dependencies.tsx); there is no
// "am I the blocking or blocked side" branch here or in the caller.
//
// F155's own DELETE RLS policy (task_dependencies_delete_active_members,
// supabase/migrations/20260819102618_task_dependencies.sql) already
// enforces this symmetrically: it checks membership via the row's
// blocking_task_id only, but AS-285's trigger guarantees every persisted
// row's two tasks always share one workspace, so "any active member of
// the shared workspace" already covers a caller who opened this
// dependency from the BLOCKED task's own detail sheet, not just the
// blocking task's. This action's own membership re-check below mirrors
// that same shared-workspace fact rather than re-deriving anything from
// "which side" the caller is on.
export async function deleteDependency(
  dependencyId: string,
): Promise<DeleteDependencyResult> {
  const parsed = deleteDependencySchema.safeParse({ dependencyId });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid dependency.",
    };
  }

  const { supabase, user } = await getCurrentUser();

  if (!user) {
    return {
      ok: false,
      error: "You must be signed in to remove a dependency.",
    };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  const { data: dependencyRow, error: dependencyError } = await admin
    .from("task_dependencies")
    .select("id, blocking_task_id, blocked_task_id")
    .eq("id", parsed.data.dependencyId)
    .maybeSingle();

  if (dependencyError || !dependencyRow) {
    return { ok: false, error: "Dependency not found." };
  }

  // Resolved purely to learn the shared workspace id for the membership
  // re-check and the post-delete revalidation — same "admin client for
  // read-only lookups only" convention as createDependency above.
  const blockingTask = await loadTaskLookup(
    admin,
    dependencyRow.blocking_task_id,
  );

  if (!blockingTask) {
    return { ok: false, error: "Dependency not found." };
  }

  const membership = await requireActiveMembership(
    admin,
    blockingTask.workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to remove this dependency.",
    };
  }

  // The delete itself runs through the request-scoped, RLS-respecting
  // client — task_dependencies_delete_active_members is the real,
  // exercised enforcement boundary, not this action's own re-check above
  // (defense in depth, same pattern as createDependency's insert).
  const { error: deleteError } = await supabase
    .from("task_dependencies")
    .delete()
    .eq("id", parsed.data.dependencyId);

  if (deleteError) {
    logger.error("deleteDependency: delete failed", { error: deleteError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  await revalidateWorkspace(
    admin,
    blockingTask.workspaceId,
    "deleteDependency",
  );

  return { ok: true };
}

export type DependencyCandidate = {
  id: string;
  title: string;
  status: "todo" | "in_progress" | "in_review" | "done";
  projectKey: string;
  number: number;
};

export type GetDependencyCandidatesResult = ActionResult<DependencyCandidate[]>;

const DEPENDENCY_CANDIDATE_LIMIT = 25;

// F157: backs the "Add" picker in each Dependencies section
// (components/task/dependencies.tsx). Per this feature's explicit
// critical context, the picker must EXCLUDE any candidate that would
// create a cycle rather than let the user pick one and then fail — this
// function is the one place that exclusion is computed, using the
// get_dependency_ancestors/get_dependency_descendants SQL functions
// added by this feature's migration
// (20260819104900_dependency_reachability_functions.sql), which
// themselves reuse F156's OWN recursive-CTE reachability walk. No graph
// traversal is reimplemented here in TypeScript.
//
// direction "blockedBy": searching for a task to add as a BLOCKER of
// `taskId` (a future insert shaped `createDependency(candidate.id,
// taskId)`). That insert's own cycle check (F156's trigger) walks
// forward from `taskId`; a candidate C would cycle iff `taskId` can
// already reach C, i.e. C is in get_dependency_descendants(taskId) — so
// that is exactly this direction's exclusion set.
//
// direction "blocks": searching for a task to add as something `taskId`
// BLOCKS (a future insert shaped `createDependency(taskId,
// candidate.id)`). A candidate C would cycle iff C can already reach
// `taskId`, i.e. C is in get_dependency_ancestors(taskId) — so that is
// this direction's exclusion set.
//
// `taskId` itself (AS-279, self-reference) and any task already directly
// linked in this same direction (would otherwise surface as a confusing
// "this dependency already exists" error after picking a result the UI
// just showed as available) are also excluded — both are simple id-set
// membership checks alongside the cycle exclusion, not a second source
// of truth for cycle detection.
export async function getDependencyCandidates(
  taskId: string,
  direction: "blockedBy" | "blocks",
  query: string,
): Promise<GetDependencyCandidatesResult> {
  const parsedTaskId = z.string().uuid("Invalid task.").safeParse(taskId);

  if (!parsedTaskId.success) {
    return { ok: false, error: "Invalid task." };
  }

  const { user } = await getCurrentUser();

  if (!user) {
    return {
      ok: false,
      error: "You must be signed in to search for tasks.",
    };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  const task = await loadTaskLookup(admin, taskId);

  if (!task || task.deletedAt) {
    return { ok: false, error: "Task not found." };
  }

  const membership = await requireActiveMembership(
    admin,
    task.workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to search for tasks here.",
    };
  }

  const closureRpc =
    direction === "blockedBy"
      ? "get_dependency_descendants"
      : "get_dependency_ancestors";

  const { data: closureRows, error: closureError } = await admin.rpc(
    closureRpc,
    { p_task_id: taskId },
  );

  if (closureError) {
    logger.error("getDependencyCandidates: reachability lookup failed", { error: closureError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const excludedIds = new Set<string>([taskId]);
  for (const row of closureRows ?? []) {
    excludedIds.add(row.task_id);
  }

  // Also exclude tasks that already have this exact direct edge, so the
  // list never offers a pick that would only fail with "this dependency
  // already exists" (task_dependencies_unique_pair) — a duplicate-avoidance
  // refinement of the same "don't offer what will fail" principle the
  // cycle exclusion above exists for, not a new rule of its own.
  const existingMatchColumn =
    direction === "blockedBy" ? "blocked_task_id" : "blocking_task_id";
  const existingOtherColumn =
    direction === "blockedBy" ? "blocking_task_id" : "blocked_task_id";

  const { data: existingRows, error: existingError } = await admin
    .from("task_dependencies")
    .select(existingOtherColumn)
    .eq(existingMatchColumn, taskId);

  if (existingError) {
    logger.error("getDependencyCandidates: existing-edge lookup failed", { error: existingError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  for (const row of existingRows ?? []) {
    const otherId = (row as Record<string, string>)[existingOtherColumn];
    if (otherId) excludedIds.add(otherId);
  }

  // Candidates are scoped to the task's own workspace (never a wider
  // search), same boundary lib/queries/search.ts's searchWorkspaceTasks
  // enforces for workspace search — a project in another workspace can
  // never appear here because it is never fetched in the first place.
  const { data: allProjects, error: projectsError } = await admin
    .from("projects")
    .select("id, key, visibility")
    .eq("workspace_id", task.workspaceId)
    .is("deleted_at", null);

  if (projectsError) {
    logger.error("getDependencyCandidates: projects lookup failed", { error: projectsError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  // F323 (AS-227, AS-228, AS-229): a private project the caller cannot see
  // must never surface a candidate task in this picker — see
  // isProjectVisibleToCaller's doc comment in
  // lib/actions/project-visibility.ts. Filtered here (rather than per-task
  // below) so a candidate task from an invisible project is excluded
  // before ever being fetched.
  const visibilityChecks = await Promise.all(
    (allProjects ?? []).map(async (p) => ({
      project: p,
      visible: await isProjectVisibleToCaller(
        admin,
        {
          projectId: p.id,
          visibility: (p.visibility as "workspace" | "private") ?? "workspace",
        },
        user.id,
        membership.role,
      ),
    })),
  );
  const projects = visibilityChecks
    .filter((entry) => entry.visible)
    .map((entry) => entry.project);

  const projectIds = (projects ?? []).map((p) => p.id);

  if (projectIds.length === 0) {
    return { ok: true, data: [] };
  }

  const projectKeyById = new Map((projects ?? []).map((p) => [p.id, p.key]));

  const trimmed = query.trim();

  let candidateQuery = admin
    .from("tasks")
    .select("id, title, status, number, project_id")
    .in("project_id", projectIds)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(DEPENDENCY_CANDIDATE_LIMIT);

  if (trimmed) {
    // AS-262-style key parsing (lib/tasks/task-key.ts's parseTaskKeyQuery,
    // reused rather than a second copy of the same regex/logic) resolves
    // a query that looks like a task key ("PM-142") to an exact
    // project+number match; anything else falls back to a title
    // substring search — matching this feature's "search by key or
    // title" requirement without inventing a second search mechanism
    // (lib/queries/search.ts's searchWorkspaceTasks is Server Component
    // -only and full-text-ranked across a whole workspace, a heavier
    // shape this picker's single project+number-or-title match doesn't
    // need).
    const parsedKey = parseTaskKeyQuery(trimmed);
    const matchedProject = parsedKey
      ? (projects ?? []).find(
          (p) => p.key && p.key.toUpperCase() === parsedKey.projectKey,
        )
      : null;

    if (parsedKey && matchedProject) {
      candidateQuery = candidateQuery
        .eq("project_id", matchedProject.id)
        .eq("number", parsedKey.taskNumber);
    } else {
      candidateQuery = candidateQuery.ilike("title", `%${trimmed}%`);
    }
  }

  const { data: taskRows, error: tasksError } = await candidateQuery;

  if (tasksError) {
    logger.error("getDependencyCandidates: candidate task lookup failed", { error: tasksError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const candidates: DependencyCandidate[] = (taskRows ?? [])
    .filter((row) => !excludedIds.has(row.id))
    .map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status as DependencyCandidate["status"],
      projectKey: projectKeyById.get(row.project_id) ?? "",
      number: row.number,
    }));

  return { ok: true, data: candidates };
}
