// @vitest-environment jsdom
//
// F033 (AS-018, AS-019, AS-020, AS-021, AS-022): stacked-planner per-person
// row renders a Mon-Fri x 08:00-16:00 grid, clips blocks to that window, and
// drops blocks with no overlap (weekend or entirely-outside-hours).

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { StackedPersonRow } from "@/components/calendar/stacked-person-row";
import type { CalendarBlock } from "@/lib/queries/calendar-blocks";

afterEach(() => {
  cleanup();
});

// Monday of the test week, 2026-09-14 (a real Monday).
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

describe("F033 StackedPersonRow", () => {
  it("AS-018: renders hours 08:00-16:00 and not 00:00-07:00 / 17:00-23:00", () => {
    render(
      <StackedPersonRow
        userId="user-1"
        blocks={[]}
        weekKey={WEEK_KEY}
      />,
    );

    for (let hour = 8; hour < 16; hour++) {
      expect(
        screen.getByTestId(`stacked-hour-1-${hour}`),
      ).toBeInTheDocument();
    }

    for (const hour of [0, 1, 2, 3, 4, 5, 6, 7, 16, 17, 18, 19, 20, 21, 22, 23]) {
      expect(
        screen.queryByTestId(`stacked-hour-1-${hour}`),
      ).not.toBeInTheDocument();
    }
  });

  it("AS-019: renders Mon-Fri columns and not Saturday/Sunday", () => {
    render(
      <StackedPersonRow userId="user-1" blocks={[]} weekKey={WEEK_KEY} />,
    );

    for (const isoWeekday of [1, 2, 3, 4, 5]) {
      expect(
        screen.getByTestId(`stacked-day-${isoWeekday}`),
      ).toBeInTheDocument();
    }

    expect(screen.queryByTestId("stacked-day-6")).not.toBeInTheDocument();
    expect(screen.queryByTestId("stacked-day-7")).not.toBeInTheDocument();
  });

  it("test_AS_019_stacked_row_shows_mon_to_fri_labels: rendered day-column labels are Mon..Fri in order, no Sat/Sun", () => {
    render(
      <StackedPersonRow userId="user-1" blocks={[]} weekKey={WEEK_KEY} />,
    );

    const labels = [1, 2, 3, 4, 5].map(
      (isoWeekday) =>
        screen.getByTestId(`stacked-day-${isoWeekday}`).textContent?.trim(),
    );

    expect(labels).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);
    expect(labels).not.toContain("Sun");
    expect(labels).not.toContain("Sat");

    const monIdx = labels.indexOf("Mon");
    const friIdx = labels.indexOf("Fri");
    expect(monIdx).toBeGreaterThanOrEqual(0);
    expect(monIdx).toBeLessThan(friIdx);
  });

  it("AS-020: a block from 17:00-18:00 (outside 08:00-16:00) is not rendered", () => {
    const block = makeBlock({
      id: "outside-block",
      startsAt: "2026-09-14T17:00:00Z",
      endsAt: "2026-09-14T18:00:00Z",
    });

    render(
      <StackedPersonRow userId="user-1" blocks={[block]} weekKey={WEEK_KEY} />,
    );

    expect(
      screen.queryByTestId(`stacked-block-${block.id}-1`),
    ).not.toBeInTheDocument();
  });

  it("AS-021: a block on Saturday is not rendered", () => {
    // 2026-09-19 is the Saturday of the test week.
    const block = makeBlock({
      id: "saturday-block",
      startsAt: "2026-09-19T09:00:00Z",
      endsAt: "2026-09-19T10:00:00Z",
    });

    render(
      <StackedPersonRow userId="user-1" blocks={[block]} weekKey={WEEK_KEY} />,
    );

    for (const isoWeekday of [1, 2, 3, 4, 5]) {
      expect(
        screen.queryByTestId(`stacked-block-${block.id}-${isoWeekday}`),
      ).not.toBeInTheDocument();
    }
  });

  it("AS-022: a block from 06:00-10:00 is clipped and rendered within the visible window", () => {
    const block = makeBlock({
      id: "clipped-block",
      startsAt: "2026-09-14T06:00:00Z",
      endsAt: "2026-09-14T10:00:00Z",
    });

    render(
      <StackedPersonRow userId="user-1" blocks={[block]} weekKey={WEEK_KEY} />,
    );

    const chip = screen.getByTestId(`stacked-block-${block.id}-1`);
    expect(chip).toBeInTheDocument();
    // Clipped start is 08:00 -> 0% offset from the top of the 08:00-16:00
    // window (2 hours of the 4-hour block, i.e. 08:00-10:00, remain).
    expect(chip.style.top).toBe("0%");
    // 08:00-10:00 out of an 8-hour window is 25% tall.
    expect(chip.style.height).toBe("25%");
  });

  it("test_AS_022_block_top_position_nonzero: a block starting at 10:00 has a top of 25%", () => {
    // Not clipped -- fully inside the 08:00-16:00 window, so this exercises
    // a non-zero top: 10:00 is 2h into the 8h window == 25% from the top.
    const block = makeBlock({
      id: "nonzero-top-block",
      startsAt: "2026-09-14T10:00:00Z",
      endsAt: "2026-09-14T11:00:00Z",
    });

    render(
      <StackedPersonRow userId="user-1" blocks={[block]} weekKey={WEEK_KEY} />,
    );

    const chip = screen.getByTestId(`stacked-block-${block.id}-1`);
    expect(chip).toBeInTheDocument();
    expect(chip.style.top).toBe("25%");
    // 10:00-11:00 out of an 8-hour window is 12.5% tall.
    expect(chip.style.height).toBe("12.5%");
  });
});
