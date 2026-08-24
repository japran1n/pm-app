// Unit tests for F235 (AS-448) — lib/calendar/resolve-filters.ts's pure
// `resolveCalendarFilters`. Exercises the "stale/tampered filter value
// degrades gracefully" contract in isolation (no React, no Supabase),
// mirroring how tests/unit exercises resolveListViewFilters (F229) for
// the same problem class.

import { describe, expect, it } from "vitest";

import { resolveCalendarFilters } from "@/lib/calendar/resolve-filters";

const VALID_STATUS_NAMES = new Set(["To Do", "In Progress", "Done"]);
const VALID_PROJECT_IDS = new Set(["project-a", "project-b"]);

describe("F235 resolveCalendarFilters (AS-448)", () => {
  it("test_AS_448_a_status_filter_naming_a_real_column_is_applied", () => {
    const { filters, droppedCount } = resolveCalendarFilters(
      { status: "In Progress" },
      { validStatusNames: VALID_STATUS_NAMES, validProjectIds: VALID_PROJECT_IDS },
    );
    expect(filters.status).toBe("In Progress");
    expect(droppedCount).toBe(0);
  });

  it("test_AS_448_negative_a_status_filter_naming_a_column_that_no_longer_exists_is_dropped_not_applied", () => {
    const { filters, droppedCount } = resolveCalendarFilters(
      { status: "Deleted Column" },
      { validStatusNames: VALID_STATUS_NAMES, validProjectIds: VALID_PROJECT_IDS },
    );
    expect(filters.status).toBeUndefined();
    expect(droppedCount).toBe(1);
  });

  it("test_AS_448_negative_a_tampered_priority_value_is_dropped_not_applied", () => {
    const { filters, droppedCount } = resolveCalendarFilters(
      { priority: "not-a-real-priority" },
      { validStatusNames: VALID_STATUS_NAMES, validProjectIds: VALID_PROJECT_IDS },
    );
    expect(filters.priority).toBeUndefined();
    expect(droppedCount).toBe(1);
  });

  it("test_AS_448_negative_a_projectId_naming_a_project_the_caller_cannot_see_or_that_does_not_exist_is_dropped", () => {
    const { filters, droppedCount } = resolveCalendarFilters(
      { projectId: "some-other-workspaces-project" },
      { validStatusNames: VALID_STATUS_NAMES, validProjectIds: VALID_PROJECT_IDS },
    );
    expect(filters.projectId).toBeUndefined();
    expect(droppedCount).toBe(1);
  });

  it("test_AS_448_a_valid_projectId_is_applied", () => {
    const { filters } = resolveCalendarFilters(
      { projectId: "project-a" },
      { validStatusNames: VALID_STATUS_NAMES, validProjectIds: VALID_PROJECT_IDS },
    );
    expect(filters.projectId).toBe("project-a");
  });

  it("test_AS_448_an_assigneeId_is_passed_through_unvalidated_since_a_stale_one_yields_zero_rows_gracefully_via_the_query_itself", () => {
    const { filters, droppedCount } = resolveCalendarFilters(
      { assigneeId: "user-that-may-no-longer-be-a-member" },
      { validStatusNames: VALID_STATUS_NAMES, validProjectIds: VALID_PROJECT_IDS },
    );
    expect(filters.assigneeId).toBe("user-that-may-no-longer-be-a-member");
    expect(droppedCount).toBe(0);
  });

  it("test_AS_448_no_params_at_all_produces_no_filters_and_never_throws", () => {
    const { filters, droppedCount } = resolveCalendarFilters(
      {},
      { validStatusNames: VALID_STATUS_NAMES, validProjectIds: VALID_PROJECT_IDS },
    );
    expect(filters).toEqual({});
    expect(droppedCount).toBe(0);
  });

  it("test_AS_448_multiple_filters_combine_and_and_each_is_independently_validated", () => {
    const { filters, droppedCount } = resolveCalendarFilters(
      { status: "Done", priority: "high", projectId: "not-real" },
      { validStatusNames: VALID_STATUS_NAMES, validProjectIds: VALID_PROJECT_IDS },
    );
    expect(filters.status).toBe("Done");
    expect(filters.priority).toBe("high");
    expect(filters.projectId).toBeUndefined();
    expect(droppedCount).toBe(1);
  });
});
