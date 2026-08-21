// F167 (AS-300, AS-301, AS-302): pure helper shared by TimeTracking (task
// detail sheet) and TaskCard (board/list) so both surfaces agree on when a
// task is "over estimate" and what percentage of its estimate has been
// logged — same "single source of truth" convention as
// lib/tasks/is-overdue.ts.
//
// Contract (AS-302): a task with no estimate (`estimateMinutes` is
// null/undefined/not a positive finite number) returns `null` — callers
// must treat `null` as "render logged time only, no progress bar, no
// over-estimate flag." There is no such thing as a 0%/broken progress bar
// or a false-positive over-estimate flag when no estimate was ever set.
//
// `percent` is clamped to [0, 100] for progress-bar rendering (a bar can't
// visually exceed its own track) — `isOverEstimate` is the independent,
// unclamped signal for "logged minutes strictly exceed the estimate,"
// checked against the raw (unclamped) ratio so a task at exactly 100% of
// its estimate is NOT yet flagged as over (matches "over-estimate," not
// "at-estimate").
export type EstimateProgress = {
  /** 0-100, clamped, for progress-bar width. */
  percent: number;
  /** true only when logged minutes are strictly greater than the estimate. */
  isOverEstimate: boolean;
};

export function getEstimateProgress(
  estimateMinutes: number | null | undefined,
  loggedMinutes: number,
): EstimateProgress | null {
  if (
    estimateMinutes === null ||
    estimateMinutes === undefined ||
    !Number.isFinite(estimateMinutes) ||
    estimateMinutes <= 0
  ) {
    return null;
  }

  const safeLogged =
    Number.isFinite(loggedMinutes) && loggedMinutes > 0 ? loggedMinutes : 0;
  const ratio = safeLogged / estimateMinutes;

  return {
    percent: Math.max(0, Math.min(100, Math.round(ratio * 100))),
    isOverEstimate: safeLogged > estimateMinutes,
  };
}
