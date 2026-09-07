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
import type { FilterCondition, FilterGroup, SavedViewConfig } from "@/lib/validation/views";
import { resolveEffectiveFilterGroup } from "@/lib/validation/views";

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
  /** The config's effective filter tree (AS-426/nested-groups follow-up),
   * with dangling status/assignee references pruned the same way `filters`
   * above is. `filters`/`sort` remain the flat SQL-friendly projection for
   * the trivial (single "and" group, no nesting) case; `filterGroup` is
   * the full tree a caller needs for anything `isTrivial` says the SQL
   * path can't express (an "or" anywhere, or a nested group). */
  filterGroup: FilterGroup;
  /** True when `filterGroup` is a single, non-nested "and" -- i.e. exactly
   * what `filters` already expresses, so the caller can keep using the
   * existing SQL-level filtering instead of fetching every row and
   * filtering in memory. */
  isTrivial: boolean;
};

// Recursively prunes dangling `status`/`assigneeId` references out of a
// `FilterGroup`, the same validity rules the flat loop below applies, so
// `resolveListViewFilters`'s "stale reference is dropped, never silently
// mis-applied" guarantee (AS-433) also holds for nested/OR'd conditions.
// An emptied-out group (every condition dropped) is left as an empty "and"
// group, which `evaluateFilterGroup` treats as "always matches" -- same
// "an unresolvable filter is removed, not turned into zero results"
// posture as the flat path.
function pruneFilterGroup(
  group: FilterGroup,
  opts: { validStatusNames: Set<string>; validAssigneeIds: Set<string> },
  onDrop: () => void,
): FilterGroup {
  const conditions: (FilterCondition | FilterGroup)[] = [];

  for (const node of group.conditions) {
    if (isFilterGroupNode(node)) {
      conditions.push(pruneFilterGroup(node, opts, onDrop));
      continue;
    }

    if (node.operator !== "eq" && node.operator !== "in") {
      onDrop();
      continue;
    }

    const rawValues = Array.isArray(node.value) ? node.value : [node.value];
    const stringValues = rawValues.map((v) => String(v ?? ""));

    let valid = stringValues;
    if (node.field === "status") {
      valid = stringValues.filter((v) => v && opts.validStatusNames.has(v));
    } else if (node.field === "priority") {
      valid = stringValues.filter((v) => v && VALID_PRIORITIES.has(v));
    } else if (node.field === "assigneeId") {
      valid = stringValues.filter((v) => v && opts.validAssigneeIds.has(v));
    }

    if (valid.length !== stringValues.length || valid.length === 0) {
      onDrop();
    }
    if (valid.length > 0) {
      conditions.push({
        field: node.field,
        operator: node.operator === "in" ? "in" : "eq",
        value: node.operator === "in" ? valid : valid[0],
      });
    }
  }

  return { combinator: group.combinator, conditions };
}

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

  const effectiveGroup = resolveEffectiveFilterGroup(config);
  const prunedGroup = pruneFilterGroup(
    effectiveGroup,
    opts,
    () => {
      // Dangling references inside `filterGroup` are counted separately
      // from the flat-loop drops above only when `filterGroup` carries
      // MORE structure than the flat `filters` array already covered
      // (i.e. it actually has an "or" or nesting) -- otherwise the two
      // loops are walking equivalent data and would double-count the same
      // drop. Simplest correct rule: only bump `droppedCount` here when
      // the effective group isn't trivial (the flat loop above didn't see
      // this data at all in that case).
      if (!isTrivialAndGroup(effectiveGroup)) droppedCount += 1;
    },
  );

  return {
    filters,
    sort,
    droppedCount,
    filterGroup: prunedGroup,
    isTrivial: isTrivialAndGroup(prunedGroup),
  };
}

// Follow-up (nested AND/OR groups): a generic, field-agnostic recursive
// evaluator for a `FilterGroup` tree. `evaluateCondition` is the only
// caller-supplied piece -- it decides what a single leaf `FilterCondition`
// means against one record -- so this function itself has no idea what a
// "task" or a "status" is; it only knows how to combine boolean results
// with "and"/"or" at every level of nesting, recursively, to whatever
// depth the tree has. This is what makes "AND inside OR" and "OR inside
// AND" both fall out of the same code path instead of needing separate
// handling per depth.
function isFilterGroupNode(node: FilterCondition | FilterGroup): node is FilterGroup {
  return (node as FilterGroup).combinator !== undefined && Array.isArray((node as FilterGroup).conditions);
}

export function evaluateFilterGroup(
  group: FilterGroup,
  evaluateCondition: (condition: FilterCondition) => boolean,
): boolean {
  // An empty group vacuously matches everything -- consistent with the old
  // flat behaviour, where zero filters meant "no constraint."
  if (group.conditions.length === 0) return true;

  if (group.combinator === "and") {
    return group.conditions.every((node) =>
      isFilterGroupNode(node) ? evaluateFilterGroup(node, evaluateCondition) : evaluateCondition(node),
    );
  }

  return group.conditions.some((node) =>
    isFilterGroupNode(node) ? evaluateFilterGroup(node, evaluateCondition) : evaluateCondition(node),
  );
}

// A group is "trivial" when it's a single, non-nested "and" of leaf
// conditions -- the exact shape `resolveListViewFilters`'s flat
// `ProjectListTaskFilters` (and therefore `getProjectListTasks`'s SQL
// `.eq()`/`.in()` calls) already knows how to express directly. Anything
// else (an "or" anywhere, or a nested group at any depth) needs the
// generic in-memory evaluator above instead, since PostgREST has no
// simple way to express arbitrary nested AND/OR without hand-built
// `.or()` filter strings this codebase doesn't otherwise use.
export function isTrivialAndGroup(group: FilterGroup): boolean {
  return (
    group.combinator === "and" && group.conditions.every((node) => !isFilterGroupNode(node))
  );
}

// Task-specific leaf condition matcher, used by `filterTasksByGroup`
// below. Understands the same three fields `resolveListViewFilters`
// understands (`status`, `priority`, `assigneeId`); any other field name
// simply never matches (same "unrecognised field is inert, not an error"
// posture as the rest of this module).
export function taskMatchesCondition<
  T extends { status?: unknown; priority?: unknown; assigneeIds?: string[] },
>(task: T, condition: FilterCondition, opts?: { assigneeAccessor?: (task: T) => string[] }): boolean {
  const values = Array.isArray(condition.value) ? condition.value : [condition.value];

  if (condition.field === "status") {
    return values.includes(String(task.status ?? ""));
  }
  if (condition.field === "priority") {
    return values.includes(String(task.priority ?? ""));
  }
  if (condition.field === "assigneeId") {
    const assigneeIds = opts?.assigneeAccessor ? opts.assigneeAccessor(task) : (task.assigneeIds ?? []);
    return values.some((v) => assigneeIds.includes(v));
  }

  return false;
}

// Filters an already-fetched task list in memory against a (possibly
// nested, possibly OR-containing) `FilterGroup`. Intended for the cases
// `isTrivialAndGroup` says the SQL path can't express -- callers should
// still prefer passing a trivial group's equivalent through
// `resolveListViewFilters`'s flat filters to `getProjectListTasks` for the
// common case, since that lets Postgres do the filtering instead of
// fetching every row.
export function filterTasksByGroup<
  T extends { status?: unknown; priority?: unknown; assigneeIds?: string[] },
>(tasks: T[], group: FilterGroup, opts?: { assigneeAccessor?: (task: T) => string[] }): T[] {
  return tasks.filter((task) =>
    evaluateFilterGroup(group, (condition) => taskMatchesCondition(task, condition, opts)),
  );
}

export { resolveEffectiveFilterGroup };
