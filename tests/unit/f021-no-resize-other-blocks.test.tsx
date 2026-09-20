// @vitest-environment jsdom
//
// F021 (AS-042): resize handles must only render on a block the signed-in
// member owns. A teammate's block must show neither the top nor the
// bottom resize handle, even though the member still has write access to
// the workspace (canDrag alone is not the gate -- see isOwnBlock in
// lib/calendar/ownership.ts).

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
    title: "Deep work",
    startsAt: new Date(2026, 5, 1, 9, 0, 0, 0).toISOString(),
    endsAt: new Date(2026, 5, 1, 10, 0, 0, 0).toISOString(),
    color: null,
    blockType: "general",
  };
}

describe("F021 (AS-042): no resize handles on another member's block", () => {
  it("test_AS_042_own_block_shows_resize_handles", () => {
    render(
      <WeekTimeGrid
        days={[DAY]}
        blocksByDate={{ [DAY.date]: [makeBlock("user-1")] }}
        workspaceSlug="acme"
        workspaceId="workspace-1"
        currentUserId="user-1"
      />,
    );

    expect(screen.getByTestId("calendar-week-resize-start-block-1")).toBeInTheDocument();
    expect(screen.getByTestId("calendar-week-resize-end-block-1")).toBeInTheDocument();
  });

  it("test_AS_042_other_members_block_hides_resize_handles", () => {
    render(
      <WeekTimeGrid
        days={[DAY]}
        blocksByDate={{ [DAY.date]: [makeBlock("user-2")] }}
        workspaceSlug="acme"
        workspaceId="workspace-1"
        currentUserId="user-1"
      />,
    );

    expect(screen.queryByTestId("calendar-week-resize-start-block-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("calendar-week-resize-end-block-1")).not.toBeInTheDocument();
  });
});
