// F111 (missions/20260903-portal, docs/client-portal-visual-plan.md 3.6):
// "Weekly delivery rhythm" -- the pure series math, kept separate from
// both the DB read (lib/queries/portal.ts's getPortalWeeklyDelivery) and
// the rendering (components/portal/weekly-delivery-chart.tsx), exactly
// the "pure layout function kept separate from rendering/fetching"
// convention hours-burndown-chart.tsx/burndown-series.ts already
// established for the Hours view (see that file's own header) -- no
// React, no Supabase, plain typed inputs in, a plain typed array out, so
// it is directly unit-testable and importable from a server component
// without a "use client" boundary violation (the exact defect class
// F069's own header names).
//
// --- What counts as "shipped in week N" (this feature's own definition,
// no clarification file exists for it -- see this feature's handoff) ---
//
// A client-visible task counts once, in the week of the LAST recorded
// transition into a done-category status, provided the task is STILL in
// a done-category status today. Two deliberate choices follow from that:
//
//   1. `task_activity` (the append-only per-task event log, F194) is the
//      source, not `tasks.updated_at`. `updated_at` is bumped by ANY
//      field write on the row -- a title edit, a re-assignment, a due
//      date nudge months after the work actually finished all bump it to
//      "now", which would misdate old, already-shipped work as freshly
//      shipped. `task_activity` records the specific event ("status
//      changed") with its own timestamp, independent of anything else
//      that happens to the row afterwards.
//   2. A task's status can flip more than once (done -> reopened ->
//      done again, or done -> reopened and left there). Using the FIRST
//      ever transition into done would keep crediting a week for work
//      that was later reopened and is not actually done today. Using the
//      LAST transition, and only for tasks CURRENTLY done, means a
//      reopened task drops out of every week's count until it is
//      redone, and a task redone twice is credited for the week it was
//      *most recently* finished -- the honest "as of today, this is what
//      shipped and when" reading, not a historical count of every time
//      "done" was ever pressed.
//
// Fallback (documented, not silent): a done task with NO matching
// `task_activity` row at all -- either it predates F194/F195 (rolled out
// 2026-08-22/23) or it was imported/seeded already in a done state, so
// no transition was ever recorded -- falls back to the task's own
// `created_at`. `created_at` is used deliberately over `updated_at` here
// too: `created_at` is immutable once set, so it cannot be pulled
// forward by an unrelated later edit the way `updated_at` can. It is
// still an approximation (the task may well have shipped after it was
// created), disclosed as exactly that in the chart's caption rather than
// implied as an exact date.
//
// Range: the project's OWN span -- from the week containing the
// project's start date through the week containing today -- never an
// arbitrary trailing window (a project a week old should show one real
// week, not eleven empty ones stretching back past when the project
// existed).

import { enumerateIsoWeeks, isoWeekOf } from "@/lib/hours/burndown-series";

export type WeeklyDeliveryWeek = {
  isoWeek: string;
  count: number;
};

/**
 * Buckets a list of completion-date ISO strings into one entry per ISO
 * week across the project's own span (`projectStartIso` through
 * `todayIso`, inclusive). Every week in that span is present, including
 * ones with zero completions -- an empty week is real information (this
 * feature's own guard: "a week with nothing shipped" must read as a
 * zero-height bar, not a missing one), so it is never dropped from the
 * series.
 *
 * Guards:
 *  - No completions at all (a project with no completed work yet):
 *    returns every week in the span at count 0, never an empty array --
 *    the chart still renders its axis and its true "nothing yet" shape.
 *  - A project whose start date is this week (a project a week old):
 *    the span is exactly one week, not eleven padded years back.
 *  - A completion date outside the project's own span (stray data --
 *    clock skew, or a fallback `created_at` recorded fractionally before
 *    the project's own `start_date` row was set) is clamped into the
 *    nearest boundary week rather than silently dropped or allowed to
 *    stretch the visible range past the project's real span.
 */
export function computeWeeklyDeliverySeries(
  completionDates: string[],
  projectStartIso: string,
  todayIso: string,
): WeeklyDeliveryWeek[] {
  // Inputs may be a bare date ("YYYY-MM-DD", from `projects.start_date`)
  // or a full timestamp (`tasks.created_at` / `task_activity.created_at`,
  // "YYYY-MM-DDTHH:MM:SSZ") -- `isoWeekOf` only parses the date portion,
  // so every input is trimmed to it here rather than at each call site.
  const dateOnly = (iso: string) => iso.slice(0, 10);

  const startWeek = isoWeekOf(dateOnly(projectStartIso));
  const todayWeek = isoWeekOf(dateOnly(todayIso));
  const lastWeek = startWeek > todayWeek ? startWeek : todayWeek;

  const weeks = enumerateIsoWeeks(startWeek, lastWeek);
  const countByWeek = new Map<string, number>(weeks.map((week) => [week, 0]));

  for (const dateIso of completionDates) {
    let week = isoWeekOf(dateOnly(dateIso));
    if (week < startWeek) week = startWeek;
    if (week > lastWeek) week = lastWeek;
    countByWeek.set(week, (countByWeek.get(week) ?? 0) + 1);
  }

  return weeks.map((isoWeek) => ({ isoWeek, count: countByWeek.get(isoWeek) ?? 0 }));
}
