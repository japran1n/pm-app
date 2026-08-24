// Unit tests for lib/views/resolve-view.ts (F229, AS-433): "a saved view
// referencing a deleted status or member degrades gracefully instead of
// erroring." Pure-logic tests, no DB — the integration test
// (tests/integration/f229-saved-views-ui.test.ts) proves the same
// behaviour against real rows.

import { describe, expect, it } from "vitest";

import { resolveListViewFilters } from "@/lib/views/resolve-view";
import type { SavedViewConfig } from "@/lib/validation/views";

describe("resolveListViewFilters (AS-433)", () => {
  it("test_AS_433_a_status_filter_naming_a_deleted_column_is_dropped_not_errored", () => {
    const config: SavedViewConfig = {
      filters: [{ field: "status", operator: "eq", value: "archived-column" }],
      sort: [],
      groupBy: null,
    };

    const result = resolveListViewFilters(config, {
      validStatusNames: new Set(["todo", "in_progress", "done"]),
      validAssigneeIds: new Set(),
    });

    expect(result.filters.status).toBeUndefined();
    expect(result.droppedCount).toBe(1);
  });

  it("test_AS_433_an_assigneeId_filter_naming_a_removed_member_is_dropped_not_errored", () => {
    const config: SavedViewConfig = {
      filters: [{ field: "assigneeId", operator: "eq", value: "removed-user-id" }],
      sort: [],
      groupBy: null,
    };

    const result = resolveListViewFilters(config, {
      validStatusNames: new Set(),
      validAssigneeIds: new Set(["still-here-user-id"]),
    });

    expect(result.filters.assigneeId).toBeUndefined();
    expect(result.droppedCount).toBe(1);
  });

  it("test_AS_433_a_stale_view_still_returns_the_surviving_filters_alongside_the_dropped_one", () => {
    const config: SavedViewConfig = {
      filters: [
        { field: "status", operator: "eq", value: "deleted-status" },
        { field: "priority", operator: "eq", value: "high" },
      ],
      sort: [],
      groupBy: null,
    };

    const result = resolveListViewFilters(config, {
      validStatusNames: new Set(["todo"]),
      validAssigneeIds: new Set(),
    });

    expect(result.filters.status).toBeUndefined();
    expect(result.filters.priority).toBe("high");
    expect(result.droppedCount).toBe(1);
  });

  it("test_AS_433_an_unrecognised_sort_field_is_dropped_and_falls_back_to_default_order", () => {
    const config: SavedViewConfig = {
      filters: [],
      sort: [{ field: "customField", direction: "asc" }],
      groupBy: null,
    };

    const result = resolveListViewFilters(config, {
      validStatusNames: new Set(),
      validAssigneeIds: new Set(),
    });

    expect(result.sort).toBeUndefined();
    expect(result.droppedCount).toBe(1);
  });

  it("test_AS_428_a_config_with_only_valid_references_round_trips_with_nothing_dropped", () => {
    const config: SavedViewConfig = {
      filters: [
        { field: "status", operator: "eq", value: "todo" },
        { field: "assigneeId", operator: "eq", value: "user-1" },
      ],
      sort: [{ field: "dueDate", direction: "desc" }],
      groupBy: null,
    };

    const result = resolveListViewFilters(config, {
      validStatusNames: new Set(["todo"]),
      validAssigneeIds: new Set(["user-1"]),
    });

    expect(result.filters).toEqual({ status: "todo", assigneeId: "user-1" });
    expect(result.sort).toBe("due_date_desc");
    expect(result.droppedCount).toBe(0);
  });
});
