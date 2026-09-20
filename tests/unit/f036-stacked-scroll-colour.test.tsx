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
const rowSource = readFileSync(
  path.join(process.cwd(), "components/calendar/stacked-person-row.tsx"),
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

  it("AS-069: neither stacked file mentions hours/capacity/utilisation/total/percent text", () => {
    const forbidden = [
      /\bcapacity\b/i,
      /\butili[sz]ation\b/i,
      /\btotal hours\b/i,
      /\bhours total\b/i,
      /%\s*(used|utilised|utilized|capacity)/i,
    ];

    for (const pattern of forbidden) {
      expect(plannerSource).not.toMatch(pattern);
      expect(rowSource).not.toMatch(pattern);
    }
  });
});
