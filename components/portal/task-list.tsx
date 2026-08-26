import Link from "next/link";

import type {
  PortalProject,
  PortalTask,
  StatusCategory,
} from "@/lib/queries/portal";

function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

// Tasks are grouped by the *name* of the board column they sit in, so the
// client sees the team's own vocabulary ("In review", "Blocked") rather
// than a translated set of generic buckets. The groups are then ordered by
// category — in progress first, then not started, then done — because
// "what is happening now" is the question a client opens this page to
// answer, and finished work reads as history.
const CATEGORY_RANK: Record<StatusCategory, number> = {
  in_progress: 0,
  not_started: 1,
  done: 2,
};

type TaskGroup = {
  statusName: string;
  category: StatusCategory;
  tasks: PortalTask[];
};

function groupTasks(project: PortalProject): TaskGroup[] {
  const groups = new Map<string, TaskGroup>();

  for (const task of project.tasks) {
    const existing = groups.get(task.status);
    if (existing) {
      existing.tasks.push(task);
    } else {
      groups.set(task.status, {
        statusName: task.status,
        category: task.category,
        tasks: [task],
      });
    }
  }

  return [...groups.values()].sort(
    (a, b) => CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category],
  );
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export function PortalTaskList({
  project,
  workspaceSlug,
}: {
  project: PortalProject;
  workspaceSlug: string;
}) {
  const groups = groupTasks(project);
  const today = todayIso();

  if (project.tasks.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-8 text-center">
        <p className="text-sm font-medium">Nothing shared yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          The team has not shared any items from this project with you.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-medium tracking-tight">Shared with you</h2>

      {groups.map(({ statusName, tasks }) => (
        <section key={statusName} className="flex flex-col gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {statusName.replace(/_/g, " ")} ({tasks.length})
          </h3>

          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {tasks.map((task) => {
              // Only unfinished work can be late. A delivered task keeps
              // its date as plain history.
              const overdue = Boolean(
                task.category !== "done" && task.dueDate && task.dueDate < today,
              );
              return (
                <li key={task.id}>
                  <Link
                    href={`/portal/${workspaceSlug}/t/${task.id}`}
                    className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/40"
                  >
                    <span className="text-sm">{task.title}</span>
                    {task.dueDate && (
                      <span
                        className={
                          overdue
                            ? "shrink-0 text-xs font-medium text-destructive"
                            : "shrink-0 text-xs text-muted-foreground"
                        }
                      >
                        {formatDate(task.dueDate)}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
