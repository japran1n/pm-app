// @vitest-environment jsdom
//
// F087 accessibility/perf audit fixes.
//
// Item 1: components/portal/phase-timeline.tsx and
// components/portal/hours-burndown-chart.tsx wrapped their whole chart
// (including the focusable, per-row/per-week `role="button"` elements
// with their own accessible names) in `role="img"` -- ARIA flattens a
// `role="img"` subtree into a single presentational image, so those
// focusable rows were unreachable by Tab and unannounced by name. Fixed
// by changing the wrapper to `role="group"` (keeps the same
// `aria-label` summary, but no longer hides focusable descendants).
//
// Item 2: components/timeline/timeline-bar-draggable.tsx's two resize
// handles spread `tabIndex`/`role="button"` from dnd-kit's
// `resizeStart/EndAttributes` but only wired `onPointerDown` from
// `resizeStart/EndListeners` -- `onKeyDown` (how `KeyboardSensor`,
// registered in components/timeline/timeline-body.tsx, starts a
// keyboard drag) was never attached, so the handles were focusable but
// keyboard-inert. Fixed by wiring `onKeyDown` the same
// stopPropagation-then-delegate way `onPointerDown` already was.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
} from "@dnd-kit/core";

import { PhaseTimeline } from "@/components/portal/phase-timeline";
import { HoursBurndownChart } from "@/components/portal/hours-burndown-chart";
import {
  TimelineBarDraggable,
  RESIZE_START_PREFIX,
} from "@/components/timeline/timeline-bar-draggable";
import type { PortalPhase } from "@/lib/queries/portal";
import type { TimelineTask } from "@/lib/queries/timeline";
import type { TimelineBarLayout } from "@/lib/timeline/layout";

afterEach(cleanup);

function makePhase(overrides: Partial<PortalPhase> = {}): PortalPhase {
  return {
    id: "phase-1",
    name: "Design",
    position: 1,
    state: "active",
    plannedStart: "2026-06-01",
    plannedEnd: "2026-06-14",
    actualStart: null,
    actualEnd: null,
    clientDescription: null,
    totalClientVisibleTasks: 4,
    doneClientVisibleTasks: 1,
    progressPercent: 25,
    inFlightTaskTitle: null,
    ...overrides,
  };
}

describe("test_phase_timeline_focusable_rows_are_not_hidden_by_role_img", () => {
  it("wraps the chart in role=group (not role=img), which would hide focusable descendants", () => {
    render(<PhaseTimeline phases={[makePhase()]} today="2026-06-05" />);
    const chart = screen.getByTestId("phase-timeline");
    expect(chart).toHaveAttribute("role", "group");
    expect(chart).not.toHaveAttribute("role", "img");
  });

  it("each phase row is reachable as a named, focusable button inside the chart", () => {
    render(
      <PhaseTimeline
        phases={[makePhase({ id: "p1", name: "Design" }), makePhase({ id: "p2", name: "Build" })]}
        today="2026-06-05"
      />,
    );
    const chart = screen.getByTestId("phase-timeline");
    const row = within(chart).getByRole("button", { name: /Design/ });
    expect(row).toHaveAttribute("tabindex", "0");
    row.focus();
    expect(row).toHaveFocus();
  });
});

describe("test_hours_burndown_chart_focusable_columns_are_not_hidden_by_role_img", () => {
  it("wraps the chart in role=group (not role=img)", () => {
    render(
      <HoursBurndownChart
        weekly={[{ isoWeek: "2026-W23", minutes: 300, cumulativeMinutes: 300 }]}
        soldMinutes={1200}
        todayIso="2026-06-08"
      />,
    );
    const chart = screen.getByTestId("hours-burndown-chart");
    expect(chart).toHaveAttribute("role", "group");
    expect(chart).not.toHaveAttribute("role", "img");
  });
});

const RANGE_LAYOUT: TimelineBarLayout = { id: "t1", leftPx: 0, widthPx: 80, kind: "range" };

function makeTimelineTask(): TimelineTask {
  return {
    id: "t1",
    title: "Ship the release",
    status: "todo",
    statusCategory: "todo",
    isDone: false,
    priority: "medium",
    startDate: "2026-06-01",
    dueDate: "2026-06-05",
    number: 1,
    projectId: "project-1",
    projectKey: "PM",
    projectName: "Project",
    assignees: [],
  };
}

describe("test_timeline_resize_handle_keyboard_activation_starts_a_drag", () => {
  it("pressing Space on the resize-start handle activates the KeyboardSensor drag for that handle's own id, not the whole-bar move", () => {
    const onDragStart = vi.fn<(event: DragStartEvent) => void>();

    function Harness() {
      const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor),
      );
      return (
        <DndContext sensors={sensors} onDragStart={onDragStart}>
          <TimelineBarDraggable
            task={makeTimelineTask()}
            layout={RANGE_LAYOUT}
            workspaceSlug="acme"
            canDrag
          />
        </DndContext>
      );
    }

    render(<Harness />);

    const handle = screen.getByTestId("timeline-bar-resize-start");
    // dnd-kit's KeyboardSensor requires the activation keydown's
    // event.target to be the exact node it registered as the activator
    // (`active.activatorNode.current`) -- that is `setResizeStartNodeRef`'s
    // node here, so focusing + keydown-ing this element (not the parent
    // move region) is what proves the FIX (the handle itself is now
    // keyboard-operable), not a false pass via bubbling.
    handle.focus();
    fireEvent.keyDown(handle, { code: "Space" });

    expect(onDragStart).toHaveBeenCalledTimes(1);
    const activeId = onDragStart.mock.calls[0]![0].active.id;
    expect(activeId).toBe(`${RESIZE_START_PREFIX}t1`);
  });

  it("the resize-start handle has an accessible name distinct from the whole-bar move region", () => {
    render(
      <DndContext>
        <TimelineBarDraggable
          task={makeTimelineTask()}
          layout={RANGE_LAYOUT}
          workspaceSlug="acme"
          canDrag
        />
      </DndContext>,
    );
    const handle = screen.getByTestId("timeline-bar-resize-start");
    expect(handle).toHaveAccessibleName(/resize.*start date/i);
  });
});
