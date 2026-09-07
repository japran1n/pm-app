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
//
// F269 (AS-526): re-checked every value above against the DARK theme's
// card background (oklch(0.205 0 0), ~#1f1f1f) too, since these are fixed
// hex values that render unchanged in both themes. Every value already
// cleared 3:1 on dark except PRIORITY_COLORS.backlog (slate-600, 2.18:1
// on dark) — swapped for zinc-500 (see that entry's own comment). All
// other STATUS_COLORS/PRIORITY_COLORS values pass 3:1 on both light and
// dark without a change.

import type { TaskCardTask } from "@/components/task/task-card";

export const STATUS_COLORS: Record<TaskCardTask["status"], string> = {
  todo: "#64748b", // slate-500 (4.76:1 on white)
  in_progress: "#3b82f6", // blue-500 (3.68:1 on white)
  // F338 (M18 scrutiny MAJ-3/FU-G, AS-526): every dot using this map
  // renders inside `<Badge variant="secondary">`
  // (task-card.tsx/subtask-list.tsx/dependencies.tsx/bulk-status-action.tsx/
  // search/page.tsx), i.e. on `--secondary` (#f4f4f5 light / #262626
  // dark), NOT directly on `--card` as this file's header comment
  // originally assumed. Amber-600 measures only 2.90:1 there (fails
  // 3:1) even though it cleared 3:1 against white/dark-card. Amber-700
  // clears both real surfaces: 4.57:1 light, 3.01:1 dark. See
  // tests/unit/task-colors-contrast.test.ts.
  in_review: "#b45309", // amber-700 (4.57:1 on --secondary light, 3.01:1 dark; was amber-600 2.90:1 on the real surface)
  done: "#15803d", // green-700 (4.56:1 on --secondary light, 3.02:1 dark; was green-600 2.998:1 -- just under 3:1 -- on the real surface)
};

export const STATUS_LABELS: Record<TaskCardTask["status"], string> = {
  todo: "To Do",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
};

// Krug 2 UX audit fix: a project's real `project_statuses.name` column
// value (F221/F223) is used verbatim as both the select `value` AND, until
// now, inconsistently as the display `label` -- the project List view (list/
// page.tsx) already ran a project's column name through STATUS_LABELS
// before falling back to the raw name, but My Tasks (my-tasks/page.tsx)
// built its own per-project statusOptions map with `label: row.name`
// directly, so a project still on the default (un-renamed) seed columns
// showed raw values like "done"/"in_progress" there while the exact same
// task's status showed "Done"/"In Progress" in the List view. Both call
// sites now share this one lookup so they can never diverge again.
export function statusLabelFor(name: string): string {
  return STATUS_LABELS[name as keyof typeof STATUS_LABELS] ?? name;
}

// Priority is nullable on the task row (see F071 handoff notes); "no
// priority" gets its own bucket/color so a chart never has to drop a row
// or misrepresent it as belonging to a fixed priority.
type Priority = NonNullable<TaskCardTask["priority"]>;

export const PRIORITY_COLORS: Record<Priority | "none", string> = {
  urgent: "#ef4444", // red-500 (3.76:1 on white)
  high: "#ea580c", // orange-600 (3.56:1 on white; was orange-500 2.80:1)
  // UX audit: yellow-700 (#a16207, hue 35°) sat only ~14° away from
  // `high`'s orange-600 (#ea580c, hue 21°) on the hue wheel, so the two
  // bars/dots read as near-identical brown/orange at a glance despite
  // both individually clearing 3:1. This darker, more yellow-leaning
  // value (hue 52°) is ~31° from `high` and ~52° from `urgent`, while
  // still clearing 3:1 on white (5.40:1) and the badge's real secondary
  // background (4.73:1) — see tests/unit/task-colors-contrast.test.ts.
  medium: "#7a6a00", // dark yellow/olive (5.40:1 on white, 4.73:1 on secondary; distinct hue from high/urgent)
  low: "#3b82f6", // blue-500 (3.68:1 on white)
  // F269 (AS-526): slate-600 (#475569) clears 3:1 on the light theme's
  // white card (7.58:1) but FAILS on the dark theme's card background
  // (oklch(0.205 0 0), ~#1f1f1f) at only 2.18:1 — this dot/badge-border
  // colour is a fixed hex rendered directly on that dark surface (same
  // "no theme-conditional colour" pattern this file's header comment
  // documents), so a single value must clear 3:1 in BOTH themes at once.
  // zinc-500 (#71717a) does: 4.83:1 on white, 3.41:1 on the dark card —
  // see tests/unit/task-colors-contrast.test.ts for the automated check
  // in both themes.
  backlog: "#71717a", // zinc-500 (4.83:1 on white, 3.41:1 on dark card; was slate-600 2.18:1 on dark)
  none: "#64748b", // slate-500 (4.76:1 on white; was slate-300 1.48:1)
};

// F338 (M18 scrutiny MAJ-3/FU-G, AS-526): the timeline bar/marker fills
// its ENTIRE surface with the fixed PRIORITY_COLORS hex above and needs
// real body text (the task title) to stay legible on it in both themes.
// Since the background is a theme-invariant fixed hex, a single
// theme-invariant text colour is needed too -- but neither pure black
// nor pure white clears the WCAG AA 4.5:1 normal-text threshold against
// every one of the six values (black fails medium/backlog/none at
// 4.27/4.35/4.41:1; white fails urgent/high/low at 3.76/3.56/3.68:1), so
// this is a genuine per-colour "which one wins" pick, not a fixed
// scheme. Every entry below is the higher-contrast of {black, white}
// for its own background and clears 4.5:1: urgent 5.58:1, high 5.90:1,
// medium 5.40:1, low 5.71:1, backlog 4.83:1, none 4.76:1 (against WHITE
// text) or 5.58/5.90/-/5.71/-/- (against BLACK text) as applicable. See
// tests/unit/task-colors-contrast.test.ts for the automated check.
export const PRIORITY_TEXT_ON_COLOR: Record<Priority | "none", string> = {
  urgent: "#000000",
  high: "#000000",
  medium: "#ffffff",
  low: "#000000",
  backlog: "#ffffff",
  none: "#ffffff",
};

export const PRIORITY_LABELS: Record<Priority | "none", string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  backlog: "Backlog",
  none: "No priority",
};
