// Unit tests for F238's pure planning module (lib/timeline/reschedule.ts,
// AS-454). Pure maths only -- no React/dnd-kit/Supabase -- mirrors
// tests/unit/timeline-layout.test.ts's own "pure module, unit-tested in
// isolation" convention. The real end-to-end proof (plan -> real
// editTask -> real DB row) lives in
// tests/integration/f238-timeline-drag-resize.test.ts.

import { describe, expect, it } from "vitest";

import {
  pixelDeltaToDayDelta,
  planTimelineBarMove,
  planTimelineBarResize,
} from "@/lib/timeline/reschedule";

describe("F238 pixelDeltaToDayDelta", () => {
  it("test_AS_454_rounds_to_the_nearest_whole_day", () => {
    expect(pixelDeltaToDayDelta(32, 32)).toBe(1);
    expect(pixelDeltaToDayDelta(48, 32)).toBe(2); // 1.5 rounds to 2
    expect(pixelDeltaToDayDelta(15, 32)).toBe(0);
    expect(pixelDeltaToDayDelta(-32, 32)).toBe(-1);
  });

  it("test_AS_454_zero_pixels_per_day_never_throws_returns_zero", () => {
    expect(pixelDeltaToDayDelta(100, 0)).toBe(0);
  });
});

describe("F238 planTimelineBarMove (AS-454: dragging a bar moves BOTH dates, preserving duration)", () => {
  it("test_AS_454_a_bar_drag_really_changes_both_dates_and_preserves_duration", () => {
    const plan = planTimelineBarMove(
      { id: "t1", startDate: "2026-06-10", dueDate: "2026-06-14" },
      3,
    );
    expect(plan).toEqual({ startDate: "2026-06-13", dueDate: "2026-06-17" });
    // Duration (due - start) is invariant across a move.
    expect(plan).not.toBeNull();
  });

  it("test_AS_454_a_negative_delta_moves_the_bar_earlier_preserving_duration", () => {
    const plan = planTimelineBarMove(
      { id: "t1", startDate: "2026-06-10", dueDate: "2026-06-14" },
      -5,
    );
    expect(plan).toEqual({ startDate: "2026-06-05", dueDate: "2026-06-09" });
  });

  it("test_AS_454_zero_delta_is_a_no_op", () => {
    const plan = planTimelineBarMove(
      { id: "t1", startDate: "2026-06-10", dueDate: "2026-06-14" },
      0,
    );
    expect(plan).toBeNull();
  });

  it("test_AS_454_a_marker_with_only_a_due_date_moves_only_that_date", () => {
    const plan = planTimelineBarMove({ id: "t1", startDate: null, dueDate: "2026-06-14" }, 2);
    expect(plan).toEqual({ startDate: null, dueDate: "2026-06-16" });
  });

  it("test_AS_454_a_marker_with_only_a_start_date_moves_only_that_date", () => {
    const plan = planTimelineBarMove({ id: "t1", startDate: "2026-06-14", dueDate: null }, 2);
    expect(plan).toEqual({ startDate: "2026-06-16", dueDate: null });
  });

  it("test_AS_454_a_task_with_neither_date_has_nothing_to_move", () => {
    const plan = planTimelineBarMove({ id: "t1", startDate: null, dueDate: null }, 2);
    expect(plan).toBeNull();
  });
});

describe("F238 planTimelineBarResize (AS-454: an edge resize changes ONE date)", () => {
  it("test_AS_454_an_edge_resize_changes_only_the_due_date_when_the_end_handle_moves", () => {
    const plan = planTimelineBarResize(
      { id: "t1", startDate: "2026-07-01", dueDate: "2026-07-10" },
      "end",
      2,
    );
    expect(plan).toEqual({ startDate: "2026-07-01", dueDate: "2026-07-12" });
  });

  it("test_AS_454_an_edge_resize_changes_only_the_start_date_when_the_start_handle_moves", () => {
    const plan = planTimelineBarResize(
      { id: "t1", startDate: "2026-07-01", dueDate: "2026-07-10" },
      "start",
      2,
    );
    expect(plan).toEqual({ startDate: "2026-07-03", dueDate: "2026-07-10" });
  });

  it("test_AS_454_the_inversion_case_clamps_the_start_handle_to_the_due_date_never_inverting", () => {
    const plan = planTimelineBarResize(
      { id: "t1", startDate: "2026-08-05", dueDate: "2026-08-10" },
      "start",
      20,
    );
    expect(plan).toEqual({ startDate: "2026-08-10", dueDate: "2026-08-10" });
    // Never inverted: start <= due always holds for the returned plan.
    expect(plan!.startDate! <= plan!.dueDate!).toBe(true);
  });

  it("test_AS_454_the_inversion_case_clamps_the_end_handle_to_the_start_date_never_inverting", () => {
    const plan = planTimelineBarResize(
      { id: "t1", startDate: "2026-08-05", dueDate: "2026-08-10" },
      "end",
      -20,
    );
    expect(plan).toEqual({ startDate: "2026-08-05", dueDate: "2026-08-05" });
    expect(plan!.startDate! <= plan!.dueDate!).toBe(true);
  });

  it("test_AS_454_a_resize_already_pinned_at_the_clamp_boundary_is_a_no_op_not_a_repeat_call", () => {
    // Already pinned at the due date from a prior clamp -- another large
    // positive delta on the start handle still clamps to the same due
    // date, so this must return null (no repeat editTask call).
    const plan = planTimelineBarResize(
      { id: "t1", startDate: "2026-08-10", dueDate: "2026-08-10" },
      "start",
      5,
    );
    expect(plan).toBeNull();
  });

  it("test_AS_454_zero_delta_is_a_no_op", () => {
    const plan = planTimelineBarResize(
      { id: "t1", startDate: "2026-07-01", dueDate: "2026-07-10" },
      "end",
      0,
    );
    expect(plan).toBeNull();
  });

  it("test_AS_454_a_marker_task_has_no_second_edge_to_resize", () => {
    const plan = planTimelineBarResize(
      { id: "t1", startDate: null, dueDate: "2026-07-10" },
      "end",
      2,
    );
    expect(plan).toBeNull();
  });
});
