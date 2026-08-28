"use server";
import { logger } from "@/lib/observability/logger";


// F242 (AS-460, AS-461, AS-466): the command palette's search Server
// Action — searches projects, tasks, and members in one workspace and
// returns them grouped by type (AS-460). AS-461 (selecting a result
// navigates to it) and AS-466 (empty state) are satisfied entirely by the
// client component (components/command/command-palette.tsx) rendering
// this function's result; this file's job is only to produce a
// visibility-correct, deduplicated, capped result set.
//
// Reuse, not duplication:
//   - Tasks: delegates to `searchWorkspaceTasks` (lib/queries/search.ts),
//     the SAME function the full Search page uses (F069/F070/F146/F147/
//     F223) — this file adds no second task-search implementation. That
//     function already re-checks active workspace membership
//     (F070/AS-118/AS-122) and resolves the F147 task-key exact match, so
//     typing "PM-142" into the palette finds that task first, exactly
//     like the search page.
//   - Members: delegates to `getWorkspaceMembers` (lib/queries/
//     members.ts), the SAME function the Members page uses, then filters
//     client-side... no: filters HERE, server-side, by name/email
//     substring match (F017's query has no filter of its own since the
//     full members page shows everyone). Reusing it means member name/
//     avatar resolution logic (F120/F122's `resolvePeople`) is never
//     duplicated.
//
// Visibility (this mission's repeated privilege-escalation bug class —
// F322/F323/M16's task_dependencies fix): every query below runs through
// the plain RLS-scoped session client (`createClient()`), never
// `createAdminClient()`. `searchWorkspaceTasks` already proves this for
// tasks (see that file's own header comment: `tasks_select_active_members`
// / `is_project_visible_to` enforce private-project visibility with no
// admin-client bypass to re-check). The projects query below uses the
// same session client, so `projects_select_active_members`'s identical
// `is_project_visible_to` predicate applies to it too — a private project
// the caller cannot see can never be returned by either query. Members
// are workspace-level (not project-scoped), so there is no private-project
// concept to leak there; `workspace_members_select_fellow_members` already
// scopes that read to fellow active members of the SAME workspace only.
//
// Archived projects (`projects.deleted_at`) and trashed tasks
// (`tasks.deleted_at`): excluded exactly like `lib/queries/my-tasks.ts`
// and `lib/queries/calendar.ts` — an explicit `.is("deleted_at", null)` on
// the projects query here, and `searchWorkspaceTasks`/`search_tasks`
// already exclude trashed tasks (see that file's own comments).
//
// Performance: three queries total (projects, tasks via
// `searchWorkspaceTasks`'s existing N=project-count RPC fan-out, members),
// none of them per-result-row — no N+1. Each group is capped at
// PALETTE_RESULT_CAP_PER_GROUP client-visible rows so a broad query
// doesn't render an unbounded list.
//
// Debounce/cancel of fast typing lives in the CLIENT component (an
// AbortController-free "only the latest call's result wins" guard,
// keyed by a request id) — this Server Action itself is stateless and
// simply answers whatever request it receives; ordering is the caller's
// responsibility, matching how every other debounced Server Action call
// in this codebase works (there is no queue/cancellation primitive on the
// server side for Server Actions).

import { createClient } from "@/lib/supabase/server";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { createAdminClient } from "@/lib/supabase/admin";
import { searchWorkspaceTasks } from "@/lib/queries/search";
import { getWorkspaceMembers } from "@/lib/queries/members";
import {
  PALETTE_RESULT_CAP_PER_GROUP,
  RECENT_ITEMS_CAP,
  type PaletteMemberResult,
  type PaletteProjectResult,
  type PaletteSearchResults,
  type PaletteTaskResult,
  type RecentItemPointer,
  type ResolvedRecentItems,
} from "@/lib/palette/palette-search-types";

export async function searchPalette(
  workspaceId: string,
  query: string,
): Promise<PaletteSearchResults> {
  const trimmed = query.trim();
  const empty: PaletteSearchResults = { projects: [], tasks: [], members: [] };

  if (!trimmed) {
    return empty;
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return empty;
  }

  // AS-460/visibility: defense-in-depth re-check, same convention as
  // `searchWorkspaceTasks`'s own F070 hardening — a caller who is only a
  // member of some OTHER, unrelated workspace gets nothing back here
  // rather than relying solely on RLS to filter every query below
  // correctly.
  const admin = createAdminClient();
  const membership = await requireActiveMembership(admin, workspaceId, user.id);

  if (!membership.ok) {
    return empty;
  }

  const likePattern = `%${trimmed.replace(/[%_]/g, "\\$&")}%`;

  const [projectsResult, tasks, members] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, key")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .ilike("name", likePattern)
      .limit(PALETTE_RESULT_CAP_PER_GROUP),
    searchWorkspaceTasks(workspaceId, trimmed),
    getWorkspaceMembers(workspaceId),
  ]);

  if (projectsResult.error) {
    throw projectsResult.error;
  }

  const projects: PaletteProjectResult[] = (projectsResult.data ?? []).map(
    (p) => ({ type: "project" as const, id: p.id, name: p.name, key: p.key }),
  );

  const cappedTasks: PaletteTaskResult[] = tasks
    .slice(0, PALETTE_RESULT_CAP_PER_GROUP)
    .map((t) => ({
      type: "task" as const,
      id: t.id,
      title: t.title,
      projectId: t.projectId,
      projectName: t.projectName,
      projectKey: t.projectKey,
      number: t.number,
    }));

  const needle = trimmed.toLowerCase();
  const matchedMembers: PaletteMemberResult[] = members.active
    .filter(
      (m) =>
        (m.name && m.name.toLowerCase().includes(needle)) ||
        (m.email && m.email.toLowerCase().includes(needle)),
    )
    .slice(0, PALETTE_RESULT_CAP_PER_GROUP)
    .map((m) => ({
      type: "member" as const,
      userId: m.userId,
      name: m.name,
      email: m.email,
      avatarUrl: m.avatarUrl,
    }));

  return { projects, tasks: cappedTasks, members: matchedMembers };
}

// F243 (AS-465): resolve a client-stored list of "recently visited"
// project/task pointers (lib/hooks/use-recent-items.ts) against the
// caller's CURRENT visibility, rather than trusting what localStorage
// remembers. Same "dangling reference degrades gracefully" convention
// lib/views/resolve-view.ts (F229) documents: a pointer naming a project
// the caller has since lost access to (removed from the project, the
// project made private, the project archived/trashed) is silently
// DROPPED from the result — never surfaced as an error, and critically
// never distinguished from "never existed" so the response can't be used
// to probe for a resource's existence.
//
// Enforcement mechanism is identical to `searchPalette` above: every read
// goes through the plain RLS-scoped session client (`createClient()`,
// never `createAdminClient()`), so `projects_select_active_members` /
// `tasks_select_active_members`'s `is_project_visible_to` predicate is
// the actual visibility boundary — a pointer this query doesn't return a
// row for is exactly a pointer this caller can no longer see, resolved
// fresh on every call rather than cached.
export async function resolveRecentItems(
  workspaceId: string,
  pointers: RecentItemPointer[],
): Promise<ResolvedRecentItems> {
  const empty: ResolvedRecentItems = { projects: [], tasks: [] };

  if (pointers.length === 0) {
    return empty;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return empty;
  }

  const admin = createAdminClient();
  const membership = await requireActiveMembership(admin, workspaceId, user.id);

  if (!membership.ok) {
    return empty;
  }

  // Most-recently-visited first, deduplicated by (type, id), capped —
  // mirrors PALETTE_RESULT_CAP_PER_GROUP's "no unbounded list" convention.
  const seen = new Set<string>();
  const projectIds: string[] = [];
  const taskIds: string[] = [];

  for (const pointer of [...pointers].sort((a, b) => b.visitedAt - a.visitedAt)) {
    const key = `${pointer.type}:${pointer.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (pointer.type === "project" && projectIds.length < RECENT_ITEMS_CAP) {
      projectIds.push(pointer.id);
    } else if (pointer.type === "task" && taskIds.length < RECENT_ITEMS_CAP) {
      taskIds.push(pointer.id);
    }
  }

  const [projectsResult, tasksResult] = await Promise.all([
    projectIds.length > 0
      ? supabase
          .from("projects")
          .select("id, name, key")
          .eq("workspace_id", workspaceId)
          .is("deleted_at", null)
          .in("id", projectIds)
      : Promise.resolve({ data: [], error: null }),
    taskIds.length > 0
      ? supabase
          .from("tasks")
          .select(
            "id, title, number, project_id, projects!inner(name, key, workspace_id, deleted_at)",
          )
          .eq("projects.workspace_id", workspaceId)
          .is("deleted_at", null)
          .is("projects.deleted_at", null)
          .in("id", taskIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (projectsResult.error) {
    logger.error("resolveRecentItems: project read failed", { error: projectsResult.error });
  }
  if (tasksResult.error) {
    logger.error("resolveRecentItems: task read failed", { error: tasksResult.error });
  }

  // Re-order resolved rows back to most-recently-visited-first (the `.in()`
  // queries above don't preserve pointer order) so recents render in visit
  // order, not database order.
  const projectOrder = new Map(projectIds.map((id, index) => [id, index]));
  const taskOrder = new Map(taskIds.map((id, index) => [id, index]));

  const projects: PaletteProjectResult[] = (projectsResult.data ?? [])
    .map((p) => ({ type: "project" as const, id: p.id, name: p.name, key: p.key }))
    .sort(
      (a, b) => (projectOrder.get(a.id) ?? 0) - (projectOrder.get(b.id) ?? 0),
    );

  type ResolvedTaskRow = {
    id: string;
    title: string;
    number: number;
    project_id: string;
    projects: { name: string; key: string | null } | { name: string; key: string | null }[] | null;
  };

  const tasks: PaletteTaskResult[] = ((tasksResult.data ?? []) as ResolvedTaskRow[])
    .map((t) => {
      const project = Array.isArray(t.projects) ? t.projects[0] : t.projects;
      return {
        type: "task" as const,
        id: t.id,
        title: t.title,
        projectId: t.project_id,
        projectName: project?.name ?? "",
        projectKey: project?.key ?? null,
        number: t.number,
      };
    })
    .sort((a, b) => (taskOrder.get(a.id) ?? 0) - (taskOrder.get(b.id) ?? 0));

  return { projects, tasks };
}
