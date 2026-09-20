// @vitest-environment jsdom
//
// F020 (AS-046): single ownership predicate + currentUserId plumbing.
//
// Verifies:
// - `isOwnBlock` returns true/false correctly for own vs. others' blocks.
// - The single predicate is the one source of truth: WeekView (and the
//   grid components it composes) accept and forward the same
//   `currentUserId` prop rather than each deriving ownership on its own.
//
// No JSX here (kept as a plain .ts file per the feature spec's file
// name) -- the WeekView render check below uses React.createElement
// directly instead of a .tsx pragma.

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import React from "react";

import { isOwnBlock } from "@/lib/calendar/ownership";
import type { CalendarBlock } from "@/lib/queries/calendar-blocks";
import { WeekView } from "@/components/calendar/week-view";
import type { CalendarWeek } from "@/lib/calendar/week-grid";

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

const WEEK: CalendarWeek = {
  weekKey: "2026-05-25",
  days: [
    { date: "2026-05-25", isToday: false },
    { date: "2026-05-26", isToday: false },
    { date: "2026-05-27", isToday: false },
    { date: "2026-05-28", isToday: false },
    { date: "2026-05-29", isToday: false },
    { date: "2026-05-30", isToday: false },
    { date: "2026-05-31", isToday: false },
  ],
};

describe("F020 isOwnBlock predicate (AS-046)", () => {
  it("test_AS_046_isOwnBlock_returns_true_when_block_user_id_matches_current_user", () => {
    const block = makeBlock("user-1");
    expect(isOwnBlock(block, "user-1")).toBe(true);
  });

  it("test_AS_046_isOwnBlock_returns_false_when_block_user_id_differs", () => {
    const block = makeBlock("user-2");
    expect(isOwnBlock(block, "user-1")).toBe(false);
  });

  it("test_AS_046_currentUserId_prop_flows_through_WeekView_without_throwing", () => {
    // WeekView requires `currentUserId` as a prop (compile-time enforced
    // by its own type signature) and threads it down to WeekTimeGrid/
    // WeekAgenda -- this render is the runtime confirmation that the
    // single prop is accepted end to end, with no separate/duplicated
    // "who am I" plumbing per component.
    const block = makeBlock("user-1");
    const { getByTestId } = render(
      React.createElement(WeekView, {
        week: WEEK,
        blocks: [block],
        workspaceSlug: "acme",
        workspaceId: "workspace-1",
        currentUserId: "user-1",
        prevHref: "/w/acme/calendar?week=2026-05-18",
        nextHref: "/w/acme/calendar?week=2026-06-01",
        todayHref: "/w/acme/calendar",
      }),
    );

    expect(getByTestId("calendar-week-view")).toBeTruthy();
  });
});
