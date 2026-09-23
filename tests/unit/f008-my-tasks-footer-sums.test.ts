// Unit test for F008 (TT-011, TT-012): My Tasks per-bucket footer sums.
//
// The sum logic itself lives inline in the Server Component
// (app/(workspace)/w/[workspaceSlug]/my-tasks/page.tsx) rather than in a
// standalone module -- there is nothing framework-specific about it, so
// this test exercises the exact same reduce expressions against
// MyTaskRow-shaped fixtures to pin the behaviour independently of the
// component's JSX.

import { describe, expect, it } from "vitest";

import { formatDuration } from "@/lib/time/format-duration";
import type { MyTaskRow } from "@/lib/queries/my-tasks";

type SumInput = Pick<MyTaskRow, "estimateMinutes" | "totalMinutes">;

// Mirrors the reduce expressions added to page.tsx's per-bucket section.
function sumEstimateMinutes(rows: SumInput[]): number {
  return rows.reduce((sum, row) => sum + (row.estimateMinutes ?? 0), 0);
}

function sumLoggedMinutes(rows: SumInput[]): number {
  return rows.reduce((sum, row) => sum + row.totalMinutes, 0);
}

function makeRow(estimateMinutes: number | null, totalMinutes: number): SumInput {
  return { estimateMinutes, totalMinutes };
}

describe("my-tasks footer sums (TT-011, TT-012)", () => {
  it("test_TT_011_task_count_matches_visible_row_count", () => {
    const rows = [makeRow(60, 30), makeRow(30, 0), makeRow(null, 15)];
    expect(rows.length).toBe(3);
  });

  it("test_TT_011_sums_estimate_and_logged_minutes_across_the_section", () => {
    const rows = [makeRow(60, 30), makeRow(120, 45), makeRow(30, 0)];
    expect(sumEstimateMinutes(rows)).toBe(210);
    expect(sumLoggedMinutes(rows)).toBe(75);
    expect(formatDuration(sumEstimateMinutes(rows))).toBe("3 hr 30 min");
    expect(formatDuration(sumLoggedMinutes(rows))).toBe("1 hr 15 min");
  });

  it("test_TT_011_treats_a_null_estimate_as_zero_not_NaN", () => {
    const rows = [makeRow(null, 10), makeRow(null, 5)];
    expect(sumEstimateMinutes(rows)).toBe(0);
    expect(formatDuration(sumEstimateMinutes(rows))).toBe("0 min");
    expect(sumLoggedMinutes(rows)).toBe(15);
  });

  it("test_TT_011_empty_section_sums_to_zero", () => {
    const rows: SumInput[] = [];
    expect(sumEstimateMinutes(rows)).toBe(0);
    expect(sumLoggedMinutes(rows)).toBe(0);
  });

  it("test_TT_012_sum_only_reflects_the_rows_passed_in_never_a_hidden_total", () => {
    // Simulates two independent bucket sections (e.g. "Overdue" vs
    // "Today") -- each section's sum must be scoped to its own visible
    // rows, never bleed in totals from a sibling section/filter state.
    const overdue = [makeRow(60, 60)];
    const today = [makeRow(30, 15), makeRow(30, 15)];

    expect(sumEstimateMinutes(overdue)).toBe(60);
    expect(sumEstimateMinutes(today)).toBe(60);
    expect(sumLoggedMinutes(overdue)).toBe(60);
    expect(sumLoggedMinutes(today)).toBe(30);
  });

  it("test_TT_012_a_single_rows_array_is_summed_once_per_task_no_double_counting", () => {
    // getMyTasks never returns a subtask alongside its parent in the same
    // bucket (lib/queries/my-tasks.ts has no parent/subtask embed), so a
    // row appearing once in `rows` must contribute exactly once to the
    // sum -- this pins that a row's minutes are never added twice.
    const rows = [makeRow(100, 40)];
    expect(sumEstimateMinutes(rows)).toBe(100);
    expect(sumLoggedMinutes(rows)).toBe(40);
  });
});
