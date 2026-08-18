import { getProjectBoardTasks } from "@/lib/queries/tasks";
import { Board } from "@/components/board/board";
import { BoardEmptyState } from "@/components/board/board-empty-state";

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

export default async function ProjectBoardPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
}) {
  const { projectId } = await params;

  const tasks = await getProjectBoardTasks(projectId);

  if (tasks.length === 0) {
    return <BoardEmptyState />;
  }

  return <Board initialTasks={tasks} />;
}
