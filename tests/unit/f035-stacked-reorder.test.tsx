// @vitest-environment jsdom
//
// F035 (AS-064, AS-065): a stacked row can be dragged to a new position,
// and doing so rewrites `?people=` so the new order survives a reload.
// jsdom has no real pointer/drag simulation, so -- same pattern as
// f024-drag-cancellation.test.tsx -- this test captures the exact
// `onDragEnd` prop StackedPlanner passes to its DndContext and invokes it
// directly.

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";

let capturedOnDragEnd: ((event: unknown) => void) | undefined;

vi.mock("@dnd-kit/core", async () => {
  const actual = await vi.importActual<typeof import("@dnd-kit/core")>("@dnd-kit/core");
  return {
    ...actual,
    DndContext: ({
      children,
      onDragEnd,
    }: {
      children: ReactNode;
      onDragEnd?: (event: unknown) => void;
    }) => {
      capturedOnDragEnd = onDragEnd;
      return children;
    },
  };
});

const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: replaceMock, refresh: vi.fn() }),
}));

import { StackedPlanner } from "@/components/calendar/stacked-planner";
import type { CalendarBlock } from "@/lib/queries/calendar-blocks";
import type { SwitcherMember } from "@/lib/calendar/workspace-members";

const SELF_ID = "11111111-1111-4111-8111-111111111111";
const PERSON_A = "22222222-2222-4222-8222-222222222222";
const PERSON_B = "33333333-3333-4333-8333-333333333333";

const MEMBERS: SwitcherMember[] = [
  { userId: SELF_ID, name: "Self", email: "self@example.com", avatarUrl: null },
  { userId: PERSON_A, name: "Person A", email: "a@example.com", avatarUrl: null },
  { userId: PERSON_B, name: "Person B", email: "b@example.com", avatarUrl: null },
];

function renderPlanner(selectedUserIds: string[]) {
  return render(
    <StackedPlanner
      selectedUserIds={selectedUserIds}
      blocksByUser={new Map<string, CalendarBlock[]>()}
      weekKey="2026-09-14"
      members={MEMBERS}
      workspaceSlug="acme"
      selfId={SELF_ID}
    />,
  );
}

afterEach(() => {
  cleanup();
  capturedOnDragEnd = undefined;
  replaceMock.mockClear();
});

describe("F035 stacked row reorder", () => {
  it("AS-064/AS-065: dragging B from position 2 to position 1 calls router.replace with a `?people=` URL", () => {
    // [Self, A, B] -- A at index 1, B at index 2.
    renderPlanner([SELF_ID, PERSON_A, PERSON_B]);

    expect(capturedOnDragEnd).toBeInstanceOf(Function);

    // Drag B onto A's slot.
    capturedOnDragEnd?.({ active: { id: PERSON_B }, over: { id: PERSON_A } });

    expect(replaceMock).toHaveBeenCalledTimes(1);
    const calledUrl = replaceMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("?people=");
  });

  it("AS-065: the reordered URL contains ids in the new order -- B first, then A", () => {
    renderPlanner([SELF_ID, PERSON_A, PERSON_B]);

    capturedOnDragEnd?.({ active: { id: PERSON_B }, over: { id: PERSON_A } });

    const calledUrl = replaceMock.mock.calls[0][0] as string;
    const peopleValue = new URL(calledUrl, "http://localhost").searchParams.get("people") ?? "";
    const ids = peopleValue.split(",");

    const bIndex = ids.indexOf(PERSON_B);
    const aIndex = ids.indexOf(PERSON_A);
    expect(bIndex).toBeGreaterThanOrEqual(0);
    expect(aIndex).toBeGreaterThan(bIndex);
  });

  it("AS-065: a drag that doesn't change position does NOT call router.replace", () => {
    renderPlanner([SELF_ID, PERSON_A, PERSON_B]);

    // Dropped back onto itself -- no position change.
    capturedOnDragEnd?.({ active: { id: PERSON_A }, over: { id: PERSON_A } });

    expect(replaceMock).not.toHaveBeenCalled();
  });
});
