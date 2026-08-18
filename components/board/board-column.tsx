// F042 (AS-067, AS-068): one fixed column of the Kanban board — a header
// (status label + count) plus the tasks in that status, rendered via the
// shared TaskCard (F040). Render-only: no drag-and-drop yet (F043+), so
// this is a plain Server Component, matching the clarified spec's "Server
// Component for data-fetching, thin Client Component only for the
// interactive part" — there is no interactive part here yet.
//
// Per-column empty state: a column with zero tasks (but the project has
// tasks elsewhere) still needs *some* explicit "nothing here" treatment so
// the board doesn't render a mysterious blank space — a lightweight inline
// message rather than the full BoardEmptyState (which is reserved for the
// whole-board "this project has zero tasks anywhere" case per F032/AS-041,
// composed once at the page level instead).

import { TaskCard, type TaskCardTask } from "@/components/task/task-card";

const COLUMN_LABELS: Record<TaskCardTask["status"], string> = {
  todo: "To Do",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
};

export function BoardColumn({
  status,
  tasks,
}: {
  status: TaskCardTask["status"];
  tasks: TaskCardTask[];
}) {
  return (
    <div
      className="flex min-w-64 flex-1 flex-col gap-3 rounded-lg bg-muted/40 p-3"
      data-status={status}
    >
      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-medium">{COLUMN_LABELS[status]}</h2>
        <span className="text-xs text-muted-foreground">{tasks.length}</span>
      </div>

      <div className="flex flex-col gap-2">
        {tasks.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
            No tasks
          </p>
        ) : (
          tasks.map((task) => <TaskCard key={task.id} task={task} />)
        )}
      </div>
    </div>
  );
}
