// F224 (AS-418, AS-419, AS-421, AS-423): pure, client-side grouping of an
// already-loaded task set into swimlanes -- per this feature's Clarified
// implementation's performance budget ("no N+1 queries per row and no
// per-item network call; counts and related data arrive with the main
// query"), grouping is computed here from `Board`'s existing `tasks`
// state, never a second fetch. This module has zero React/DOM
// dependencies so it's unit-testable in isolation and reusable by
// Swimlane's per-lane, per-column counts (AS-421) without recomputing the
// grouping itself.

export type SwimlaneGroupBy = "none" | "assignee" | "priority" | "tag";

export const SWIMLANE_GROUP_BY_VALUES: SwimlaneGroupBy[] = [
  "none",
  "assignee",
  "priority",
  "tag",
];

// Sentinel key for the "None" lane (AS-423) -- deliberately not a real
// assignee id / priority value / tag string, so it can never collide with
// a real group key.
export const SWIMLANE_NONE_KEY = "__none__";

export type SwimlaneGroup<T> = {
  /** Stable identity for this lane -- a user id, a priority value, a tag
   * string, or SWIMLANE_NONE_KEY. */
  key: string;
  tasks: T[];
};

type GroupableTask = {
  priority?: string | null;
  assigneeId?: string | null;
  assigneeIds?: string[];
  tags?: string[];
};

const PRIORITY_ORDER = ["urgent", "high", "medium", "low", "backlog"];

/**
 * Groups `tasks` into swimlanes per `groupBy`.
 *
 * - `"none"` (AS-419): returns exactly one group so a caller checking
 *   `groups.length === 1 && groups[0].key === SWIMLANE_NONE_KEY... ` --
 *   no, simpler: callers should special-case `groupBy === "none"`
 *   themselves and render the pre-existing flat layout instead of calling
 *   this function at all; this branch exists so the function is still
 *   total and testable for every input.
 * - `"assignee"` / `"tag"` (many-to-many, per this feature's Notes for
 *   clarification): a task with N values for the grouped field appears in
 *   all N lanes, unchanged, not split or deduped -- so summing every
 *   lane's task count can exceed the board's total task count by design.
 *   A task with zero values falls into the "None" lane (AS-423).
 * - `"priority"` (single-valued): a task appears in exactly one lane --
 *   its own priority, or "None" when priority is null.
 *
 * Lane order: priority lanes follow urgent -> high -> medium -> low ->
 * backlog (any priority value outside that fixed set sorts after them,
 * alphabetically); assignee/tag lanes sort alphabetically by key (the
 * caller is expected to re-sort assignee lanes by resolved display name
 * if a locale-aware order is wanted -- this module has no identity
 * resolution, only ids/strings). The "None" lane, when non-empty, is
 * always rendered last, regardless of groupBy.
 */
export function groupTasksIntoSwimlanes<T extends GroupableTask>(
  tasks: T[],
  groupBy: SwimlaneGroupBy,
): SwimlaneGroup<T>[] {
  if (groupBy === "none") {
    return [{ key: SWIMLANE_NONE_KEY, tasks }];
  }

  const buckets = new Map<string, T[]>();

  for (const task of tasks) {
    const keys = keysForTask(task, groupBy);
    if (keys.length === 0) {
      pushTo(buckets, SWIMLANE_NONE_KEY, task);
      continue;
    }
    for (const key of keys) {
      pushTo(buckets, key, task);
    }
  }

  const noneTasks = buckets.get(SWIMLANE_NONE_KEY);
  buckets.delete(SWIMLANE_NONE_KEY);

  const sortedKeys =
    groupBy === "priority"
      ? [...buckets.keys()].sort((a, b) => {
          const ai = PRIORITY_ORDER.indexOf(a);
          const bi = PRIORITY_ORDER.indexOf(b);
          if (ai === -1 && bi === -1) return a.localeCompare(b);
          if (ai === -1) return 1;
          if (bi === -1) return -1;
          return ai - bi;
        })
      : [...buckets.keys()].sort((a, b) => a.localeCompare(b));

  const groups: SwimlaneGroup<T>[] = sortedKeys.map((key) => ({
    key,
    tasks: buckets.get(key) ?? [],
  }));

  // AS-423: a "None" lane is only rendered when at least one task
  // actually has no value for the grouped field -- an empty lane every
  // project would otherwise always show adds noise for the common case
  // (every task has an assignee, e.g.), matching BoardColumn's own
  // pre-existing "no data => inline empty message per column, no phantom
  // extra column" posture at the lane level instead.
  if (noneTasks && noneTasks.length > 0) {
    groups.push({ key: SWIMLANE_NONE_KEY, tasks: noneTasks });
  }

  return groups;
}

function keysForTask(
  task: GroupableTask,
  groupBy: Exclude<SwimlaneGroupBy, "none">,
): string[] {
  if (groupBy === "priority") {
    return task.priority ? [task.priority] : [];
  }
  if (groupBy === "assignee") {
    const ids =
      task.assigneeIds && task.assigneeIds.length > 0
        ? task.assigneeIds
        : task.assigneeId
          ? [task.assigneeId]
          : [];
    return ids;
  }
  // "tag"
  return task.tags && task.tags.length > 0 ? task.tags : [];
}

function pushTo<T>(map: Map<string, T[]>, key: string, task: T) {
  const existing = map.get(key);
  if (existing) {
    existing.push(task);
  } else {
    map.set(key, [task]);
  }
}
