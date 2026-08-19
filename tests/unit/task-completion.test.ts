// Unit tests for F154 (AS-272, AS-273) — the pure completion-percentage
// function (lib/tasks/completion.ts). Mirrors
// tests/unit/checklist-progress.test.ts's convention of testing the pure
// counting logic in isolation from React/Supabase (this repo's vitest
// config runs in the "node" environment — no jsdom/@testing-library yet,
// that arrives in F277).
//
// Test names reference the assertion each case derives from, per the
// worker brief's "tests must derive from the assertion text" rule.

import { describe, expect, it } from "vitest";

import { computeTaskCompletion } from "@/lib/tasks/completion";

describe("computeTaskCompletion (F154: AS-272, AS-273)", () => {
  it("test_AS_273_returns_null_when_there_are_no_checklist_items_and_no_children", () => {
    expect(
      computeTaskCompletion({
        checklistTotal: 0,
        checklistDone: 0,
        childTotal: 0,
        childDone: 0,
      }),
    ).toBeNull();
  });

  it("test_AS_272_derives_percentage_from_checklist_items_alone", () => {
    expect(
      computeTaskCompletion({
        checklistTotal: 4,
        checklistDone: 1,
        childTotal: 0,
        childDone: 0,
      }),
    ).toEqual({ done: 1, total: 4, percent: 25 });
  });

  it("test_AS_272_derives_percentage_from_child_tasks_alone", () => {
    expect(
      computeTaskCompletion({
        checklistTotal: 0,
        checklistDone: 0,
        childTotal: 3,
        childDone: 2,
      }),
    ).toEqual({ done: 2, total: 3, percent: 67 });
  });

  it("test_AS_272_combines_checklist_items_and_child_tasks_as_flat_equal_units", () => {
    // 1 of 2 checklist items checked + 1 of 2 children done = 2 of 4
    // (50%) — NOT two separately-weighted halves averaged together, per
    // the clarification's "flat count of both" default recorded in this
    // feature's Decisions Made.
    expect(
      computeTaskCompletion({
        checklistTotal: 2,
        checklistDone: 1,
        childTotal: 2,
        childDone: 1,
      }),
    ).toEqual({ done: 2, total: 4, percent: 50 });
  });

  it("test_AS_272_is_equivalent_whether_the_same_total_comes_from_checklist_items_or_children", () => {
    // Same 2-of-4 measurement as the mixed case above, but entirely from
    // checklist items — proves the two unit kinds are genuinely
    // interchangeable, not just coincidentally equal in one example.
    const allChecklist = computeTaskCompletion({
      checklistTotal: 4,
      checklistDone: 2,
      childTotal: 0,
      childDone: 0,
    });
    const mixed = computeTaskCompletion({
      checklistTotal: 2,
      checklistDone: 1,
      childTotal: 2,
      childDone: 1,
    });
    expect(allChecklist?.percent).toBe(mixed?.percent);
    expect(allChecklist?.done).toBe(mixed?.done);
    expect(allChecklist?.total).toBe(mixed?.total);
  });

  it("test_AS_272_reports_0_percent_as_a_real_measurement_when_nothing_is_done_yet_but_something_exists_to_measure", () => {
    // Distinguishes AS-273's "nothing to measure -> null" from a
    // genuine "0 of N done" measurement, which is NOT null.
    expect(
      computeTaskCompletion({
        checklistTotal: 3,
        checklistDone: 0,
        childTotal: 0,
        childDone: 0,
      }),
    ).toEqual({ done: 0, total: 3, percent: 0 });
  });

  it("test_AS_272_reports_100_percent_when_everything_is_done", () => {
    expect(
      computeTaskCompletion({
        checklistTotal: 2,
        checklistDone: 2,
        childTotal: 1,
        childDone: 1,
      }),
    ).toEqual({ done: 3, total: 3, percent: 100 });
  });

  it("rounds a non-integer percentage to the nearest whole percent", () => {
    // 1 of 3 = 33.33...% -> rounds to 33, not truncates to 33 or floors
    // oddly for the other boundary (2 of 3 = 66.66...% -> 67).
    expect(
      computeTaskCompletion({
        checklistTotal: 3,
        checklistDone: 1,
        childTotal: 0,
        childDone: 0,
      })?.percent,
    ).toBe(33);
    expect(
      computeTaskCompletion({
        checklistTotal: 3,
        checklistDone: 2,
        childTotal: 0,
        childDone: 0,
      })?.percent,
    ).toBe(67);
  });

  it("does not mutate its input", () => {
    const input = {
      checklistTotal: 2,
      checklistDone: 1,
      childTotal: 1,
      childDone: 1,
    };
    const snapshot = { ...input };
    computeTaskCompletion(input);
    expect(input).toEqual(snapshot);
  });
});
