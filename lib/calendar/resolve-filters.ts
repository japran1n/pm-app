// F235 (AS-448): "a stale/tampered filter value arrives, ignore it
// gracefully" -- the same class of problem F229's resolveListViewFilters
// (lib/views/resolve-view.ts) already solves for saved views, and the
// project List page's own inline "validate against the real known set,
// drop rather than apply" posture
// (app/(workspace)/w/[workspaceSlug]/projects/[projectId]/list/page.tsx).
// This is a pure function (no Supabase client, no request) so it can be
// unit-tested directly -- the caller (the calendar page) is what supplies
// the real, currently-visible `validStatusNames`/`validProjectIds` sets.
//
// "Graceful" here means the same thing it means for the List page: the
// tampered/dangling value is DROPPED from the effective filter set (as if
// the param had never been present), never applied verbatim (which could
// silently produce a confusing zero-row grid) and never thrown as an
// error. `assigneeId` is deliberately NOT validated against a known-member
// set here (mirroring the List page's own direct-filter-param path, which
// only validates `status`/`sort` this way) -- an assignee id that no
// longer names anyone real simply matches zero tasks via the query's own
// `task_assignees` join, which is already "gracefully" empty rather than
// an error, with no second membership lookup needed just to pre-validate
// it.

import type { CalendarTaskFilters } from "@/lib/queries/calendar";

const VALID_PRIORITIES = new Set(["urgent", "high", "medium", "low", "backlog"]);

export type ResolvedCalendarFilters = {
  filters: CalendarTaskFilters;
  /** Count of filter params present in the URL that were dropped because
   * they didn't resolve to something real -- callers may use this for a
   * non-blocking "N filters no longer apply" notice, matching F229's own
   * `droppedCount` contract, though this feature's own UI doesn't
   * surface one (see this feature's handoff "Decisions made"). */
  droppedCount: number;
};

export function resolveCalendarFilters(
  params: {
    status?: string | null;
    priority?: string | null;
    assigneeId?: string | null;
    projectId?: string | null;
  },
  opts: { validStatusNames: Set<string>; validProjectIds: Set<string> },
): ResolvedCalendarFilters {
  const filters: CalendarTaskFilters = {};
  let droppedCount = 0;

  if (params.status) {
    if (opts.validStatusNames.has(params.status)) {
      filters.status = params.status;
    } else {
      droppedCount += 1;
    }
  }

  if (params.priority) {
    if (VALID_PRIORITIES.has(params.priority)) {
      filters.priority = params.priority;
    } else {
      droppedCount += 1;
    }
  }

  if (params.projectId) {
    if (opts.validProjectIds.has(params.projectId)) {
      filters.projectId = params.projectId;
    } else {
      droppedCount += 1;
    }
  }

  // assigneeId: intentionally unvalidated -- see the file-level comment.
  if (params.assigneeId) {
    filters.assigneeId = params.assigneeId;
  }

  return { filters, droppedCount };
}
