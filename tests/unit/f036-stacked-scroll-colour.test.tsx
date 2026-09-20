// @vitest-environment jsdom
//
// F036 (AS-067, AS-068, AS-069): stacked planner blocks keep their own
// colour, the stacked container scrolls instead of compressing rows, and
// hours/capacity/utilisation text never appears in either stacked file.

import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { StackedPersonRow } from "@/components/calendar/stacked-person-row";
import type { CalendarBlock } from "@/lib/queries/calendar-blocks";

afterEach(() => {
  cleanup();
});

const WEEK_KEY = "2026-09-14";

function makeBlock(overrides: Partial<CalendarBlock>): CalendarBlock {
  return {
    id: "block-1",
    workspaceId: "ws-1",
    projectId: null,
    userId: "user-1",
    title: "Test block",
    startsAt: "2026-09-14T09:00:00Z",
    endsAt: "2026-09-14T10:00:00Z",
    color: "#3366ff",
    blockType: "general",
    ...overrides,
  };
}

const plannerSource = readFileSync(
  path.join(process.cwd(), "components/calendar/stacked-planner.tsx"),
  "utf8",
);
describe("F036 stacked planner colour + scroll", () => {
  it("AS-067: a block chip renders with its own `color` field, not a substituted per-person colour", () => {
    render(
      <StackedPersonRow
        userId="user-1"
        userLabel="Alice"
        blocks={[makeBlock({ id: "block-red", color: "#ef4444" })]}
        weekKey={WEEK_KEY}
      />,
    );

    const chip = screen.getByTestId("stacked-block-block-red-1");
    // Background is the block's own color at ~10% alpha; border is the
    // block's own color at full opacity -- both derived from block.color,
    // never a hardcoded/person-level color.
    expect(chip).toHaveStyle({ borderColor: "#ef4444" });
    expect(chip.getAttribute("style")).toContain("239, 68, 68");
  });

  it("AS-067: two different blocks in the same row render two different colours", () => {
    render(
      <StackedPersonRow
        userId="user-1"
        userLabel="Alice"
        blocks={[
          makeBlock({
            id: "block-red",
            color: "#ef4444",
            startsAt: "2026-09-14T09:00:00Z",
            endsAt: "2026-09-14T10:00:00Z",
          }),
          makeBlock({
            id: "block-green",
            color: "#22c55e",
            startsAt: "2026-09-14T11:00:00Z",
            endsAt: "2026-09-14T12:00:00Z",
          }),
        ]}
        weekKey={WEEK_KEY}
      />,
    );

    const red = screen.getByTestId("stacked-block-block-red-1");
    const green = screen.getByTestId("stacked-block-block-green-1");
    expect(red).toHaveStyle({ borderColor: "#ef4444" });
    expect(green).toHaveStyle({ borderColor: "#22c55e" });
  });

  it("AS-068: stacked-planner.tsx scroll container uses overflow-y-auto (or overflow-y: auto)", () => {
    const hasOverflowAuto =
      /overflow-y-auto/.test(plannerSource) ||
      /overflow-y:\s*auto/.test(plannerSource);
    expect(hasOverflowAuto).toBe(true);
  });

  it("AS-068: stacked-planner.tsx scroll container has a fixed/max height, not a bare flex compress", () => {
    const hasMaxHeight = /max-h-\[/.test(plannerSource) || /maxHeight/.test(plannerSource);
    expect(hasMaxHeight).toBe(true);
  });

  it("test_AS_069_no_capacity_figure_in_any_planner_file", () => {
    const plannerFiles = [
      "app/(workspace)/w/[workspaceSlug]/calendar/page.tsx",
      "components/calendar/planner-header.tsx",
      "components/calendar/stacked-planner.tsx",
      "components/calendar/stacked-person-row.tsx",
      "components/calendar/week-view.tsx",
      "components/calendar/week-time-grid.tsx",
      "components/calendar/people-switcher.tsx",
    ];

    const capacityPatterns = [
      /\d+\s*h\s*(total|·|\/)/i, // "32h total" or "32h · " or "32h / 40h"
      /utilis[ae]tion/i, // "utilisation" or "utilization"
      /capacity/i,
      /\d+%\s*(load|utilis|capac)/i, // "80% load" or "80% utilisation"
      /load\s*:\s*\d/i, // "load: 80"
      /\bh\s*·\s*\d+%/i, // "32h · 80%"
    ];

    for (const file of plannerFiles) {
      const src = readFileSync(path.join(process.cwd(), file), "utf8");
      // Strip comments
      const stripped = src
        .replace(/\/\/[^\n]*/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      for (const pattern of capacityPatterns) {
        expect(
          stripped,
          `${file} must not contain capacity figure matching ${pattern}`,
        ).not.toMatch(pattern);
      }
    }
  });
});
