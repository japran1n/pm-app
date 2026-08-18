// F073 (AS-135): single source of truth for status/priority color coding.
//
// Before this file, no status/priority color-coding existed anywhere in
// the app — board columns (components/board/board-column.tsx) render
// status as plain text labels with no color, and the priority badge in
// task-card.tsx uses `variant="secondary"` (a single neutral shadcn
// variant) with no per-priority color. AS-135 requires the new dashboard
// charts to be "consistent with the status/priority color coding used
// elsewhere in the app," so this constant is introduced as *the*
// definition of that color coding, and both the dashboard charts and the
// existing priority badge are wired to reference it (see task-card.tsx),
// rather than the charts inventing colors nothing else agrees with.
//
// Values are plain hex so they work identically as:
//   - Tailwind arbitrary-value classes (bg-[var]) is unnecessary here —
//     Recharts wants direct color strings via the `fill`/`stroke` props,
//     not class names, so hex is the common denominator with the badge
//     (which uses inline `style` for the same reason: shadcn's Badge
//     `variant` prop only ships neutral/destructive/outline variants,
//     none of which map to five distinct priority hues or four distinct
//     status hues).
//
// Colors are chosen for light/dark-mode legibility and rough semantic
// convention (red = urgent/blocked-feeling, green = done, gray = backlog).

import type { TaskCardTask } from "@/components/task/task-card";

export const STATUS_COLORS: Record<TaskCardTask["status"], string> = {
  todo: "#64748b", // slate-500
  in_progress: "#3b82f6", // blue-500
  in_review: "#f59e0b", // amber-500
  done: "#22c55e", // green-500
};

export const STATUS_LABELS: Record<TaskCardTask["status"], string> = {
  todo: "To Do",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
};

// Priority is nullable on the task row (see F071 handoff notes); "no
// priority" gets its own bucket/color so a chart never has to drop a row
// or misrepresent it as belonging to a fixed priority.
type Priority = NonNullable<TaskCardTask["priority"]>;

export const PRIORITY_COLORS: Record<Priority | "none", string> = {
  urgent: "#ef4444", // red-500
  high: "#f97316", // orange-500
  medium: "#eab308", // yellow-500
  low: "#3b82f6", // blue-500
  backlog: "#94a3b8", // slate-400
  none: "#cbd5e1", // slate-300
};

export const PRIORITY_LABELS: Record<Priority | "none", string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  backlog: "Backlog",
  none: "No priority",
};
