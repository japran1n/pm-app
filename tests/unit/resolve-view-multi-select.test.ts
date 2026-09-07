// Unit tests for the follow-up "advanced filtering" feature (partial):
// lib/views/resolve-view.ts's support for a multi-value ("in") filter
// operator, e.g. status IN ['todo', 'in_progress'] instead of only a
// single-value "eq". Full AND/OR condition-group nesting is NOT covered
// here -- see this feature's follow-up notes.

import { describe, expect, it } from "vitest";

import { resolveListViewFilters } from "@/lib/views/resolve-view";
import type { SavedViewConfig } from "@/lib/validation/views";

describe("resolveListViewFilters multi-value 'in' operator (advanced filtering, partial)", () => {
  it("test_a_status_in_filter_with_multiple_valid_values_resolves_to_an_array", () => {
    const config: SavedViewConfig = {
      filters: [{ field: "status", operator: "in", value: ["todo", "in_progress"] }],
      sort: [],
      groupBy: null,
    };

    const result = resolveListViewFilters(config, {
      validStatusNames: new Set(["todo", "in_progress", "done"]),
      validAssigneeIds: new Set(),
    });

    expect(result.filters.status).toEqual(["todo", "in_progress"]);
    expect(result.droppedCount).toBe(0);
  });

  it("test_a_priority_in_filter_drops_only_the_invalid_entries_and_keeps_the_valid_ones", () => {
    const config: SavedViewConfig = {
      filters: [{ field: "priority", operator: "in", value: ["high", "not-a-real-priority"] }],
      sort: [],
      groupBy: null,
    };

    const result = resolveListViewFilters(config, {
      validStatusNames: new Set(),
      validAssigneeIds: new Set(),
    });

    expect(result.filters.priority).toEqual(["high"]);
    expect(result.droppedCount).toBe(1);
  });

  it("test_an_assigneeId_in_filter_matching_multiple_active_members_resolves_to_an_array", () => {
    const config: SavedViewConfig = {
      filters: [{ field: "assigneeId", operator: "in", value: ["user-1", "user-2"] }],
      sort: [],
      groupBy: null,
    };

    const result = resolveListViewFilters(config, {
      validStatusNames: new Set(),
      validAssigneeIds: new Set(["user-1", "user-2", "user-3"]),
    });

    expect(result.filters.assigneeId).toEqual(["user-1", "user-2"]);
    expect(result.droppedCount).toBe(0);
  });

  it("test_an_in_filter_that_matches_nothing_valid_is_fully_dropped", () => {
    const config: SavedViewConfig = {
      filters: [{ field: "status", operator: "in", value: ["deleted-column"] }],
      sort: [],
      groupBy: null,
    };

    const result = resolveListViewFilters(config, {
      validStatusNames: new Set(["todo"]),
      validAssigneeIds: new Set(),
    });

    expect(result.filters.status).toBeUndefined();
    expect(result.droppedCount).toBe(1);
  });
});
