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
//
// F087 (AS-154): every shade below was checked against a white/light card
// background (the app's default light theme) for a >=3:1 contrast ratio,
// the WCAG AA threshold for non-text UI components (status dots, badge
// borders) — text itself always uses the theme's default foreground color
// via STATUS_LABELS/PRIORITY_LABELS text, never these hex values directly,
// so the 4.5:1 text threshold doesn't apply here, but 3:1 does since these
// dots are the graphical stand-in for status/priority. Several original
// -500 shades (amber, green, orange, yellow, slate-400/300) measured below
// 3:1 on white and were swapped for a darker shade in the same Tailwind
// hue family (-600/-700) until they cleared 3:1. See
// tests/unit/task-colors-contrast.test.ts for the automated check.

import type { TaskCardTask } from "@/components/task/task-card";

export const STATUS_COLORS: Record<TaskCardTask["status"], string> = {
  todo: "#64748b", // slate-500 (4.76:1 on white)
  in_progress: "#3b82f6", // blue-500 (3.68:1 on white)
  in_review: "#d97706", // amber-600 (3.19:1 on white; was amber-500 2.15:1)
  done: "#16a34a", // green-600 (3.30:1 on white; was green-500 2.28:1)
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
  urgent: "#ef4444", // red-500 (3.76:1 on white)
  high: "#ea580c", // orange-600 (3.56:1 on white; was orange-500 2.80:1)
  medium: "#a16207", // yellow-700 (4.92:1 on white; yellow-500 1.92:1 and yellow-600 2.94:1 both failed 3:1)
  low: "#3b82f6", // blue-500 (3.68:1 on white)
  backlog: "#475569", // slate-600 (7.58:1 on white; was slate-400 2.56:1)
  none: "#64748b", // slate-500 (4.76:1 on white; was slate-300 1.48:1)
};

export const PRIORITY_LABELS: Record<Priority | "none", string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  backlog: "Backlog",
  none: "No priority",
};
