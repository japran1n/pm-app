// Data-fetching for workspace-wide task search (F069: AS-116, AS-118,
// AS-119, AS-120, AS-121, AS-122).
//
// F068 (supabase/migrations/20260818050300_fts_tasks_search_fn.sql) exposes
// a `search_tasks(p_project_id uuid, p_query text)` RPC that already does
// the ranked, case-insensitive, soft-delete-excluding full-text match
// (AS-117, AS-121, AS-123, AS-124) — but it is scoped to a single project,
// not a workspace. There is no workspace-wide search RPC yet, so this
// function resolves every non-deleted project in the target workspace
// first (RLS's `projects_select_active_members` already scopes that to
// projects the caller can see, i.e. AS-118/AS-122's workspace boundary),
// then calls `search_tasks` once per project and concatenates results.
//
// This keeps the ranking/soft-delete/case-insensitivity logic in the one
// place F068 already put it (the SQL function) rather than duplicating a
// hand-rolled `.textSearch()` query here. A workspace typically has a
// small number of projects, so N RPC calls (N = project count) is an
// acceptable tradeoff for reusing F068's tested ranking behavior; a true
// workspace-scoped `search_tasks_in_workspace` RPC would be a reasonable
// follow-up if project counts grow large.
//
// Results across projects are merged and re-sorted by title-match-first
// (a task whose title matches the query ranks before one that only
// matches in its description) as a best-effort cross-project ordering —
// F069 is not assigned AS-124 (that's verified against the single-project
// RPC directly in F068's own test), so this is a simple, not exhaustive,
// merge order.

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

type SearchTasksRow = Database["public"]["Tables"]["tasks"]["Row"];

export interface SearchTaskResult {
  id: string;
  title: string;
  status: string;
  priority: string;
  projectId: string;
  projectName: string;
}

export async function searchWorkspaceTasks(
  workspaceId: string,
  query: string,
): Promise<SearchTaskResult[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const supabase = await createClient();

  // AS-118/AS-122: RLS (`projects_select_active_members`) already scopes
  // this to projects in workspaces the caller is an active member of, and
  // the explicit `.eq("workspace_id", workspaceId)` further narrows to
  // exactly the active workspace — a task belonging to a project in a
  // different workspace can never appear in the per-project RPC calls
  // below because its project id never appears in this list.
  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null);

  if (projectsError) {
    throw projectsError;
  }

  if (!projects || projects.length === 0) {
    return [];
  }

  const projectNameById = new Map(projects.map((p) => [p.id, p.name]));

  const resultsPerProject = await Promise.all(
    projects.map(async (project) => {
      const { data, error } = await supabase.rpc("search_tasks", {
        p_project_id: project.id,
        p_query: trimmed,
      });

      if (error) {
        throw error;
      }

      return (data ?? []).map((task: SearchTasksRow) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        projectId: task.project_id,
        projectName: projectNameById.get(task.project_id) ?? project.name,
        titleMatches: task.title
          .toLowerCase()
          .includes(trimmed.toLowerCase()),
      }));
    }),
  );

  return resultsPerProject
    .flat()
    .sort((a, b) => Number(b.titleMatches) - Number(a.titleMatches))
    .map(({ titleMatches: _titleMatches, ...rest }) => rest);
}
