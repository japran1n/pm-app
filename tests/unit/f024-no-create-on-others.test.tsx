// @vitest-environment jsdom
//
// F024 (AS-047/AS-048/AS-049): no create affordance and no drag-to-create
// on another member's column. For today's single-column-per-day Planner
// view every column is always the signed-in member's own, so this is
// infrastructure for M7's stacked layout -- `CalendarWeekDay.userId` lets
// a test simulate "another member's column" even though nothing in the
// product currently renders one.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("@/lib/actions/calendar-blocks", () => ({
  createCalendarBlock: vi.fn().mockResolvedValue({ ok: true, data: {} }),
  updateCalendarBlock: vi.fn().mockResolvedValue({ ok: true, data: {} }),
  deleteCalendarBlock: vi.fn(),
}));

vi.mock("@/components/auth/membership-provider", () => ({
  useMembership: () => null,
}));

import { WeekTimeGrid } from "@/components/calendar/week-time-grid";

afterEach(cleanup);

const OWN_DAY = { date: "2026-06-01", isToday: false, userId: "user-1" };
const OTHER_DAY = { date: "2026-06-02", isToday: false, userId: "user-2" };

describe("F024: no create affordance/drag-to-create on another member's column", () => {
  it("test_AS_047_own_column_create_handler_fires", () => {
    render(
      <WeekTimeGrid
        days={[OWN_DAY]}
        blocksByDate={{}}
        workspaceSlug="acme"
        workspaceId="workspace-1"
        currentUserId="user-1"
      />,
    );

    const column = screen.getByTestId(`calendar-week-column-${OWN_DAY.date}`);
    fireEvent.mouseMove(column, { clientY: 100 });

    // The hover "+" create affordance appears on the signed-in member's
    // own column.
    expect(
      screen.getByTestId(`calendar-week-add-slot-${OWN_DAY.date}`),
    ).toBeInTheDocument();
  });

  it("test_AS_048_other_column_no_create_affordance", () => {
    render(
      <WeekTimeGrid
        days={[OTHER_DAY]}
        blocksByDate={{}}
        workspaceSlug="acme"
        workspaceId="workspace-1"
        currentUserId="user-1"
      />,
    );

    const column = screen.getByTestId(`calendar-week-column-${OTHER_DAY.date}`);
    fireEvent.mouseMove(column, { clientY: 100 });

    // No "+" create affordance on a column that belongs to another
    // member.
    expect(
      screen.queryByTestId(`calendar-week-add-slot-${OTHER_DAY.date}`),
    ).not.toBeInTheDocument();
  });

  it("test_AS_049_own_column_drag_gesture_creates_pending_block", () => {
    render(
      <WeekTimeGrid
        days={[OWN_DAY]}
        blocksByDate={{}}
        workspaceSlug="acme"
        workspaceId="workspace-1"
        currentUserId="user-1"
      />,
    );

    const column = screen.getByTestId(`calendar-week-column-${OWN_DAY.date}`);
    fireEvent.mouseMove(column, { clientY: 100 });
    const trigger = screen.getByTestId(`calendar-week-add-slot-${OWN_DAY.date}`);

    // A real press-and-drag gesture starting from the "+" trigger (the
    // only place a drag-create gesture may start -- see the handler's
    // own doc comment) on the member's own column runs the create
    // handler: dragging produces a live preview, and releasing opens the
    // create popover.
    fireEvent.pointerDown(trigger, { pointerId: 1, clientY: 100 });
    fireEvent.pointerMove(column, { pointerId: 1, clientY: 160 });
    expect(
      screen.getByTestId("calendar-week-drag-preview"),
    ).toBeInTheDocument();
    fireEvent.pointerUp(column, { pointerId: 1, clientY: 160 });
  });

  it("test_AS_049_other_column_drag_gesture_does_not_create", () => {
    render(
      <WeekTimeGrid
        days={[OTHER_DAY]}
        blocksByDate={{}}
        workspaceSlug="acme"
        workspaceId="workspace-1"
        currentUserId="user-1"
      />,
    );

    const column = screen.getByTestId(`calendar-week-column-${OTHER_DAY.date}`);

    // No "+" trigger ever renders on another member's column (AS-048),
    // so there's no gesture start point -- confirming there's no way to
    // begin a drag-create here, and that a raw pointer sequence directly
    // on the empty grid surface (bypassing the trigger entirely) still
    // never opens a create popover.
    expect(
      screen.queryByTestId(`calendar-week-add-slot-${OTHER_DAY.date}`),
    ).not.toBeInTheDocument();

    fireEvent.pointerDown(column, { pointerId: 1, clientY: 100 });
    fireEvent.pointerMove(column, { pointerId: 1, clientY: 200 });
    fireEvent.pointerUp(column, { pointerId: 1, clientY: 200 });

    expect(
      screen.queryByTestId("calendar-week-drag-preview"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("calendar-week-create-popover"),
    ).not.toBeInTheDocument();
  });
});
