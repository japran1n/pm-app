// F237 (AS-451, AS-452): a single task's bar/marker, absolutely
// positioned inside its row's `<TimelineRowTrack>` via the pure layout
// maths in lib/timeline/layout.ts. Server Component -- clicking through
// to the task's own detail sheet is a plain `<Link>` to the
// `?taskId=`-deep-linked board route (the same click-through pattern
// components/calendar/agenda-list.tsx already established for the same
// "one real detail surface, many entry points" reason), so this feature
// needs no client boundary of its own (drag-resize is F238's own,
// separate Client Component seam -- see that feature's spec).

import Link from "next/link";

import type { TimelineBarLayout } from "@/lib/timeline/layout";
import type { TimelineTask } from "@/lib/queries/timeline";
import { formatTaskKey } from "@/lib/tasks/task-key";
import { PRIORITY_COLORS } from "@/lib/task-colors";
import { cn } from "@/lib/utils";

export function TimelineBar({
  task,
  layout,
  workspaceSlug,
}: {
  task: TimelineTask;
  layout: TimelineBarLayout;
  workspaceSlug: string;
}) {
  const priorityColor = PRIORITY_COLORS[(task.priority as keyof typeof PRIORITY_COLORS) ?? "none"];
  const href = `/w/${workspaceSlug}/projects/${task.projectId}/board?taskId=${task.id}`;
  const taskKey = formatTaskKey(task.projectKey, task.number);
  const label = taskKey ? `${taskKey} ${task.title}` : task.title;

  return (
    <Link
      href={href}
      className={cn(
        "absolute top-1/2 flex -translate-y-1/2 items-center overflow-hidden text-xs text-white shadow-sm transition-opacity hover:opacity-90",
        layout.kind === "range" ? "h-6 rounded-md px-1.5" : "h-4 w-4 -translate-x-1/2 rounded-full",
        task.isDone && "opacity-60",
      )}
      style={{
        left: `${layout.leftPx}px`,
        width: layout.kind === "range" ? `${layout.widthPx}px` : undefined,
        backgroundColor: priorityColor,
      }}
      data-testid={layout.kind === "range" ? "timeline-bar" : "timeline-marker"}
      data-task-id={task.id}
      title={label}
      aria-label={label}
    >
      {layout.kind === "range" ? <span className="truncate">{task.title}</span> : null}
    </Link>
  );
}
