import { createClient } from "@/lib/supabase/server";
import { getProjectBoardTasks } from "@/lib/queries/tasks";
import { getWorkspaceMembers } from "@/lib/queries/members";
import { getCurrentUserTimezone } from "@/lib/queries/profile";
import { getWorkspaceTaskTemplateOptions } from "@/lib/queries/templates";
import { Board } from "@/components/board/board";
import { BoardEmptyState } from "@/components/board/board-empty-state";
import type { UserAvatarPerson } from "@/components/user-avatar";

// F042 (AS-067, AS-068): the real Board view — supersedes the F030/F032
// placeholder that always rendered BoardEmptyState. Fetches all non-deleted
// tasks for this project (getProjectBoardTasks, lib/queries/tasks.ts,
// ordered by position ascending) and buckets them into exactly 4 fixed
// columns, in a fixed left-to-right order: To Do, In Progress, In Review,
// Done (AS-067). Each column only shows tasks whose status matches that
// column, scoped to this project by the query's `project_id` filter
// (AS-068).
//
// Server Component per the clarified spec ("Server Component for
// data-fetching, thin Client Component only for the interactive part") —
// data fetching stays server-side, and the primary content is
// server-rendered in the initial HTML (AS-155). Everything interactive
// (F043's drag-and-drop: DndContext, sensors, DragOverlay) is delegated to
// <Board>, the thin Client Component boundary, which receives the
// server-fetched tasks as its initial state.
//
// Access relies on the project detail layout's guard one level up
// (workspace membership, F010/F023) plus getProjectById's cross-workspace
// 404 handling — no duplicate page-level gate here.
//
// Whole-board empty state (F032/AS-041): when the project has zero tasks
// across every status, the page renders the shared BoardEmptyState instead
// of an empty <Board> — reusing the component exactly as F032's own
// comment anticipated, rather than duplicating its markup.
//
// Task-creation fix: both BoardEmptyState and Board now need a real "New
// Task" trigger (<NewTaskDialog>), which needs the current workspace's
// active members as assignee options — resolved here the same way
// list/page.tsx already does (workspace looked up from `workspaceSlug`,
// then getWorkspaceMembers, same RLS-scoped pattern as the members page).
export default async function ProjectBoardPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
}) {
  const { workspaceSlug, projectId } = await params;

  const supabase = await createClient();

  // F124 (AS-207): the viewer's timezone is resolved ONCE per request here
  // (lib/queries/profile.ts's getCurrentUserTimezone) and threaded down to
  // <Board> as a prop — never re-queried per card. Run alongside the other
  // independent fetches below rather than sequentially awaited.
  const [tasks, workspaceResult, timezone] = await Promise.all([
    getProjectBoardTasks(projectId),
    supabase.from("workspaces").select("id").eq("slug", workspaceSlug).maybeSingle(),
    getCurrentUserTimezone(supabase),
  ]);
  const { data: workspace } = workspaceResult;

  const workspaceMembers = workspace
    ? await getWorkspaceMembers(workspace.id)
    : { active: [], pending: [] };

  // F183 (AS-330 UI half): task templates available for "New from
  // template" — resolved once here, same fetch-and-pass-down pattern as
  // assigneeOptions above.
  const templates = workspace
    ? await getWorkspaceTaskTemplateOptions(workspace.id)
    : [];

  const assigneeOptions = workspaceMembers.active.map((member) => ({
    id: member.userId,
    label: member.name ?? member.email ?? member.userId,
    avatarUrl: member.avatarUrl,
  }));

  // BUGFIX: TaskDetailSheet's assignee Select needs the full members list
  // (TaskDetailSheetMember shape), not just the New Task dialog's
  // narrower `{ id, label }` assignee options — resolved once here via
  // the same getWorkspaceMembers call already made above.
  const detailSheetMembers = workspaceMembers.active.map((member) => ({
    userId: member.userId,
    email: member.email,
    name: member.name,
    avatarUrl: member.avatarUrl,
  }));

  // F122 (AS-214): every valid assignee is, by construction, an active
  // workspace member (assignTask/lib/actions/tasks.ts only accepts an
  // active member's id) — so the board's per-card avatars are built
  // directly from the `workspaceMembers` fetch already made above,
  // instead of a second query. taskAssigneeId -> resolved person.
  const assignees = new Map<string, UserAvatarPerson>(
    workspaceMembers.active.map((member) => [
      member.userId,
      {
        id: member.userId,
        name: member.name,
        email: member.email,
        avatarUrl: member.avatarUrl,
      },
    ]),
  );

  if (tasks.length === 0) {
    return (
      <BoardEmptyState
        projectId={projectId}
        assigneeOptions={assigneeOptions}
        templates={templates}
      />
    );
  }

  return (
    <Board
      projectId={projectId}
      initialTasks={tasks}
      assigneeOptions={assigneeOptions}
      members={detailSheetMembers}
      assignees={assignees}
      timezone={timezone}
      templates={templates}
    />
  );
}
