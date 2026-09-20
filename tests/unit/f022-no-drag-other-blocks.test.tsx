// @vitest-environment jsdom
//
// F022/F062 (AS-043): a block owned by another member cannot be
// drag-to-moved/resized by the signed-in viewer.
//
// F022 originally gated `CalendarBlockChip`'s dnd-kit `useDraggable`, but
// that component has no production call site -- `calendar-day-grid.tsx`
// (its only consumer) was deleted in F057. The Planner's ACTUAL block
// component is `WeekBlockChip`, defined inline in `week-time-grid.tsx` and
// rendered by the exported `WeekTimeGrid`. That component has no
// drag-to-move gesture at all (no dnd-kit, no pointer-based "move" handler)
// -- the only pointer-drag affordance an existing block exposes is its two
// resize handles (`calendar-week-resize-start-*` / `-end-*`), which retime
// the block by dragging its top/bottom edge. Those handles are the real
// "drag" surface AS-043 is about, and they're gated on
// `canDrag && isOwnBlock(block, currentUserId)` (see `canResize` in
// week-time-grid.tsx). This test exercises that LIVE component instead of
// the dead `CalendarBlockChip`.

import { cleanup, render, screen } from "@testing-library/react";
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
import type { CalendarBlock } from "@/lib/queries/calendar-blocks";

afterEach(cleanup);

const DAY = { date: "2026-06-01", isToday: false };

function makeBlock(userId: string): CalendarBlock {
  return {
    id: "block-1",
    workspaceId: "workspace-1",
    projectId: null,
    userId,
    title: "Focus time",
    startsAt: new Date(2026, 5, 1, 9, 0, 0, 0).toISOString(),
    endsAt: new Date(2026, 5, 1, 10, 0, 0, 0).toISOString(),
    color: null,
    blockType: "general",
  };
}

describe("F022/F062 no drag-to-move on another member's block (AS-043)", () => {
  it("test_AS_043_own_block_is_draggable", () => {
    render(
      <WeekTimeGrid
        days={[DAY]}
        blocksByDate={{ [DAY.date]: [makeBlock("user-1")] }}
        workspaceSlug="acme"
        workspaceId="workspace-1"
        currentUserId="user-1"
      />,
    );

    // The block's own drag surface -- its resize handles -- is present
    // for a block the signed-in member owns.
    expect(screen.getByTestId("calendar-week-resize-start-block-1")).toBeInTheDocument();
    expect(screen.getByTestId("calendar-week-resize-end-block-1")).toBeInTheDocument();
  });

  it("test_AS_043_other_members_block_is_not_draggable", () => {
    render(
      <WeekTimeGrid
        days={[DAY]}
        blocksByDate={{ [DAY.date]: [makeBlock("user-2")] }}
        workspaceSlug="acme"
        workspaceId="workspace-1"
        currentUserId="user-1"
      />,
    );

    // No drag surface at all renders for a teammate's block -- neither
    // resize handle, which is the only pointer-drag gesture an existing
    // block exposes in the live Planner.
    expect(screen.queryByTestId("calendar-week-resize-start-block-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("calendar-week-resize-end-block-1")).not.toBeInTheDocument();
  });
});
