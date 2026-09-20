// @vitest-environment jsdom
//
// F023 (AS-044/AS-045): the calendar block popover shows an editable form
// (with Save + Delete) for the signed-in member's own block, but a
// read-only detail view (no Save button, no Delete button) for a block
// owned by another member.

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

import { CalendarBlockPopoverForm } from "@/components/calendar/calendar-block-popover-form";
import { WeekTimeGrid } from "@/components/calendar/week-time-grid";
import type { CalendarBlock } from "@/lib/queries/calendar-blocks";

afterEach(cleanup);

describe("F023: read-only popover for another member's block", () => {
  it("test_AS_044_isOwn_true_renders_save_and_delete_buttons", () => {
    render(
      <CalendarBlockPopoverForm
        initial={{ title: "Standup", startTime: "09:00", endTime: "09:30" }}
        submitLabel="Save"
        onSubmit={vi.fn()}
        onDelete={vi.fn()}
        isOwn
      />,
    );

    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("test_AS_045_isOwn_false_hides_save_and_delete_buttons", () => {
    render(
      <CalendarBlockPopoverForm
        initial={{ title: "Standup", startTime: "09:00", endTime: "09:30" }}
        submitLabel="Save"
        onSubmit={vi.fn()}
        onDelete={vi.fn()}
        isOwn={false}
      />,
    );

    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    // Still shows the block's details, just read-only.
    expect(screen.getByDisplayValue("Standup")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Standup")).toBeDisabled();
    expect(screen.getByTestId("calendar-block-readonly-note")).toBeInTheDocument();
  });
});

describe("F065 (AS-044/AS-045): WeekTimeGrid/WeekBlockChip wires isOwnBlock(block, currentUserId) into the popover", () => {
  const DAY = { date: "2026-06-01", isToday: false };

  function makeGridBlock(id: string, userId: string): CalendarBlock {
    return {
      id,
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

  it("test_AS_045_other_members_block_hides_save_and_delete", async () => {
    const user = userEvent.setup();
    const ownBlock = makeGridBlock("block-own", "user-own");
    const otherBlock = makeGridBlock("block-other", "user-other");

    render(
      <WeekTimeGrid
        days={[DAY]}
        blocksByDate={{ [DAY.date]: [ownBlock, otherBlock] }}
        workspaceSlug="acme"
        workspaceId="workspace-1"
        currentUserId="user-own"
      />,
    );

    await user.click(screen.getByTestId("calendar-week-block-chip-block-other"));

    expect(await screen.findByDisplayValue("Deep work")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.getByTestId("calendar-block-readonly-note")).toBeInTheDocument();
  });

  it("test_AS_044_own_block_shows_save_and_delete", async () => {
    const user = userEvent.setup();
    const ownBlock = makeGridBlock("block-own", "user-own");
    const otherBlock = makeGridBlock("block-other", "user-other");

    render(
      <WeekTimeGrid
        days={[DAY]}
        blocksByDate={{ [DAY.date]: [ownBlock, otherBlock] }}
        workspaceSlug="acme"
        workspaceId="workspace-1"
        currentUserId="user-own"
      />,
    );

    await user.click(screen.getByTestId("calendar-week-block-chip-block-own"));

    expect(await screen.findByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });
});
