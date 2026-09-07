// F229 (AS-433): "a saved view referencing a deleted status or member
// degrades gracefully instead of erroring." A saved view's `config` is a
// snapshot taken at save time -- nothing enforces that a `status` filter
// still names a real column (F220's reassign-and-delete can remove one) or
// that an `assigneeId` filter still names an active workspace member
// (removed from the workspace since the view was saved) by the time the
// view is opened. Per this feature's clarification ("the notice must be
// non-blocking; a stale view should still show tasks"), every dangling
// reference is DROPPED from the effective filter set rather than applied
// (which could silently produce zero rows) or surfaced as an error.
//
// Dangling-reference classes enumerated for the List view (the only
// `view_type` this feature wires into a real page -- see this feature's
// handoff for why board/calendar/timeline are out of scope):
//   1. `status` filter naming a `project_statuses` row that no longer
//      exists (deleted via F220's reassign-and-delete) -- dropped when the
//      value isn't in the CALLER-SUPPLIED set of the project's current
//      real column names (`validStatusNames`, the exact same set
//      list/page.tsx already validates the URL's own `status` param
//      against).
//   2. `assigneeId` filter naming a user who is no longer an active
//      workspace member (removed from the workspace, or the membership
//      deactivated) -- dropped when the value isn't in the caller-supplied
//      set of the project's current assignee-eligible member ids
//      (`validAssigneeIds`, resolved from the same `getWorkspaceMembers`
//      call the page already makes for its own filter dropdown -- no
//      second query).
//   3. `sort` naming a field/direction pair the reader doesn't recognise
//      -- already handled by `parseViewSearchParams`-style validation
//      (only `dueDate` asc/desc round-trips at all); an unrecognised sort
//      is simply omitted, falling back to the page's own default order,
//      never an error.
//   4. The referenced PROJECT itself being deleted, or the view's owner
//      losing project visibility -- not this module's concern: that
//      dangling reference is caught upstream by `getSavedView`'s RLS-
//      scoped read, which returns a plain "not found" result rather than
//      throwing (see lib/actions/views.ts). The list page treats that as
//      "no view applied," not a crash, per AS-433's own "instead of
//      erroring" wording.

import type { ProjectListTaskFilters, ProjectListTaskSort } from "@/lib/queries/tasks";
import type { SavedViewConfig } from "@/lib/validation/views";

const SORT_PARAM_TO_FIELD: Record<string, { field: string; direction: "asc" | "desc" }> = {
  due_date_asc: { field: "dueDate", direction: "asc" },
  due_date_desc: { field: "dueDate", direction: "desc" },
};

export type ResolvedListViewFilters = {
  filters: ProjectListTaskFilters;
  sort: ProjectListTaskSort | undefined;
  /** Count of filter/sort entries present in the saved config that were
   * dropped because they no longer resolve to something real -- surfaced
   * as the UI's non-blocking "N filters no longer apply" notice. */
  droppedCount: number;
};

const VALID_PRIORITIES = new Set(["urgent", "high", "medium", "low", "backlog"]);

export function resolveListViewFilters(
  config: SavedViewConfig,
  opts: { validStatusNames: Set<string>; validAssigneeIds: Set<string> },
): ResolvedListViewFilters {
  const filters: ProjectListTaskFilters = {};
  let droppedCount = 0;

  for (const filter of config.filters) {
    // Follow-up (advanced filtering, partial): "in" carries an array
    // value for a multi-select filter -- each entry is validated exactly
    // like a single "eq" value would be, and the whole filter is dropped
    // (not partially applied) if it resolves to zero valid entries, same
    // "never silently produce a different filter than what was saved"
    // posture as a single dangling "eq" value.
    if (filter.operator !== "eq" && filter.operator !== "in") {
      droppedCount += 1;
      continue;
    }

    const rawValues: unknown[] =
      filter.operator === "in"
        ? Array.isArray(filter.value)
          ? filter.value
          : []
        : [filter.value];
    const stringValues = rawValues.map((v) => (typeof v === "string" ? v : String(v ?? "")));

    if (filter.field === "status") {
      const valid = stringValues.filter((v) => v && opts.validStatusNames.has(v));
      if (valid.length > 0) {
        filters.status =
          filter.operator === "in"
            ? (valid as unknown as ProjectListTaskFilters["status"])
            : (valid[0] as ProjectListTaskFilters["status"]);
      }
      if (valid.length !== stringValues.length || valid.length === 0) {
        droppedCount += 1;
      }
      continue;
    }

    if (filter.field === "priority") {
      const valid = stringValues.filter((v) => v && VALID_PRIORITIES.has(v));
      if (valid.length > 0) {
        filters.priority =
          filter.operator === "in"
            ? (valid as unknown as ProjectListTaskFilters["priority"])
            : (valid[0] as ProjectListTaskFilters["priority"]);
      }
      if (valid.length !== stringValues.length || valid.length === 0) {
        droppedCount += 1;
      }
      continue;
    }

    if (filter.field === "assigneeId") {
      const valid = stringValues.filter((v) => v && opts.validAssigneeIds.has(v));
      if (valid.length > 0) {
        filters.assigneeId = filter.operator === "in" ? valid : valid[0];
      }
      if (valid.length !== stringValues.length || valid.length === 0) {
        droppedCount += 1;
      }
      continue;
    }

    // Unrecognised field entirely -- dropped, never applied blindly.
    droppedCount += 1;
  }

  let sort: ProjectListTaskSort | undefined;
  const firstSort = config.sort[0];
  if (firstSort) {
    const knownParam =
      firstSort.field === "dueDate"
        ? firstSort.direction === "asc"
          ? "due_date_asc"
          : "due_date_desc"
        : undefined;
    if (knownParam && SORT_PARAM_TO_FIELD[knownParam]) {
      sort = knownParam as ProjectListTaskSort;
    } else {
      droppedCount += 1;
    }
  }

  return { filters, sort, droppedCount };
}
