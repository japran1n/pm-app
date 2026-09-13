// Data-fetching for workspace-wide task search (F069: AS-116, AS-118,
// AS-119, AS-120, AS-121, AS-122; hardened by F070 — AS-118, AS-121,
// AS-122).
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
//
// F070 hardening (AS-118): F069 already relied on two independent layers
// to keep results scoped to the active workspace — RLS's
// `projects_select_active_members` (which checks the CALLER's own
// membership row per project, keyed by that project's own `workspace_id`,
// never by name/shape) and the explicit `.eq("workspace_id", workspaceId)`
// filter below. Because both layers filter by `workspace_id` (a foreign
// key), not by project name or structure, a project in another workspace
// that happens to share a name or column layout with a project in the
// active workspace can never satisfy either filter — it has a different
// `workspace_id`, full stop. F070 adds a third, independent layer: an
// explicit server-side re-check (via the tech-decisions.md
// `requireActiveMembership` convention already used by every other
// Server Action/query in this codebase — see lib/actions/tasks.ts,
// projects.ts, comments.ts, attachments.ts) that the calling user is
// actually an active member of `workspaceId` itself, using the admin
// client so this check cannot be silently defeated by a missing/incomplete
// RLS policy. This guards the case the assertion calls out explicitly: a
// caller who is a member of some OTHER, unrelated workspace must not be
// able to search workspace A's tasks by any means — not just because RLS
// happens to filter the projects query correctly.
//
// F070 hardening (AS-121): confirmed at the SQL layer, not just here —
// `search_tasks` (20260818050300_fts_tasks_search_fn.sql) is declared
// `language sql stable` with no `security definer`, so it defaults to
// `security invoker` and runs under the calling role; its own WHERE clause
// also has an explicit `deleted_at is null` predicate, independent of RLS.
// No RPC-side bypass exists to add a redundant filter for, so nothing to
// change in the RPC; this file adds no additional filtering here since the
// RPC already guarantees it twice over (invoker-rights RLS + explicit
// predicate).
//
// F147 (AS-262): "searching for a task key finds that exact task", ranked
// above full-text hits. lib/tasks/task-key.ts's parseTaskKeyQuery (pure,
// no DB access) turns the trimmed query into a candidate
// (projectKey, taskNumber) pair when it looks like a key ("PM-142",
// "pm142", "pm 142" all parse the same way). This function resolves that
// candidate against the SAME already-scoped `projects` list used for the
// full-text loop below — never a second, wider query — so the exact-key
// path inherits the identical workspace-isolation guarantee as every
// other result: a key that exists in another workspace's project can
// never match here, because that project never appears in `projects` in
// the first place (RLS + the explicit `.eq("workspace_id", workspaceId)`
// filter above already exclude it). If a match is found it is prepended,
// de-duplicated against the full-text results (the key is also indexed in
// tasks.search_vector by 20260819064522_task_key_search_fts.sql, so the
// same task can legitimately appear in both sets).

import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { parseTaskKeyQuery } from "@/lib/tasks/task-key";
import type { Database } from "@/lib/supabase/database.types";

type SearchTasksRow = Database["public"]["Tables"]["tasks"]["Row"];

export interface SearchTaskResult {
  id: string;
  title: string;
  // Raw `tasks.status` text — kept for back-compat, but F223 (AS-417)
  // means callers should prefer `statusName`/`statusColor` below: a task
  // whose project column was RENAMED after this task last wrote its own
  // `status` (the sync trigger only fires on a TASK write, never on a
  // `project_statuses` rename — see 20260824010000's
  // sync_task_status_and_status_id doc comment) can have a stale
  // `status` string that no longer matches any of the project's current
  // columns.
  status: string;
  // F223 (AS-417): the task's ACTUAL current column name/colour,
  // resolved via `status_id` against `project_statuses` — the same
  // source lib/queries/statuses.ts's getProjectColumns reads, joined
  // here rather than duplicated. Falls back to the raw `status` text (no
  // colour) for the pre-F218 `status_id is null` edge case, same
  // "no worse than before" posture as `is_done_status`'s own fallback.
  statusName: string;
  statusColor: string | null;
  priority: string;
  projectId: string;
  projectName: string;
  // F146 (AS-258): this result's task-key display fields, combined by
  // lib/tasks/task-key.ts's formatTaskKey into "KEY-NUMBER". `number` is
  // a plain `tasks` column, already returned by `search_tasks` (it
  // `returns setof tasks`, so every column comes back for free); the key
  // is resolved from the same `projects` fetch this function already
  // makes below (for `projectNameById`), never a second query.
  projectKey: string | null;
  number: number;
}

export async function searchWorkspaceTasks(
  workspaceId: string,
  query: string,
): Promise<SearchTaskResult[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  // AS-118/AS-122 (F070 hardening): defense-in-depth re-check that the
  // caller is an active member of the workspace being searched, before
  // touching any project/task data — independent of RLS, so a caller who
  // is only a member of some other, unrelated workspace gets an empty
  // result here rather than relying solely on the projects query below to
  // filter correctly.
  const { supabase, user } = await getCurrentUser();

  if (!user) {
    return [];
  }

  const admin = createAdminClient();
  const membership = await requireActiveMembership(admin, workspaceId, user.id);

  if (!membership.ok) {
    return [];
  }

  // AS-118/AS-122: RLS (`projects_select_active_members`) already scopes
  // this to projects in workspaces the caller is an active member of, and
  // the explicit `.eq("workspace_id", workspaceId)` further narrows to
  // exactly the active workspace — a task belonging to a project in a
  // different workspace can never appear in the per-project RPC calls
  // below because its project id never appears in this list.
  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select("id, name, key")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null);

  if (projectsError) {
    throw projectsError;
  }

  if (!projects || projects.length === 0) {
    return [];
  }

  const projectNameById = new Map(projects.map((p) => [p.id, p.name]));
  // F146 (AS-258): same already-fetched `projects` rows as
  // `projectNameById` above — reused rather than a second query.
  const projectKeyById = new Map(projects.map((p) => [p.id, p.key]));

  // F223 (AS-417): one query for every project's real columns, keyed by
  // `status_id` (globally unique uuid, so a single flat map across every
  // project in this workspace-scoped `projects` list is safe — never
  // merges two different projects' columns). Reuses `project_statuses`'
  // existing select RLS (is_project_visible_to) rather than a new
  // predicate; since `projects` above is already scoped to this
  // workspace + the caller's visibility, this can't leak another
  // workspace's/an invisible project's column names.
  const projectIds = projects.map((p) => p.id);
  const { data: statusRows, error: statusRowsError } = await supabase
    .from("project_statuses")
    .select("id, name, color")
    .in("project_id", projectIds);

  if (statusRowsError) {
    throw statusRowsError;
  }

  const statusById = new Map(
    (statusRows ?? []).map((row) => [row.id, { name: row.name, color: row.color }]),
  );

  const resolveStatus = (statusId: string | null, rawStatus: string) => {
    const resolved = statusId ? statusById.get(statusId) : undefined;
    return {
      statusName: resolved?.name ?? rawStatus,
      statusColor: resolved?.color ?? null,
    };
  };

  // AS-262: resolve an exact task-key match, if the query looks like one,
  // against the workspace-scoped `projects` list already fetched above —
  // see the file-header comment for why this can never cross a workspace
  // boundary. `projects.key` is unique per workspace (F145's
  // `projects_key_unique_per_workspace`), so at most one project can match
  // the parsed key.
  let exactMatch: SearchTaskResult | null = null;
  const parsedKey = parseTaskKeyQuery(trimmed);

  if (parsedKey) {
    const matchedProject = projects.find(
      (p) => p.key && p.key.toUpperCase() === parsedKey.projectKey,
    );

    if (matchedProject) {
      const { data: keyTask, error: keyTaskError } = await supabase
        .from("tasks")
        .select("*")
        .eq("project_id", matchedProject.id)
        .eq("number", parsedKey.taskNumber)
        .is("deleted_at", null)
        .maybeSingle();

      // A lookup error (or simply no row for that number) just means no
      // exact match — it must not abort the rest of the search, which can
      // still return full-text hits for the same query.
      if (!keyTaskError && keyTask) {
        exactMatch = {
          id: keyTask.id,
          title: keyTask.title,
          status: keyTask.status,
          ...resolveStatus(keyTask.status_id, keyTask.status),
          priority: keyTask.priority,
          projectId: keyTask.project_id,
          projectName:
            projectNameById.get(keyTask.project_id) ?? matchedProject.name,
          projectKey:
            projectKeyById.get(keyTask.project_id) ?? matchedProject.key,
          number: keyTask.number,
        };
      }
    }
  }

  // F087 (perf audit item 6): one `search_tasks_multi` RPC for the whole
  // workspace instead of one `search_tasks` RPC per project — see that
  // function's migration (20261027010000_f087_search_tasks_multi_project.sql)
  // for why this is safe to batch (identical ranking/soft-delete/RLS
  // posture to the single-project function, just one `= any(...)`
  // predicate instead of N separate calls).
  const { data: multiData, error: multiError } = await supabase.rpc(
    "search_tasks_multi",
    {
      p_project_ids: projects.map((project) => project.id),
      p_query: trimmed,
    },
  );

  if (multiError) {
    throw multiError;
  }

  const rankedResults: Array<SearchTaskResult & { titleMatches: boolean }> = (
    multiData ?? []
  ).map((task: SearchTasksRow) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    ...resolveStatus(task.status_id, task.status),
    priority: task.priority,
    projectId: task.project_id,
    projectName: projectNameById.get(task.project_id) ?? task.project_id,
    projectKey: projectKeyById.get(task.project_id) ?? null,
    number: task.number,
    titleMatches: task.title.toLowerCase().includes(trimmed.toLowerCase()),
  }));

  const fullTextResults: SearchTaskResult[] = rankedResults
    .sort((a, b) => Number(b.titleMatches) - Number(a.titleMatches))
    .map(({ titleMatches, ...rest }) => {
      void titleMatches;
      return rest;
    });

  if (!exactMatch) {
    return fullTextResults;
  }

  // AS-262: the exact key match ranks first; drop it from the full-text
  // set if it also matched there (it legitimately can, since the key is
  // part of tasks.search_vector too) so it isn't listed twice.
  return [
    exactMatch,
    ...fullTextResults.filter((result) => result.id !== exactMatch.id),
  ];
}
