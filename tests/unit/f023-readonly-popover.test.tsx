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

import { CalendarBlockPopoverForm } from "@/components/calendar/calendar-block-popover-form";
import { CalendarBlockChip } from "@/components/calendar/calendar-block-chip";
import type { CalendarBlock } from "@/lib/queries/calendar-blocks";

afterEach(cleanup);

function makeBlock(overrides: Partial<CalendarBlock> = {}): CalendarBlock {
  return {
    id: "block-1",
    workspaceId: "ws-1",
    projectId: null,
    userId: "user-owner",
    title: "Standup",
    startsAt: "2026-09-20T09:00:00.000Z",
    endsAt: "2026-09-20T09:30:00.000Z",
    color: null,
    blockType: "general",
    ...overrides,
  };
}

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

describe("F063 (AS-044/AS-045): chip wires isOwnBlock(block, currentUserId) into the popover", () => {
  it("test_AS_045_chip_hides_save_and_delete_for_another_members_block", async () => {
    const user = userEvent.setup();
    const block = makeBlock({ userId: "user-owner" });

    render(
      <CalendarBlockChip
        block={block}
        canDrag
        currentUserId="user-other"
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId(`calendar-block-chip-${block.id}`));

    expect(await screen.findByDisplayValue("Standup")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.getByTestId("calendar-block-readonly-note")).toBeInTheDocument();
  });

  it("test_AS_044_chip_shows_save_and_delete_for_own_block", async () => {
    const user = userEvent.setup();
    const block = makeBlock({ userId: "user-owner" });

    render(
      <CalendarBlockChip
        block={block}
        canDrag
        currentUserId="user-owner"
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId(`calendar-block-chip-${block.id}`));

    expect(await screen.findByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });
});
