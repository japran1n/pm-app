// @vitest-environment jsdom
//
// Click-to-create: clicking an empty slot in the week time-grid must
// immediately create a pending block AND show a popover the user can
// actually see/interact with to set its title, end time, and color. Prior
// to this fix, the popover's trigger was an invisible, unpositioned
// `sr-only` span rendered as a grid sibling with no relationship to the
// clicked cell -- `pendingCreate` state was set correctly, but the popup
// itself could render off-screen/clipped, making the click look like it
// did nothing. This file proves the popover actually becomes visible and
// submittable after a plain click (zero-delta pointerdown/pointerup), and
// that dismissing it clears `pendingCreate` so a later click doesn't leave
// a ghost popover around.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("@/lib/actions/calendar-blocks", () => ({
  createCalendarBlock: vi.fn().mockResolvedValue({
    ok: true,
    data: {
      id: "new-block",
      workspaceId: "workspace-1",
      projectId: null,
      userId: "user-1",
      taskId: null,
      title: "Focus time",
      startsAt: new Date(2026, 5, 1, 9, 0, 0, 0).toISOString(),
      endsAt: new Date(2026, 5, 1, 9, 15, 0, 0).toISOString(),
      color: null,
      blockType: "general",
    },
  }),
  updateCalendarBlock: vi.fn(),
  deleteCalendarBlock: vi.fn(),
}));

vi.mock("@/components/auth/membership-provider", () => ({
  useMembership: () => null,
}));

import { WeekTimeGrid } from "@/components/calendar/week-time-grid";
import { createCalendarBlock } from "@/lib/actions/calendar-blocks";

afterEach(cleanup);

const DAY = { date: "2026-06-01", isToday: false };

function mockColumnRect(column: Element) {
  vi.spyOn(column, "getBoundingClientRect").mockReturnValue({
    top: 0,
    left: 0,
    right: 200,
    bottom: 1000,
    width: 200,
    height: 1000,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

describe("Week time-grid click-to-create popover (AS: clicking empty grid space creates a block and lets the user configure it)", () => {
  it("test_a_plain_click_on_empty_grid_space_shows_a_visible_create_popover", async () => {
    render(
      <WeekTimeGrid
        days={[DAY]}
        tasksByDate={{}}
        blocksByDate={{}}
        workspaceSlug="acme"
        workspaceId="workspace-1"
      />,
    );

    const column = screen.getByTestId(`calendar-week-column-${DAY.date}`);
    mockColumnRect(column);

    // Plain click: pointerdown immediately followed by pointerup at the
    // same coordinates, no pointermove -- must still create a pending
    // block (see `dragRangeToTimes`'s zero-delta guarantee) AND show a
    // popover the user can actually see.
    fireEvent.pointerDown(column, { pointerId: 1, clientY: 9 * 60 });
    fireEvent.pointerUp(column, { pointerId: 1, clientY: 9 * 60 });

    const popover = await screen.findByTestId("calendar-week-create-popover");
    expect(popover).toBeVisible();
  });

  it("test_dismissing_the_create_popover_clears_pending_state_so_no_ghost_popover_remains", async () => {
    render(
      <WeekTimeGrid
        days={[DAY]}
        tasksByDate={{}}
        blocksByDate={{}}
        workspaceSlug="acme"
        workspaceId="workspace-1"
      />,
    );

    const column = screen.getByTestId(`calendar-week-column-${DAY.date}`);
    mockColumnRect(column);

    fireEvent.pointerDown(column, { pointerId: 1, clientY: 9 * 60 });
    fireEvent.pointerUp(column, { pointerId: 1, clientY: 9 * 60 });

    await screen.findByTestId("calendar-week-create-popover");

    // Escape dismisses the (controlled) popover, which must call onCancel
    // and clear `pendingCreate` -- otherwise a later click could leave a
    // stale popup or fail to reopen cleanly.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByTestId("calendar-week-create-popover")).not.toBeInTheDocument();
    });
  });

  it("test_submitting_the_create_popover_form_creates_the_real_block", async () => {
    render(
      <WeekTimeGrid
        days={[DAY]}
        tasksByDate={{}}
        blocksByDate={{}}
        workspaceSlug="acme"
        workspaceId="workspace-1"
      />,
    );

    const column = screen.getByTestId(`calendar-week-column-${DAY.date}`);
    mockColumnRect(column);

    fireEvent.pointerDown(column, { pointerId: 1, clientY: 9 * 60 });
    fireEvent.pointerUp(column, { pointerId: 1, clientY: 9 * 60 });

    await screen.findByTestId("calendar-week-create-popover");

    const titleInput = screen.getByLabelText(/title/i);
    fireEvent.change(titleInput, { target: { value: "Focus time" } });

    const submitButton = screen.getByRole("button", { name: /add block/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(createCalendarBlock).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: "workspace-1", title: "Focus time" }),
      );
    });

    await waitFor(() => {
      expect(screen.queryByTestId("calendar-week-create-popover")).not.toBeInTheDocument();
    });
  });
});
