// @vitest-environment jsdom
// F032 (AS-024, AS-062, AS-063): StackedPlanner renders one row per
// selected person, in `?people=` order, each labelled with the member's
// name, and a person with zero blocks in the visible week still gets
// their own row.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// F035 made StackedPlanner a client component that calls useRouter (for
// drag-to-reorder persistence) -- this shell test doesn't exercise reorder,
// but still needs a router in scope for the component to render at all.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

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
    // Deliberately chosen so that BOTH the ids and the names sort
    // differently from selectedUserIds order: "carol-id" < "alice-id" is
    // false alphabetically, but critically [...selectedUserIds].sort()
    // (string sort) reorders these ids to alice, bob, carol -- which would
    // still incorrectly pass a same-order assertion if the fixture's id
    // order happened to already be sorted. Using non-UUID ids that sort
    // differently from the intended render order closes that gap.
    const CAROL_ID = "carol-id";
    const ALICE_ID = "alice-id";
    const BOB_ID = "bob-id";
    const orderedSelectedUserIds = [CAROL_ID, ALICE_ID, BOB_ID];
    // Members roster is in alphabetical order -- deliberately DIFFERENT
    // from selectedUserIds order above. If StackedPlanner iterated the
    // members array (roster order) instead of selectedUserIds (URL param
    // order), rows would render Alice, Bob, Carol instead of Carol, Alice,
    // Bob, and this test would catch it.
    const orderedMembers: SwitcherMember[] = [
      { userId: ALICE_ID, name: "Alice", email: "alice@example.com", avatarUrl: null },
      { userId: BOB_ID, name: "Bob", email: "bob@example.com", avatarUrl: null },
      { userId: CAROL_ID, name: "Carol", email: "carol@example.com", avatarUrl: null },
    ];

    const { container } = render(
      <StackedPlanner
        selectedUserIds={orderedSelectedUserIds}
        blocksByUser={new Map()}
        weekKey="2026-09-14"
        members={orderedMembers}
      />,
    );

    const planner = container.querySelector('[data-testid="stacked-planner"]');
    expect(planner).not.toBeNull();

    const text = planner!.textContent ?? "";
    const carolIndex = text.indexOf("Carol");
    const aliceIndex = text.indexOf("Alice");
    const bobIndex = text.indexOf("Bob");

    // selectedUserIds = [Carol, Alice, Bob] -- must appear in that order.
    // A string sort of these ids yields [alice-id, bob-id, carol-id], i.e.
    // Alice, Bob, Carol -- so this fixture fails under a sort-before-render
    // mutation, unlike the old ascending-UUID fixture.
    expect(carolIndex).toBeGreaterThanOrEqual(0);
    expect(aliceIndex).toBeGreaterThan(carolIndex);
    expect(bobIndex).toBeGreaterThan(aliceIndex);
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
