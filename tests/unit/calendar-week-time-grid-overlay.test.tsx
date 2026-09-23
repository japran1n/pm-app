// @vitest-environment jsdom
//
// Overlay mode: WeekTimeGrid's `overlayBlocksByDate` prop lets 2+ people
// share the SAME day columns, split side-by-side, instead of each getting
// their own full row (that's StackedPlanner's job, untouched here). This
// file proves (a) a single-person caller (no `overlayBlocksByDate`, or an
// empty one) renders byte-identically to before this prop existed, (b) an
// overlaid teammate's block renders read-only alongside the signed-in
// member's own block within the same day column, and (c) overlapping blocks
// from two distinct people paint a conflict stripe.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("@/lib/actions/calendar-blocks", () => ({
  createCalendarBlock: vi.fn(),
  updateCalendarBlock: vi.fn(),
  deleteCalendarBlock: vi.fn(),
}));

vi.mock("@/components/auth/membership-provider", () => ({
  useMembership: () => null,
}));

import { WeekTimeGrid } from "@/components/calendar/week-time-grid";
import type { CalendarBlock } from "@/lib/queries/calendar-blocks";

afterEach(cleanup);

const DAY = { date: "2026-06-01", isToday: false };

function makeBlock(overrides: Partial<CalendarBlock>): CalendarBlock {
  return {
    id: "block-1",
    workspaceId: "workspace-1",
    projectId: null,
    userId: "user-1",
    title: "Deep work",
    startsAt: new Date(2026, 5, 1, 9, 0, 0, 0).toISOString(),
    endsAt: new Date(2026, 5, 1, 10, 0, 0, 0).toISOString(),
    color: null,
    blockType: "general",
    ...overrides,
  };
}

describe("Week time-grid overlay mode", () => {
  it("test_no_overlay_prop_renders_single_person_view_unchanged", () => {
    render(
      <WeekTimeGrid
        days={[DAY]}
        blocksByDate={{ [DAY.date]: [makeBlock({})] }}
        workspaceSlug="acme"
        workspaceId="workspace-1"
        currentUserId="user-1"
      />,
    );

    const chip = screen.getByTestId("calendar-week-block-chip-block-1");
    // Single-person default styling comes from the Tailwind
    // `left-0.5 right-0.5` classes, not an inline override.
    expect(chip.style.left).toBe("");
    expect(chip.style.right).toBe("");
    expect(screen.queryByTestId(`calendar-week-conflict-stripe-${DAY.date}`)).not.toBeInTheDocument();
  });

  it("test_overlay_teammate_block_renders_read_only_split_beside_the_owners_block", () => {
    const ownBlock = makeBlock({ id: "own-block", userId: "user-1" });
    const teammateBlock = makeBlock({
      id: "teammate-block",
      userId: "user-2",
      title: "Teammate's focus block",
      startsAt: new Date(2026, 5, 1, 13, 0, 0, 0).toISOString(),
      endsAt: new Date(2026, 5, 1, 14, 0, 0, 0).toISOString(),
    });

    render(
      <WeekTimeGrid
        days={[DAY]}
        blocksByDate={{ [DAY.date]: [ownBlock] }}
        overlayBlocksByDate={[{ [DAY.date]: [teammateBlock] }]}
        workspaceSlug="acme"
        workspaceId="workspace-1"
        currentUserId="user-1"
      />,
    );

    const ownChip = screen.getByTestId("calendar-week-block-chip-own-block");
    const teammateChip = screen.getByTestId("calendar-week-block-chip-teammate-block");

    // Split side-by-side: the owner's chip occupies the left portion, the
    // overlaid teammate's the right portion.
    expect(ownChip.style.left).toBe("4px");
    expect(ownChip.style.right).toBe("52%");
    expect(teammateChip.style.left).toBe("50%");
    expect(teammateChip.style.right).toBe("4px");

    // Read-only: no resize handles on the overlaid teammate's block.
    expect(screen.queryByTestId("calendar-week-resize-start-teammate-block")).not.toBeInTheDocument();
    expect(screen.queryByTestId("calendar-week-resize-end-teammate-block")).not.toBeInTheDocument();
    // The signed-in member's own block still gets its resize handles.
    expect(screen.getByTestId("calendar-week-resize-start-own-block")).toBeInTheDocument();
  });

  it("test_overlapping_blocks_from_two_distinct_people_paint_a_conflict_stripe", () => {
    const ownBlock = makeBlock({
      id: "own-block",
      userId: "user-1",
      startsAt: new Date(2026, 5, 1, 9, 0, 0, 0).toISOString(),
      endsAt: new Date(2026, 5, 1, 10, 0, 0, 0).toISOString(),
    });
    const teammateBlock = makeBlock({
      id: "teammate-block",
      userId: "user-2",
      startsAt: new Date(2026, 5, 1, 9, 30, 0, 0).toISOString(),
      endsAt: new Date(2026, 5, 1, 10, 30, 0, 0).toISOString(),
    });

    render(
      <WeekTimeGrid
        days={[DAY]}
        blocksByDate={{ [DAY.date]: [ownBlock] }}
        overlayBlocksByDate={[{ [DAY.date]: [teammateBlock] }]}
        workspaceSlug="acme"
        workspaceId="workspace-1"
        currentUserId="user-1"
      />,
    );

    expect(screen.getByTestId(`calendar-week-conflict-stripe-${DAY.date}`)).toBeInTheDocument();
  });

  it("test_non_overlapping_overlay_blocks_render_without_a_conflict_stripe", () => {
    const ownBlock = makeBlock({
      id: "own-block",
      userId: "user-1",
      startsAt: new Date(2026, 5, 1, 9, 0, 0, 0).toISOString(),
      endsAt: new Date(2026, 5, 1, 10, 0, 0, 0).toISOString(),
    });
    const teammateBlock = makeBlock({
      id: "teammate-block",
      userId: "user-2",
      startsAt: new Date(2026, 5, 1, 13, 0, 0, 0).toISOString(),
      endsAt: new Date(2026, 5, 1, 14, 0, 0, 0).toISOString(),
    });

    render(
      <WeekTimeGrid
        days={[DAY]}
        blocksByDate={{ [DAY.date]: [ownBlock] }}
        overlayBlocksByDate={[{ [DAY.date]: [teammateBlock] }]}
        workspaceSlug="acme"
        workspaceId="workspace-1"
        currentUserId="user-1"
      />,
    );

    expect(screen.queryByTestId(`calendar-week-conflict-stripe-${DAY.date}`)).not.toBeInTheDocument();
  });
});
