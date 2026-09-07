// Feature request "Project health badge (automatski izračunat)": a pure
// function computing an automatic health rollup for one project, from
// (a) how many of its open tasks are overdue and (b) whether its current
// (active) phase has run longer than its own planned window
// (`project_phases.planned_end`, supabase/migrations/
// 20260909010000_portal_foundations.sql).
//
// Deliberately pure — no Supabase, no I/O, no React — so it's testable
// with plain objects (mirrors this codebase's established "pure helper +
// caller wires up the data" convention, e.g.
// lib/activity/format-task-activity-entry.ts). The caller (the projects
// list page) is responsible for fetching `overdueTaskCount`/
// `totalTaskCount`/`currentPhase` and feeding them in here.
//
// Thresholds (this feature's own "define reasonable thresholds" answer):
//   - `overdue` if 3+ overdue tasks, OR 30%+ of all tasks are overdue, OR
//     the active phase has overshot its planned_end by 20%+ of its own
//     planned duration (or by DEFAULT_PHASE_DURATION_DAYS worth of time
//     if the phase has no planned_start to derive a duration from).
//   - `at_risk` if 1-2 overdue tasks, OR the active phase has passed its
//     planned_end at all (but by less than the 20% overshoot above), OR
//     the active phase is within 20% of its planned duration of reaching
//     planned_end (i.e. "about to miss it").
//   - `on_track` otherwise, including a project with no tasks and no
//     active phase at all (nothing to be at risk of yet).
export type ProjectHealthPhase = {
  /** F001's project_phases.state vocabulary. A `done` phase never
   * contributes to health — a completed phase running "over" is no
   * longer relevant to whether the PROJECT is currently on track. */
  state: "not_started" | "active" | "blocked" | "done";
  plannedStart: string | null;
  plannedEnd: string | null;
};

export type ProjectHealthInput = {
  /** Defaults to `new Date()` — injectable for deterministic tests. */
  now?: Date;
  /** Count of this project's non-deleted, not-"done" tasks whose due_date
   * has passed. 0 for a project with no overdue tasks. */
  overdueTaskCount: number;
  /** Count of this project's non-deleted tasks, overdue or not. Used only
   * to compute `overdueTaskCount`'s share of the whole — 0 is a valid,
   * genuinely-empty project (never treated as "at risk" by the
   * percentage rule alone). */
  totalTaskCount: number;
  /** The project's current (active, not-done) phase, or `null` if the
   * project has no phases at all or none is currently `active`. A
   * `blocked`/`not_started` phase is passed through unchanged (the
   * function itself decides which states count, see `state` above). */
  currentPhase: ProjectHealthPhase | null;
};

export type ProjectHealth = "on_track" | "at_risk" | "overdue";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Assumed phase duration when a phase has a `planned_end` but no
 * `planned_start` to derive a real duration from — two working weeks is a
 * reasonable generic "how long should one phase run" default for this
 * app's own phase granularity (portal foundations' own phases are
 * typically multi-week milestones, not day-long steps). */
const DEFAULT_PHASE_DURATION_DAYS = 14;
const OVERDUE_TASK_COUNT_THRESHOLD = 3;
const OVERDUE_TASK_PERCENTAGE_THRESHOLD = 0.3;
const PHASE_OVERSHOOT_RATIO_THRESHOLD = 0.2;
const PHASE_APPROACHING_RATIO_THRESHOLD = 0.2;

export function computeProjectHealth(input: ProjectHealthInput): ProjectHealth {
  const now = input.now ?? new Date();
  const overdueTaskCount = Math.max(0, input.overdueTaskCount);
  const totalTaskCount = Math.max(0, input.totalTaskCount);
  const overduePercentage =
    totalTaskCount > 0 ? overdueTaskCount / totalTaskCount : 0;

  let phaseOvershootRatio = 0;
  let phaseApproachingDeadline = false;

  const phase = input.currentPhase;
  if (phase && phase.state !== "done" && phase.plannedEnd) {
    const plannedEnd = new Date(phase.plannedEnd);
    const plannedStart = phase.plannedStart ? new Date(phase.plannedStart) : null;
    const plannedDurationMs =
      plannedStart && plannedEnd.getTime() > plannedStart.getTime()
        ? plannedEnd.getTime() - plannedStart.getTime()
        : DEFAULT_PHASE_DURATION_DAYS * MS_PER_DAY;

    const overshootMs = now.getTime() - plannedEnd.getTime();
    if (overshootMs > 0) {
      phaseOvershootRatio = overshootMs / plannedDurationMs;
    } else {
      const remainingMs = -overshootMs;
      if (remainingMs <= plannedDurationMs * PHASE_APPROACHING_RATIO_THRESHOLD) {
        phaseApproachingDeadline = true;
      }
    }
  }

  const isOverdue =
    overdueTaskCount >= OVERDUE_TASK_COUNT_THRESHOLD ||
    overduePercentage >= OVERDUE_TASK_PERCENTAGE_THRESHOLD ||
    phaseOvershootRatio >= PHASE_OVERSHOOT_RATIO_THRESHOLD;

  if (isOverdue) return "overdue";

  const isAtRisk =
    overdueTaskCount >= 1 || phaseOvershootRatio > 0 || phaseApproachingDeadline;

  if (isAtRisk) return "at_risk";

  return "on_track";
}

export const PROJECT_HEALTH_LABELS: Record<ProjectHealth, string> = {
  on_track: "On track",
  at_risk: "At risk",
  overdue: "Overdue",
};

/** Colour tokens matching this app's existing red/amber/green status
 * vocabulary (same CSS custom properties `--status-*`/priority colours
 * elsewhere in the app use as plain CSS colour values, e.g.
 * task-colors.ts's PRIORITY_COLORS) — passed straight into
 * `StatusBadge`'s `color` prop. */
export const PROJECT_HEALTH_COLORS: Record<ProjectHealth, string> = {
  on_track: "var(--color-emerald-600, #059669)",
  at_risk: "var(--color-amber-600, #d97706)",
  overdue: "var(--color-rose-600, #e11d48)",
};
