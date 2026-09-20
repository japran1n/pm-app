// @vitest-environment jsdom
//
// F037 (AS-070, AS-071): PlannerHeader should surface whose planner is
// being shown whenever the selected member set differs from the viewer's
// own ([selfId]) -- e.g. "Alice's schedule" for a single other person, or
// a names/summary line for multiple people. When the selection IS just
// [selfId] (viewing your own planner), no subtitle should render at all.
//
// AS-071 is a source-text guard confirming there is no per-person colour
// palette overriding block.color anywhere in the stacked layout -- the
// behavioural half of this is already covered by f036 (AS-067); here we
// only assert the source never introduces one.

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// PeopleSwitcherUrlBound (rendered by PlannerHeader whenever `peopleSwitcher`
// is passed) calls useRouter() for its own URL-writing -- unrelated to this
// feature, but its mount requires the same next/navigation mock other tests
// in this repo use (see tests/unit/f088-planner-header-lift.test.tsx).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
}));

import { PlannerHeader } from "@/components/calendar/planner-header";

afterEach(cleanup);

const members = [
  { userId: "self-1", name: "Me", email: "me@example.com", avatarUrl: null },
  { userId: "user-2", name: "Alice", email: "alice@example.com", avatarUrl: null },
  { userId: "user-3", name: "Bob", email: "bob@example.com", avatarUrl: null },
];

const baseProps = {
  rangeLabel: "Sep 14 - Sep 20",
  workspaceSlug: "acme",
  prevHref: "/w/acme/calendar?week=prev",
  nextHref: "/w/acme/calendar?week=next",
  todayHref: "/w/acme/calendar",
};

describe("F037 (AS-070): PlannerHeader subtitle for other-person planners", () => {
  it("test_AS_070_own_planner_shows_no_subtitle", () => {
    render(
      <PlannerHeader
        {...baseProps}
        peopleSwitcher={{
          members,
          selectedUserIds: ["self-1"],
          selfId: "self-1",
        }}
      />,
    );

    expect(
      screen.queryByTestId("calendar-planner-subtitle"),
    ).not.toBeInTheDocument();
  });

  it("test_AS_070_single_other_person_shows_their_name", () => {
    render(
      <PlannerHeader
        {...baseProps}
        peopleSwitcher={{
          members,
          selectedUserIds: ["user-2"],
          selfId: "self-1",
        }}
      />,
    );

    const subtitle = screen.getByTestId("calendar-planner-subtitle");
    expect(subtitle).toHaveTextContent("Alice");
  });

  it("test_AS_070_multiple_others_shows_meaningful_summary", () => {
    render(
      <PlannerHeader
        {...baseProps}
        peopleSwitcher={{
          members,
          selectedUserIds: ["self-1", "user-2", "user-3"],
          selfId: "self-1",
        }}
      />,
    );

    const subtitle = screen.getByTestId("calendar-planner-subtitle");
    // Should mention the other members somehow (names or a count summary).
    expect(subtitle.textContent).toMatch(/Alice|Bob|\d+ people/);
  });

  it("test_AS_070_no_peopleSwitcher_prop_renders_no_subtitle", () => {
    render(<PlannerHeader {...baseProps} />);
    expect(
      screen.queryByTestId("calendar-planner-subtitle"),
    ).not.toBeInTheDocument();
  });
});

describe("F037 (AS-071): no per-person colour palette overrides block.color", () => {
  it("test_AS_071_no_per_person_colour_palette", () => {
    const stackedSrc = readFileSync(
      path.join(process.cwd(), "components/calendar/stacked-planner.tsx"),
      "utf-8",
    );
    const rowSrc = readFileSync(
      path.join(process.cwd(), "components/calendar/stacked-person-row.tsx"),
      "utf-8",
    );
    expect(stackedSrc + rowSrc).not.toMatch(
      /personPalette|avatarColors|personColors\[/,
    );
  });
});
