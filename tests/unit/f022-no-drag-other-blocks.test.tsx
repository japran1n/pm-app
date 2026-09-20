// @vitest-environment jsdom
//
// F022 (AS-043): a block owned by another member cannot be dragged to a
// new time. CalendarBlockChip gates its dnd-kit `useDraggable` on
// `canDrag && isOwnBlock(block, currentUserId)` (the same pattern
// week-time-grid.tsx's `canResize` uses for F021's resize handles).

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";

import { CalendarBlockChip } from "@/components/calendar/calendar-block-chip";
import type { CalendarBlock } from "@/lib/queries/calendar-blocks";

function makeBlock(userId: string): CalendarBlock {
  return {
    id: "block-1",
    workspaceId: "workspace-1",
    projectId: null,
    userId,
    title: "Focus time",
    startsAt: "2026-05-25T09:00:00.000Z",
    endsAt: "2026-05-25T10:00:00.000Z",
    color: null,
    blockType: "general",
  };
}

describe("F022 no drag-to-move on another member's block (AS-043)", () => {
  afterEach(() => {
    cleanup();
  });

  it("test_AS_043_own_block_is_draggable", () => {
    const block = makeBlock("user-1");
    render(
      <CalendarBlockChip
        block={block}
        canDrag
        currentUserId="user-1"
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const chip = screen.getByTestId(`calendar-block-chip-${block.id}`);
    expect(chip.getAttribute("data-draggable")).toBe("true");
    expect(chip.className).toContain("cursor-grab");
    expect(chip.className).not.toContain("cursor-default");
  });

  it("test_AS_043_other_members_block_is_not_draggable", () => {
    const block = makeBlock("user-2");
    render(
      <CalendarBlockChip
        block={block}
        canDrag
        currentUserId="user-1"
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const chip = screen.getByTestId(`calendar-block-chip-${block.id}`);
    expect(chip.getAttribute("data-draggable")).toBe("false");
    expect(chip.className).toContain("cursor-default");
    expect(chip.className).not.toContain("cursor-grab");
  });
});
