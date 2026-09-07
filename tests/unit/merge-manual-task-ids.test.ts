// Unit test for the follow-up "manual view membership" feature:
// lib/views/apply-view.ts's mergeManualTaskIds computes the UNION of a
// view's filter-matched tasks and its manually-pinned tasks
// (public.view_tasks), which is what actually makes "add a task to a
// view regardless of its filter" observable end to end.

import { describe, expect, it } from "vitest";
import { mergeManualTaskIds } from "@/lib/views/apply-view";

describe("mergeManualTaskIds (manual view membership union)", () => {
  it("test_manual_task_not_matching_the_filter_still_appears_in_the_merged_result", () => {
    const filtered = [{ id: "a" }, { id: "b" }];
    const manual = [{ id: "c" }];
    const merged = mergeManualTaskIds(filtered, manual);
    expect(merged.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("test_a_task_matching_both_the_filter_and_manual_membership_appears_exactly_once", () => {
    const filtered = [{ id: "a" }, { id: "b" }];
    const manual = [{ id: "b" }, { id: "c" }];
    const merged = mergeManualTaskIds(filtered, manual);
    expect(merged.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("test_no_manual_tasks_returns_the_filtered_list_unchanged", () => {
    const filtered = [{ id: "a" }];
    const merged = mergeManualTaskIds(filtered, []);
    expect(merged).toEqual(filtered);
  });

  it("test_no_filter_matches_at_all_still_returns_every_manual_task", () => {
    const merged = mergeManualTaskIds([], [{ id: "x" }, { id: "y" }]);
    expect(merged.map((t) => t.id)).toEqual(["x", "y"]);
  });
});
