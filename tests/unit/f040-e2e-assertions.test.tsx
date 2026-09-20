// @vitest-environment jsdom
//
// F040 (AS-077, AS-078, AS-079): end-to-end behaviours exercised as
// unit-level integration tests (per the feature's clarified approach) since
// a live-server Playwright suite isn't wired up for this mission.
//
// AS-077: default load (no `?people=`) shows only the signed-in member's
// own planner -- parsePeopleParam(undefined, ...) never includes another
// active member's id.
//
// AS-078: selecting two people derives the "stacked" layout, never
// "week-grid" -- resolvePlannerLayout is the single source of that
// derivation (lib/calendar/planner-layout.ts).
//
// AS-079: a block owned by another member renders with no drag affordance.
// CalendarBlockChip (components/calendar/calendar-block-chip.tsx) is the
// actual chip StackedPersonRow's per-person grid would display a block
// through in the real app; its drag gate is `canDrag && isOwnBlock(...)`
// (F022), so this proves the chip itself refuses to wire up dnd-kit's
// pointer listeners for a block another member owns, regardless of the
// caller's own write permission.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { parsePeopleParam } from "@/lib/calendar/people-selection";
import { resolvePlannerLayout } from "@/lib/calendar/planner-layout";
import { CalendarBlockChip } from "@/components/calendar/calendar-block-chip";
import type { CalendarBlock } from "@/lib/queries/calendar-blocks";

afterEach(cleanup);

const SELF_ID = "self-id";
const OTHER_ID = "other-id";

function makeBlock(overrides: Partial<CalendarBlock> = {}): CalendarBlock {
  return {
    id: "block-1",
    title: "Standup",
    startsAt: "2026-09-14T09:00:00.000Z",
    endsAt: "2026-09-14T09:30:00.000Z",
    color: null,
    userId: OTHER_ID,
    ...overrides,
  } as CalendarBlock;
}

describe("F040 end-to-end assertions", () => {
  it("test_AS_077_default_load_shows_own_planner_only", () => {
    const result = parsePeopleParam(undefined, {
      selfId: SELF_ID,
      activeMemberIds: [SELF_ID, OTHER_ID],
    });
    expect(result).toEqual([SELF_ID]);
    expect(result).not.toContain(OTHER_ID);
  });

  it("test_AS_078_two_people_gives_stacked_layout", () => {
    expect(resolvePlannerLayout(2)).toBe("stacked");
    // negative sibling: a single selected person stays on the week grid
    expect(resolvePlannerLayout(1)).toBe("week-grid");
  });

  it("test_AS_079_other_member_block_has_no_drag_handle", () => {
    const block = makeBlock({ userId: OTHER_ID });

    render(
      <CalendarBlockChip
        block={block}
        canDrag={true}
        currentUserId={SELF_ID}
        onUpdate={() => {}}
        onDelete={() => {}}
      />,
    );

    const chip = screen.getByTestId(`calendar-block-chip-${block.id}`);
    // The chip's own data attribute records the drag gate's outcome...
    expect(chip).toHaveAttribute("data-draggable", "false");
    // ...and dnd-kit's pointer listener is never spread onto the element,
    // so there is no pointer-down handler wired up to start a drag.
    expect(chip.onpointerdown).toBeNull();
  });

  it("test_AS_079_own_block_does_have_a_drag_handle", () => {
    // Negative-of-the-negative sibling: the same chip, for a block the
    // viewer DOES own, is draggable -- proves the gate is ownership, not
    // some blanket "nothing is ever draggable" behaviour.
    const block = makeBlock({ userId: SELF_ID });

    render(
      <CalendarBlockChip
        block={block}
        canDrag={true}
        currentUserId={SELF_ID}
        onUpdate={() => {}}
        onDelete={() => {}}
      />,
    );

    const chip = screen.getByTestId(`calendar-block-chip-${block.id}`);
    expect(chip).toHaveAttribute("data-draggable", "true");
  });
});
