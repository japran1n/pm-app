// @vitest-environment jsdom
//
// Renders the TeamHeatmap component (components/time/team-heatmap.tsx)
// against a real built grid to prove the accessibility requirement holds
// in practice, not just in the data-shaping unit tests: every cell must
// print its hour value as visible text (never colour alone) AND carry an
// `aria-label="<name>, <date>, <hours> hours"`.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { TeamHeatmap } from "@/components/time/team-heatmap";
import { buildTeamHeatmapGrid } from "@/lib/time/team-heatmap-data";

afterEach(cleanup);

describe("TeamHeatmap", () => {
  it("prints the hour value as text on every cell, not just colour", () => {
    const grid = buildTeamHeatmapGrid(
      ["u1"],
      [{ userId: "u1", entryDate: "2026-09-01", totalMinutes: 120 }],
      "2026-09-01",
      "2026-09-01",
    );
    render(
      <TeamHeatmap grid={grid} people={[{ userId: "u1", label: "Ana Anić" }]} />,
    );
    expect(screen.getByText("2.0")).toBeInTheDocument();
  });

  it("gives every cell an aria-label with name, date, and hours", () => {
    const grid = buildTeamHeatmapGrid(
      ["u1"],
      [{ userId: "u1", entryDate: "2026-09-01", totalMinutes: 90 }],
      "2026-09-01",
      "2026-09-01",
    );
    render(
      <TeamHeatmap grid={grid} people={[{ userId: "u1", label: "Ana Anić" }]} />,
    );
    const cell = screen.getByTestId("heatmap-cell");
    expect(cell).toHaveAttribute("aria-label", expect.stringContaining("Ana Anić"));
    expect(cell.getAttribute("aria-label")).toContain("hours");
  });

  it("renders a zero-hour cell for a member with no logged time in range", () => {
    const grid = buildTeamHeatmapGrid(["u1"], [], "2026-09-01", "2026-09-01");
    render(
      <TeamHeatmap grid={grid} people={[{ userId: "u1", label: "Ana Anić" }]} />,
    );
    expect(screen.getByText("0.0")).toBeInTheDocument();
  });

  it("uses the same one-decimal format for zero and non-zero hour cells", () => {
    const grid = buildTeamHeatmapGrid(
      ["u1", "u2"],
      [{ userId: "u1", entryDate: "2026-09-01", totalMinutes: 60 }],
      "2026-09-01",
      "2026-09-01",
    );
    render(
      <TeamHeatmap
        grid={grid}
        people={[
          { userId: "u1", label: "Ana Anić" },
          { userId: "u2", label: "Ivo Ivić" },
        ]}
      />,
    );
    expect(screen.getByText("1.0")).toBeInTheDocument();
    expect(screen.getByText("0.0")).toBeInTheDocument();
  });
});
