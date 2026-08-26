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
import { PRIORITY_COLORS, PRIORITY_LABELS, PRIORITY_TEXT_ON_COLOR } from "@/lib/task-colors";
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
  const priority = (task.priority as keyof typeof PRIORITY_COLORS) ?? "none";
  const priorityColor = PRIORITY_COLORS[priority];
  const priorityLabel = PRIORITY_LABELS[priority];
  const priorityTextColor = PRIORITY_TEXT_ON_COLOR[priority];
  const href = `/w/${workspaceSlug}/projects/${task.projectId}/board?taskId=${task.id}`;
  const taskKey = formatTaskKey(task.projectKey, task.number);
  // AS-525: priority is otherwise conveyed by `backgroundColor` alone (the
  // `layout.kind !== "range"` marker below renders no visible text at
  // all), so the priority label is folded into the accessible
  // name/title rather than added as its own visible node -- matching the
  // "fold into the row's title/accessible name" option this feature's
  // own clarification allows as an alternative to an sr-only span.
  const label = taskKey
    ? `${taskKey} ${task.title} (${priorityLabel} priority)`
    : `${task.title} (${priorityLabel} priority)`;

  return (
    <Link
      href={href}
      className={cn(
        // AS-526: `text-white` over a fixed priority hex fails 4.5:1 for
        // urgent/high/low (3.56-3.76:1). The background is the fixed,
        // theme-invariant PRIORITY_COLORS hex, so the text colour must be
        // theme-invariant too -- PRIORITY_TEXT_ON_COLOR (lib/task-colors.ts)
        // picks whichever of black/white clears 4.5:1 for THIS priority
        // (same fix as MAJ-3/FU-G).
        "absolute top-1/2 flex -translate-y-1/2 items-center overflow-hidden text-xs shadow-sm transition-opacity hover:opacity-90",
        layout.kind === "range" ? "h-6 rounded-md px-1.5" : "h-4 w-4 -translate-x-1/2 rounded-full",
        task.isDone && "opacity-60",
      )}
      style={{
        left: `${layout.leftPx}px`,
        width: layout.kind === "range" ? `${layout.widthPx}px` : undefined,
        backgroundColor: priorityColor,
        color: priorityTextColor,
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
