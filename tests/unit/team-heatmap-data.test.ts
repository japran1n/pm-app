// Unit coverage for lib/time/team-heatmap-data.ts — the workspace Time
// report's team heatmap data shaping (day-by-day grid, week-bucketing
// fallback for long ranges, empty-row handling for members with zero
// logged time).
import { describe, expect, it } from "vitest";
import { buildTeamHeatmapGrid, MAX_DAILY_COLUMNS } from "@/lib/time/team-heatmap-data";

describe("buildTeamHeatmapGrid", () => {
  it("builds one column per day for a short range", () => {
    const grid = buildTeamHeatmapGrid(
      ["u1"],
      [{ userId: "u1", entryDate: "2026-09-01", totalMinutes: 60 }],
      "2026-09-01",
      "2026-09-03",
    );
    expect(grid.bucketedByWeek).toBe(false);
    expect(grid.columns).toHaveLength(3);
    expect(grid.columns.map((c) => c.key)).toEqual([
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
    ]);
  });

  it("places minutes in the correct cell for the correct person", () => {
    const grid = buildTeamHeatmapGrid(
      ["u1", "u2"],
      [
        { userId: "u1", entryDate: "2026-09-01", totalMinutes: 120 },
        { userId: "u2", entryDate: "2026-09-02", totalMinutes: 30 },
      ],
      "2026-09-01",
      "2026-09-02",
    );
    const row1 = grid.rows.find((r) => r.userId === "u1")!;
    const row2 = grid.rows.find((r) => r.userId === "u2")!;
    expect(row1.cells.find((c) => c.columnKey === "2026-09-01")?.totalMinutes).toBe(120);
    expect(row1.cells.find((c) => c.columnKey === "2026-09-02")?.totalMinutes).toBe(0);
    expect(row2.cells.find((c) => c.columnKey === "2026-09-02")?.totalMinutes).toBe(30);
  });

  it("includes a row of empty cells for a member with zero logged time", () => {
    const grid = buildTeamHeatmapGrid(["u1", "u2"], [], "2026-09-01", "2026-09-02");
    expect(grid.rows).toHaveLength(2);
    for (const row of grid.rows) {
      expect(row.cells.every((c) => c.totalMinutes === 0)).toBe(true);
    }
  });

  it("computes the max minutes across all cells for intensity scaling", () => {
    const grid = buildTeamHeatmapGrid(
      ["u1", "u2"],
      [
        { userId: "u1", entryDate: "2026-09-01", totalMinutes: 90 },
        { userId: "u2", entryDate: "2026-09-01", totalMinutes: 480 },
      ],
      "2026-09-01",
      "2026-09-01",
    );
    expect(grid.maxMinutes).toBe(480);
  });

  it("buckets into ISO weeks when the range exceeds MAX_DAILY_COLUMNS days", () => {
    const start = "2026-01-01";
    const end = "2026-02-15"; // 46 days, over the 31-day cap
    const grid = buildTeamHeatmapGrid(["u1"], [], start, end);
    expect(grid.bucketedByWeek).toBe(true);
    expect(grid.columns.length).toBeLessThan(46);
    expect(grid.columns.length).toBeGreaterThan(0);
  });

  it("does not bucket a range exactly at the cap", () => {
    // 31-day span: Sept 1 through Oct 1 inclusive (31 days total).
    const grid = buildTeamHeatmapGrid(["u1"], [], "2026-09-01", "2026-10-01");
    expect(grid.columns).toHaveLength(31);
    expect(grid.columns.length).toBe(MAX_DAILY_COLUMNS);
    expect(grid.bucketedByWeek).toBe(false);
  });
});
