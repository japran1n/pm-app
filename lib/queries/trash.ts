// F188 (AS-343, AS-347, AS-352): data-fetching for the workspace trash
// view — deleted tasks and deleted comments, newest first, with origin
// project, deleter, and time.
//
// Uses the normal RLS-respecting client, not the admin client, for the
// two row queries below — this is the actual AS-352 enforcement boundary.
// `tasks_select_trash_visible_members` / `comments_select_trash_visible_
// members` (supabase/migrations/20260822200000_trash_deleted_by.sql) call
// the exact same `is_project_visible_to`/`is_task_visible_to` functions
// the LIVE-row select policies call, so a private project's deleted rows
// are invisible to a caller who isn't a member of that project for
// exactly the same reason its live rows already are — no parallel
// visibility rule is written here or anywhere else in this file. The
// admin client is only used afterward, to batch-resolve display names
// (project name, deleter name) for rows the RLS-scoped query already
// returned — same "admin client resolves display values for
// already-permitted rows" justification `resolvePeople` itself documents.
//
// Performance (this feature's inherited "no N+1 queries per row" budget):
// one query for deleted tasks, one for deleted comments (each already
// joins its owning project/task via a single embedded select), plus one
// batched `resolvePeople` call covering every distinct deleter id across
// both result sets — never a per-row lookup.

import { createClient } from "@/lib/supabase/server";
import { resolvePeople } from "@/lib/queries/people";

export type TrashItemType = "task" | "comment";

export interface TrashItem {
  id: string;
  type: TrashItemType;
  // What was deleted — a task's title, or a comment's leading text
  // (truncated) since comments have no title of their own.
  label: string;
  projectId: string;
  projectName: string;
  projectKey: string;
  // Only present for a task-type row (F146/AS-258's "KEY-number" format);
  // null for a comment row, whose parent task the comment doesn't
  // duplicate here (a comment isn't independently browsable — this view
  // doesn't attempt to render "on task PM-142", since AS-347 only asks
  // for "what was deleted, by whom, and when", not full provenance).
  taskKey: string | null;
  deletedAt: string;
  deletedByName: string | null;
}

// Workspace-scoped by construction (AS-352): both queries below filter on
// `projects.workspace_id = workspaceId` via the embedded `projects!inner`
// join, so a row from another workspace can never appear here regardless
// of what RLS alone would allow — the same "explicit filter even though
// RLS also enforces it" convention `getWorkspaceProjects`'s own doc
// comment documents.
export async function getWorkspaceTrash(
  workspaceId: string,
): Promise<TrashItem[]> {
  const supabase = await createClient();

  const [tasksResult, commentsResult] = await Promise.all([
    supabase
      .from("tasks")
      .select(
        "id, title, deleted_at, deleted_by, number, projects!inner(id, name, key, workspace_id)",
      )
      .eq("projects.workspace_id", workspaceId)
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .returns<
        {
          id: string;
          title: string;
          deleted_at: string | null;
          deleted_by: string | null;
          number: number;
          projects: { id: string; name: string; key: string; workspace_id: string } | null;
        }[]
      >(),
    // Note: filtering on a two-level-nested embedded column
    // ("tasks.projects.workspace_id") is not reliably supported by
    // PostgREST's dot-path filter syntax the way the single-level
    // "projects.workspace_id" filter above is — rather than depend on
    // that, every returned row is filtered to this workspace explicitly
    // in JS below (`project.workspace_id === workspaceId`), which is
    // correct regardless of what the nested filter would have done. RLS
    // (`comments_select_trash_visible_members`) still bounds the result
    // set to rows visible to the caller before this filter ever runs.
    supabase
      .from("comments")
      .select(
        "id, text, deleted_at, deleted_by, tasks!inner(id, project_id, projects!inner(id, name, key, workspace_id))",
      )
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .returns<
        {
          id: string;
          text: string;
          deleted_at: string | null;
          deleted_by: string | null;
          tasks: {
            id: string;
            project_id: string;
            projects: { id: string; name: string; key: string; workspace_id: string } | null;
          } | null;
        }[]
      >(),
  ]);

  if (tasksResult.error) {
    console.error("getWorkspaceTrash: tasks fetch failed:", tasksResult.error);
  }
  if (commentsResult.error) {
    console.error(
      "getWorkspaceTrash: comments fetch failed:",
      commentsResult.error,
    );
  }

  const taskRows = tasksResult.data ?? [];
  const commentRows = commentsResult.data ?? [];

  const deleterIds = new Set<string>();
  for (const row of taskRows) {
    if (row.deleted_by) deleterIds.add(row.deleted_by);
  }
  for (const row of commentRows) {
    if (row.deleted_by) deleterIds.add(row.deleted_by);
  }

  const people =
    deleterIds.size > 0 ? await resolvePeople([...deleterIds]) : new Map();

  const items: TrashItem[] = [];

  for (const row of taskRows) {
    if (!row.deleted_at || !row.projects) continue;
    // AS-352 (workspace scope): explicit JS-side re-check, defense in
    // depth alongside the `.eq("projects.workspace_id", ...)` filter
    // above.
    if (row.projects.workspace_id !== workspaceId) continue;
    items.push({
      id: row.id,
      type: "task",
      label: row.title,
      projectId: row.projects.id,
      projectName: row.projects.name,
      projectKey: row.projects.key,
      taskKey: `${row.projects.key}-${row.number}`,
      deletedAt: row.deleted_at,
      deletedByName: row.deleted_by
        ? (people.get(row.deleted_by)?.name ??
          people.get(row.deleted_by)?.email ??
          null)
        : null,
    });
  }

  for (const row of commentRows) {
    if (!row.deleted_at || !row.tasks?.projects) continue;
    const project = row.tasks.projects;
    // AS-352 (workspace scope): explicit JS-side filter, see the query's
    // own comment above for why this isn't done as a nested PostgREST
    // dot-path filter.
    if (project.workspace_id !== workspaceId) continue;
    // No dedicated title on a comment — the leading text (truncated) is
    // shown instead so the trash row is still identifiable, per this
    // feature's AS-347 ("what was deleted"). Truncated client-side-safe
    // here (server component, but the same string reaches the client
    // either way) so a very long comment doesn't blow out the row.
    const trimmed = row.text.trim();
    const label =
      trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed || "(empty comment)";
    items.push({
      id: row.id,
      type: "comment",
      label,
      projectId: project.id,
      projectName: project.name,
      projectKey: project.key,
      taskKey: null,
      deletedAt: row.deleted_at,
      deletedByName: row.deleted_by
        ? (people.get(row.deleted_by)?.name ??
          people.get(row.deleted_by)?.email ??
          null)
        : null,
    });
  }

  // Newest-first across BOTH types combined (per this feature's spec: "a
  // list of deleted tasks AND comments, newest-first" — not two separately
  // sorted lists), since the two queries above are already individually
  // sorted but merged here.
  items.sort(
    (a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime(),
  );

  return items;
}
