// @vitest-environment jsdom
//
// Live-synced resize: dragging a block's own resize handle must update the
// block's VISUAL height/position on every mousemove (not only once at the
// final mouseup), and show a live "HH:MM - HH:MM" text label the whole
// time the handle is held, snapped to 15-minute increments exactly like
// the pure `applyResize`/`dragRangeToTimes` maths tests/unit/calendar-
// time-grid-layout.test.ts already covers in isolation -- this file proves
// the COMPONENT actually wires mousemove into that same maths in real
// time, which a pure-function test alone can't catch (deleting the
// mousemove-time `resizePreviewPx` wiring would leave those pure-function
// tests green while the on-screen behaviour silently regressed to
// "resize only happens after you let go").

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("@/lib/actions/calendar-blocks", () => ({
  createCalendarBlock: vi.fn(),
  updateCalendarBlock: vi.fn().mockResolvedValue({ ok: true, data: {} }),
  deleteCalendarBlock: vi.fn(),
}));

vi.mock("@/components/auth/membership-provider", () => ({
  useMembership: () => null,
}));

import { WeekTimeGrid } from "@/components/calendar/week-time-grid";
import { PX_PER_HOUR } from "@/lib/calendar/time-grid-layout";
import type { CalendarBlock } from "@/lib/queries/calendar-blocks";

afterEach(cleanup);

const DAY = { date: "2026-06-01", isToday: false };

function makeBlock(): CalendarBlock {
  return {
    id: "block-1",
    workspaceId: "workspace-1",
    projectId: null,
    userId: "user-1",
    taskId: null,
    title: "Deep work",
    startsAt: new Date(2026, 5, 1, 9, 0, 0, 0).toISOString(),
    endsAt: new Date(2026, 5, 1, 10, 0, 0, 0).toISOString(),
    color: null,
  };
}

describe("Week time-grid live-synced resize (AS: resize is synced with time as it happens)", () => {
  it("test_dragging_the_end_handle_updates_the_visible_time_label_before_mouseup", () => {
    render(
      <WeekTimeGrid
        days={[DAY]}
        tasksByDate={{}}
        blocksByDate={{ [DAY.date]: [makeBlock()] }}
        workspaceSlug="acme"
        workspaceId="workspace-1"
      />,
    );

    // Before any drag: the chip shows its own static, persisted range.
    expect(screen.getByTestId("calendar-week-block-time-block-1")).toHaveTextContent("9:00 AM–10:00 AM");

    const column = screen.getByTestId(`calendar-week-column-${DAY.date}`);
    vi.spyOn(column, "getBoundingClientRect").mockReturnValue({
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const endHandle = screen.getByTestId("calendar-week-resize-end-block-1");
    fireEvent.mouseDown(endHandle);

    // Drag the end handle down to 12:00 -- still mid-drag, mouseup NOT
    // fired yet.
    fireEvent.mouseMove(column, { clientY: 12 * PX_PER_HOUR });

    // Live sync (the actual assertion): the label reflects the DRAGGED-TO
    // time immediately, before the mouse is released.
    expect(screen.getByTestId("calendar-week-block-time-block-1")).toHaveTextContent("9:00 AM–12:00 PM");
  });

  it("test_resize_drag_preview_snaps_to_15_minute_increments_while_dragging", () => {
    render(
      <WeekTimeGrid
        days={[DAY]}
        tasksByDate={{}}
        blocksByDate={{ [DAY.date]: [makeBlock()] }}
        workspaceSlug="acme"
        workspaceId="workspace-1"
      />,
    );

    const column = screen.getByTestId(`calendar-week-column-${DAY.date}`);
    vi.spyOn(column, "getBoundingClientRect").mockReturnValue({
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const endHandle = screen.getByTestId("calendar-week-resize-end-block-1");
    fireEvent.mouseDown(endHandle);

    // 12:07 in pixels -- should snap to 12:00, never show an unsnapped
    // "12:07".
    fireEvent.mouseMove(column, { clientY: (12 * 60 + 7) * (PX_PER_HOUR / 60) });

    expect(screen.getByTestId("calendar-week-block-time-block-1")).toHaveTextContent("9:00 AM–12:00 PM");
  });

  it("test_resize_commits_the_final_dragged_time_on_mouseup", async () => {
    const { updateCalendarBlock } = await import("@/lib/actions/calendar-blocks");

    render(
      <WeekTimeGrid
        days={[DAY]}
        tasksByDate={{}}
        blocksByDate={{ [DAY.date]: [makeBlock()] }}
        workspaceSlug="acme"
        workspaceId="workspace-1"
      />,
    );

    const column = screen.getByTestId(`calendar-week-column-${DAY.date}`);
    vi.spyOn(column, "getBoundingClientRect").mockReturnValue({
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const endHandle = screen.getByTestId("calendar-week-resize-end-block-1");
    fireEvent.mouseDown(endHandle);
    fireEvent.mouseMove(column, { clientY: 12 * PX_PER_HOUR });
    fireEvent.mouseUp(column);

    expect(updateCalendarBlock).toHaveBeenCalledWith(
      expect.objectContaining({ blockId: "block-1" }),
    );
    const call = (updateCalendarBlock as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(new Date(call.endsAt).getHours()).toBe(12);
  });
});
