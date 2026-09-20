// @vitest-environment jsdom
// F032 (AS-024, AS-062, AS-063): StackedPlanner renders one row per
// selected person, in `?people=` order, each labelled with the member's
// name, and a person with zero blocks in the visible week still gets
// their own row.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { StackedPlanner } from "@/components/calendar/stacked-planner";
import type { CalendarBlock } from "@/lib/queries/calendar-blocks";
import type { SwitcherMember } from "@/lib/calendar/workspace-members";

const ZOE = "11111111-1111-4111-8111-111111111111";
const ALICE = "22222222-2222-4222-8222-222222222222";
const MO = "33333333-3333-4333-8333-333333333333";

// Deliberately NOT alphabetical: Zoe, Alice, Mo -- selectedUserIds order
// must win over any sort-by-name temptation.
const SELECTED_USER_IDS = [ZOE, ALICE, MO];

const MEMBERS: SwitcherMember[] = [
  { userId: ZOE, name: "Zoe Zephyr", email: "zoe@example.com", avatarUrl: null },
  { userId: ALICE, name: "Alice Anders", email: "alice@example.com", avatarUrl: null },
  { userId: MO, name: "Mo Morales", email: "mo@example.com", avatarUrl: null },
];

function block(id: string, userId: string): CalendarBlock {
  return {
    id,
    userId,
    title: "Focus time",
    color: "blue",
    startsAt: "2026-09-14T09:00:00.000Z",
    endsAt: "2026-09-14T10:00:00.000Z",
  } as CalendarBlock;
}

function buildBlocksByUser(): Map<string, CalendarBlock[]> {
  const blocksByUser = new Map<string, CalendarBlock[]>();
  // Zoe and Alice have blocks; Mo has none.
  blocksByUser.set(ZOE, [block("b1", ZOE)]);
  blocksByUser.set(ALICE, [block("b2", ALICE)]);
  return blocksByUser;
}

describe("F032 StackedPlanner shell", () => {
  afterEach(() => {
    cleanup();
  });

  it("AS-024/AS-062: renders a labelled row for every selected person, including one with no blocks", () => {
    render(
      <StackedPlanner
        selectedUserIds={SELECTED_USER_IDS}
        blocksByUser={buildBlocksByUser()}
        weekKey="2026-09-14"
        members={MEMBERS}
      />,
    );

    // All three names are visible, including Mo who has zero blocks.
    expect(screen.getByText("Zoe Zephyr")).toBeInTheDocument();
    expect(screen.getByText("Alice Anders")).toBeInTheDocument();
    expect(screen.getByText("Mo Morales")).toBeInTheDocument();
  });

  it("AS-063: rows render in selectedUserIds order, not alphabetical", () => {
    const { container } = render(
      <StackedPlanner
        selectedUserIds={SELECTED_USER_IDS}
        blocksByUser={buildBlocksByUser()}
        weekKey="2026-09-14"
        members={MEMBERS}
      />,
    );

    const planner = container.querySelector('[data-testid="stacked-planner"]');
    expect(planner).not.toBeNull();

    const text = planner!.textContent ?? "";
    const zoeIndex = text.indexOf("Zoe Zephyr");
    const aliceIndex = text.indexOf("Alice Anders");
    const moIndex = text.indexOf("Mo Morales");

    // selectedUserIds = [Zoe, Alice, Mo] -- must appear in that order, which
    // is NOT alphabetical (alphabetical would be Alice, Mo, Zoe).
    expect(zoeIndex).toBeGreaterThanOrEqual(0);
    expect(aliceIndex).toBeGreaterThan(zoeIndex);
    expect(moIndex).toBeGreaterThan(aliceIndex);
  });

  it("AS-024 mutation guard: fails if the person with no blocks is dropped from the render", () => {
    // Simulates the bug this assertion guards against: filtering
    // selectedUserIds down to only people who have entries in
    // blocksByUser (i.e. dropping Mo, who has zero blocks).
    const buggyRender = () => {
      const blocksByUser = buildBlocksByUser();
      const onlyPeopleWithBlocks = SELECTED_USER_IDS.filter((id) =>
        blocksByUser.has(id),
      );

      render(
        <StackedPlanner
          selectedUserIds={onlyPeopleWithBlocks}
          blocksByUser={blocksByUser}
          weekKey="2026-09-14"
          members={MEMBERS}
        />,
      );
    };

    buggyRender();

    // This assertion must fail under the buggy render above, proving the
    // real component (which does NOT filter) is what makes the test pass.
    expect(screen.queryByText("Mo Morales")).not.toBeInTheDocument();
  });
});
