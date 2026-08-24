// F239 (AS-455): pure connector-geometry tests -- the same
// "test the pure maths against the assertion text, not the code" shape
// tests/unit/timeline-layout.test.ts already uses for its sibling
// features.

import { describe, expect, it } from "vitest";

import {
  computeBarLayout,
  computeDependencyConnectors,
  computeTimelineRowPositions,
  timelineBodyTotalHeightPx,
  TIMELINE_GROUP_HEADER_HEIGHT_PX,
  TIMELINE_ROW_HEIGHT_PX,
  type TimelineBarLayout,
} from "@/lib/timeline/layout";

describe("F239 computeTimelineRowPositions", () => {
  it("test_AS_455_row_positions_stack_one_group_header_then_one_row_per_task", () => {
    const groups = [
      { tasks: [{ id: "a" }, { id: "b" }] },
      { tasks: [{ id: "c" }] },
    ];
    const positions = computeTimelineRowPositions(groups);
    expect(positions.get("a")).toBe(TIMELINE_GROUP_HEADER_HEIGHT_PX);
    expect(positions.get("b")).toBe(TIMELINE_GROUP_HEADER_HEIGHT_PX + TIMELINE_ROW_HEIGHT_PX);
    expect(positions.get("c")).toBe(
      TIMELINE_GROUP_HEADER_HEIGHT_PX * 2 + TIMELINE_ROW_HEIGHT_PX * 2,
    );
  });

  it("test_AS_455_total_height_covers_every_group_header_and_row", () => {
    const groups = [{ tasks: [{ id: "a" }, { id: "b" }] }, { tasks: [{ id: "c" }] }];
    expect(timelineBodyTotalHeightPx(groups)).toBe(
      TIMELINE_GROUP_HEADER_HEIGHT_PX * 2 + TIMELINE_ROW_HEIGHT_PX * 3,
    );
  });
});

describe("F239 computeDependencyConnectors (AS-455)", () => {
  const rangeStart = "2026-08-01";
  const rangeEnd = "2026-08-31";
  const pixelsPerDay = 10;

  function barFor(id: string, startDate: string | null, dueDate: string | null): TimelineBarLayout {
    return computeBarLayout({ id, startDate: startDate as never, dueDate: dueDate as never }, rangeStart, rangeEnd, pixelsPerDay)!;
  }

  it("test_AS_455_a_real_dependency_between_two_rendered_tasks_produces_a_connector", () => {
    const blocking = barFor("blocking", "2026-08-01", "2026-08-05");
    const blocked = barFor("blocked", "2026-08-10", "2026-08-15");
    const rowPositions = new Map([
      ["blocking", 40],
      ["blocked", 88],
    ]);
    const barLayouts = new Map([
      ["blocking", blocking],
      ["blocked", blocked],
    ]);
    const connectors = computeDependencyConnectors(
      [{ id: "dep-1", blockingTaskId: "blocking", blockedTaskId: "blocked" }],
      rowPositions,
      barLayouts,
    );
    expect(connectors).toHaveLength(1);
    expect(connectors[0].id).toBe("dep-1");
    // Starts at the blocking bar's trailing (right) edge.
    expect(connectors[0].d.startsWith(`M ${blocking.leftPx + blocking.widthPx} `)).toBe(true);
    // Ends at the blocked bar's leading (left) edge.
    expect(connectors[0].d.endsWith(`${blocked.leftPx} ${88 + TIMELINE_ROW_HEIGHT_PX / 2}`)).toBe(true);
  });

  it("test_AS_455_negative_an_endpoint_with_no_known_row_position_is_omitted_not_drawn_toward_nowhere", () => {
    const blocking = barFor("blocking", "2026-08-01", "2026-08-05");
    const rowPositions = new Map([["blocking", 40]]);
    const barLayouts = new Map([["blocking", blocking]]);
    // "invisible-endpoint" simulates both a private-project leak case and
    // an off-screen/filtered/date-less endpoint -- from this pure
    // function's own contract they're indistinguishable and handled
    // identically: no row position, no connector, no confirmation the
    // other task exists.
    const connectors = computeDependencyConnectors(
      [{ id: "dep-2", blockingTaskId: "blocking", blockedTaskId: "invisible-endpoint" }],
      rowPositions,
      barLayouts,
    );
    expect(connectors).toHaveLength(0);
  });

  it("test_AS_455_negative_a_date_less_endpoint_with_no_bar_layout_is_omitted", () => {
    const blocking = barFor("blocking", "2026-08-01", "2026-08-05");
    const rowPositions = new Map([
      ["blocking", 40],
      ["dateless", 88],
    ]);
    // `dateless` has a row position (was in the fetched set) but no bar
    // layout (excluded by isPlaceableOnTimeline) -- documented behaviour:
    // no anchor, so no connector, matching AS-452's own "excluded
    // entirely" rule for a task with neither date.
    const barLayouts = new Map([["blocking", blocking]]);
    const connectors = computeDependencyConnectors(
      [{ id: "dep-3", blockingTaskId: "blocking", blockedTaskId: "dateless" }],
      rowPositions,
      barLayouts,
    );
    expect(connectors).toHaveLength(0);
  });

  it("test_AS_455_a_cross_project_dependency_renders_the_same_way_as_a_same_project_one", () => {
    // Row positions/bar layouts carry no notion of "project" at all --
    // a dependency between two tasks in different project groups is
    // geometrically identical to one within the same group; this test
    // documents that there is no project-aware branch to break.
    const blocking = barFor("blocking", "2026-08-01", "2026-08-05");
    const blocked = barFor("blocked", "2026-08-20", "2026-08-25");
    const rowPositions = new Map([
      ["blocking", 40], // group 1's only row
      ["blocked", 168], // a later group's row, several groups down
    ]);
    const barLayouts = new Map([
      ["blocking", blocking],
      ["blocked", blocked],
    ]);
    const connectors = computeDependencyConnectors(
      [{ id: "dep-4", blockingTaskId: "blocking", blockedTaskId: "blocked" }],
      rowPositions,
      barLayouts,
    );
    expect(connectors).toHaveLength(1);
  });
});
