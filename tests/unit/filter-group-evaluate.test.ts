// Unit tests for the recursive filter-group evaluator added to
// lib/views/resolve-view.ts (follow-up: nested AND/OR groups). Covers
// generic evaluateFilterGroup recursion (AND-inside-OR and OR-inside-AND,
// at multiple depths), isTrivialAndGroup's SQL-vs-in-memory routing
// decision, and filterTasksByGroup's in-memory application against a task
// list, plus resolveListViewFilters's own filterGroup/isTrivial output.

import { describe, expect, it } from "vitest";

import {
  evaluateFilterGroup,
  filterTasksByGroup,
  isTrivialAndGroup,
  resolveListViewFilters,
} from "@/lib/views/resolve-view";
import type { FilterCondition, FilterGroup, SavedViewConfig } from "@/lib/validation/views";

function matches(record: Record<string, unknown>) {
  return (condition: FilterCondition) => {
    const values = Array.isArray(condition.value) ? condition.value : [condition.value];
    return values.includes(String(record[condition.field] ?? ""));
  };
}

describe("evaluateFilterGroup (generic recursive evaluation)", () => {
  it("test_an_empty_group_always_matches", () => {
    const group: FilterGroup = { combinator: "and", conditions: [] };
    expect(evaluateFilterGroup(group, matches({}))).toBe(true);
  });

  it("test_a_flat_and_group_requires_every_condition_to_match", () => {
    const group: FilterGroup = {
      combinator: "and",
      conditions: [
        { field: "status", operator: "eq", value: "todo" },
        { field: "priority", operator: "eq", value: "high" },
      ],
    };
    expect(evaluateFilterGroup(group, matches({ status: "todo", priority: "high" }))).toBe(true);
    expect(evaluateFilterGroup(group, matches({ status: "todo", priority: "low" }))).toBe(false);
  });

  it("test_a_flat_or_group_requires_any_condition_to_match", () => {
    const group: FilterGroup = {
      combinator: "or",
      conditions: [
        { field: "status", operator: "eq", value: "todo" },
        { field: "status", operator: "eq", value: "done" },
      ],
    };
    expect(evaluateFilterGroup(group, matches({ status: "done" }))).toBe(true);
    expect(evaluateFilterGroup(group, matches({ status: "in_progress" }))).toBe(false);
  });

  it("test_an_and_group_nested_inside_an_or_group_evaluates_correctly", () => {
    // (status = "todo") OR (priority = "high" AND assigneeId = "u1")
    const group: FilterGroup = {
      combinator: "or",
      conditions: [
        { field: "status", operator: "eq", value: "todo" },
        {
          combinator: "and",
          conditions: [
            { field: "priority", operator: "eq", value: "high" },
            { field: "assigneeId", operator: "eq", value: "u1" },
          ],
        },
      ],
    };

    // Matches via the nested AND branch even though the top-level leaf fails.
    expect(
      evaluateFilterGroup(group, matches({ status: "done", priority: "high", assigneeId: "u1" })),
    ).toBe(true);
    // Nested AND partially satisfied -> false, top-level leaf also false -> overall false.
    expect(
      evaluateFilterGroup(group, matches({ status: "done", priority: "high", assigneeId: "u2" })),
    ).toBe(false);
    // Top-level leaf alone satisfies the OR.
    expect(
      evaluateFilterGroup(group, matches({ status: "todo", priority: "low", assigneeId: "u2" })),
    ).toBe(true);
  });

  it("test_an_or_group_nested_inside_an_and_group_evaluates_correctly", () => {
    // (priority = "high") AND (status = "todo" OR status = "in_progress")
    const group: FilterGroup = {
      combinator: "and",
      conditions: [
        { field: "priority", operator: "eq", value: "high" },
        {
          combinator: "or",
          conditions: [
            { field: "status", operator: "eq", value: "todo" },
            { field: "status", operator: "eq", value: "in_progress" },
          ],
        },
      ],
    };

    expect(evaluateFilterGroup(group, matches({ priority: "high", status: "todo" }))).toBe(true);
    expect(evaluateFilterGroup(group, matches({ priority: "high", status: "done" }))).toBe(false);
    expect(evaluateFilterGroup(group, matches({ priority: "low", status: "todo" }))).toBe(false);
  });

  it("test_multiple_levels_of_nesting_still_evaluate_correctly", () => {
    // (status = "todo") OR ((priority = "high") AND ((assigneeId = "u1") OR (assigneeId = "u2")))
    const group: FilterGroup = {
      combinator: "or",
      conditions: [
        { field: "status", operator: "eq", value: "todo" },
        {
          combinator: "and",
          conditions: [
            { field: "priority", operator: "eq", value: "high" },
            {
              combinator: "or",
              conditions: [
                { field: "assigneeId", operator: "eq", value: "u1" },
                { field: "assigneeId", operator: "eq", value: "u2" },
              ],
            },
          ],
        },
      ],
    };

    expect(
      evaluateFilterGroup(group, matches({ status: "done", priority: "high", assigneeId: "u2" })),
    ).toBe(true);
    expect(
      evaluateFilterGroup(group, matches({ status: "done", priority: "high", assigneeId: "u3" })),
    ).toBe(false);
  });
});

describe("isTrivialAndGroup", () => {
  it("test_a_flat_and_group_of_leaves_is_trivial", () => {
    expect(
      isTrivialAndGroup({
        combinator: "and",
        conditions: [{ field: "status", operator: "eq", value: "todo" }],
      }),
    ).toBe(true);
  });

  it("test_a_top_level_or_group_is_not_trivial", () => {
    expect(
      isTrivialAndGroup({
        combinator: "or",
        conditions: [{ field: "status", operator: "eq", value: "todo" }],
      }),
    ).toBe(false);
  });

  it("test_an_and_group_containing_a_nested_group_is_not_trivial", () => {
    expect(
      isTrivialAndGroup({
        combinator: "and",
        conditions: [{ combinator: "and", conditions: [] }],
      }),
    ).toBe(false);
  });
});

describe("filterTasksByGroup (in-memory application)", () => {
  const tasks = [
    { id: "1", status: "todo", priority: "high", assigneeIds: ["u1"] },
    { id: "2", status: "done", priority: "low", assigneeIds: ["u2"] },
    { id: "3", status: "in_progress", priority: "high", assigneeIds: ["u3"] },
  ];

  it("test_filters_tasks_matching_a_nested_or_inside_and_group", () => {
    // priority = high AND (status = todo OR status = in_progress)
    const group: FilterGroup = {
      combinator: "and",
      conditions: [
        { field: "priority", operator: "eq", value: "high" },
        {
          combinator: "or",
          conditions: [
            { field: "status", operator: "eq", value: "todo" },
            { field: "status", operator: "eq", value: "in_progress" },
          ],
        },
      ],
    };

    const result = filterTasksByGroup(tasks, group);
    expect(result.map((t) => t.id)).toEqual(["1", "3"]);
  });
});

describe("resolveListViewFilters filterGroup/isTrivial output", () => {
  it("test_a_flat_legacy_config_resolves_to_a_trivial_group", () => {
    const config: SavedViewConfig = {
      filters: [{ field: "status", operator: "eq", value: "todo" }],
      sort: [],
      groupBy: null,
    };
    const result = resolveListViewFilters(config, {
      validStatusNames: new Set(["todo"]),
      validAssigneeIds: new Set(),
    });
    expect(result.isTrivial).toBe(true);
    expect(result.filterGroup).toEqual({
      combinator: "and",
      conditions: [{ field: "status", operator: "eq", value: "todo" }],
    });
  });

  it("test_a_config_with_an_or_filterGroup_resolves_to_a_non_trivial_group", () => {
    const config: SavedViewConfig = {
      filters: [],
      filterGroup: {
        combinator: "or",
        conditions: [
          { field: "status", operator: "eq", value: "todo" },
          { field: "status", operator: "eq", value: "done" },
        ],
      },
      sort: [],
      groupBy: null,
    };
    const result = resolveListViewFilters(config, {
      validStatusNames: new Set(["todo", "done"]),
      validAssigneeIds: new Set(),
    });
    expect(result.isTrivial).toBe(false);
    expect(result.filterGroup.combinator).toBe("or");
    expect(result.filterGroup.conditions.length).toBe(2);
  });

  it("test_a_dangling_status_reference_inside_a_non_trivial_group_is_pruned_and_counted", () => {
    const config: SavedViewConfig = {
      filters: [],
      filterGroup: {
        combinator: "or",
        conditions: [
          { field: "status", operator: "eq", value: "deleted-status" },
          { field: "status", operator: "eq", value: "done" },
        ],
      },
      sort: [],
      groupBy: null,
    };
    const result = resolveListViewFilters(config, {
      validStatusNames: new Set(["done"]),
      validAssigneeIds: new Set(),
    });
    expect(result.filterGroup.conditions).toEqual([{ field: "status", operator: "eq", value: "done" }]);
    expect(result.droppedCount).toBe(1);
  });
});
