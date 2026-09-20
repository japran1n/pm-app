// @vitest-environment jsdom
//
// F030 (AS-051, AS-060): the people switcher's placement in the Planner
// header row alongside the week nav controls, and its keyboard operability
// (open, search, toggle a member).
//
// AS-061 ("reachable at mobile viewport width") is NOT tested here: jsdom
// loads no CSS, so getComputedStyle never reflects a Tailwind responsive
// class -- a jsdom test can't distinguish "hidden at mobile" from "visible
// at mobile" (see F068, F072, F076's postmortems on this exact assertion).
// AS-061 is covered by a real-browser Playwright spec instead:
// tests/e2e/m6-people-switcher-mobile.spec.ts.

import { createElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// WeekView renders PeopleSwitcherUrlBound, which calls useRouter() --
// mock next/navigation the same way other component tests in this repo do
// (e.g. tests/unit/app-sidebar-trash-nav.test.tsx) so the mount doesn't
// throw outside a real Next.js app router tree.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (typeof HTMLElement.prototype.scrollIntoView !== "function") {
  HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
}

import { WeekView } from "@/components/calendar/week-view";
import { PeopleSwitcher, type PeopleSwitcherMember } from "@/components/calendar/people-switcher";
import { buildCalendarWeek } from "@/lib/calendar/week-grid";

afterEach(cleanup);

const WEEK = buildCalendarWeek("2026-06-01", "UTC");

const MEMBERS: PeopleSwitcherMember[] = [
  { userId: "user-1", name: "Ada Lovelace", email: "ada@example.com", avatarUrl: null },
  { userId: "user-2", name: "Grace Hopper", email: "grace@example.com", avatarUrl: null },
];

function renderWeekViewWithSwitcher() {
  return render(
    <WeekView
      week={WEEK}
      blocks={[]}
      workspaceSlug="acme"
      workspaceId="workspace-1"
      currentUserId="user-1"
      prevHref="/w/acme/calendar?week=2026-05-25"
      nextHref="/w/acme/calendar?week=2026-06-08"
      todayHref="/w/acme/calendar"
      peopleSwitcher={{
        members: MEMBERS,
        selectedUserIds: ["user-1"],
        selfId: "user-1",
        weekParam: "2026-06-01",
      }}
    />,
  );
}

describe("F030: people switcher placement (AS-051)", () => {
  it("test_AS_051_switcher_renders_in_the_same_header_row_as_the_week_nav_controls", () => {
    renderWeekViewWithSwitcher();

    const switcherTrigger = document.querySelector('[data-slot="people-switcher-trigger"]');
    expect(switcherTrigger).toBeInTheDocument();

    const prevLink = document.querySelector('a[aria-label="Previous week"]');
    const nextLink = document.querySelector('a[aria-label="Next week"]');
    const todayLink = screen.getByText("Today").closest("a");

    // AS-051: the switcher shares a common header-row ancestor with the
    // prev/today/next controls -- not rendered elsewhere on the page (e.g.
    // in a separate toolbar or below the grid).
    const headerRow = prevLink?.closest("div");
    expect(headerRow).toBeInTheDocument();
    expect(headerRow?.contains(switcherTrigger)).toBe(true);
    expect(headerRow?.contains(nextLink)).toBe(true);
    expect(headerRow?.contains(todayLink!)).toBe(true);
  });

  it("test_AS_051_switcher_is_absent_when_no_peopleSwitcher_prop_is_passed", () => {
    render(
      <WeekView
        week={WEEK}
        blocks={[]}
        workspaceSlug="acme"
        workspaceId="workspace-1"
        currentUserId="user-1"
        prevHref="/w/acme/calendar?week=2026-05-25"
        nextHref="/w/acme/calendar?week=2026-06-08"
        todayHref="/w/acme/calendar"
      />,
    );

    expect(
      document.querySelector('[data-slot="people-switcher-trigger"]'),
    ).not.toBeInTheDocument();
  });
});

// AS-060 ArrowDown coverage needs at least 3 members filtered into view --
// with only 1-2 rows cmdk auto-highlights the sole/first row regardless of
// whether ArrowDown ever fires, so a 1-2 member fixture gives zero real
// coverage of arrow-key navigation (this is exactly what the scrutiny pass
// caught). cmdk filters on each CommandItem's `value` prop, which
// people-switcher.tsx sets to the member's display name -- so the shared
// "Roster" suffix below is what narrows the filtered list to exactly these
// three rows (the "Just me"/"Whole team" shortcut rows don't contain it and
// get filtered out), leaving arrow-key order fully attributable to the
// ArrowDown presses under test.
const KEYBOARD_NAV_MEMBERS: PeopleSwitcherMember[] = [
  { userId: "user-1", name: "Alice Roster", email: "alice@example.com", avatarUrl: null },
  { userId: "user-2", name: "Bob Roster", email: "bob@example.com", avatarUrl: null },
  { userId: "user-3", name: "Carol Roster", email: "carol@example.com", avatarUrl: null },
];

describe("F030: people switcher keyboard operability (AS-060)", () => {
  it("test_AS_060_arrow_down_twice_highlights_the_third_filtered_member", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      createElement(PeopleSwitcher, {
        members: KEYBOARD_NAV_MEMBERS,
        selectedUserIds: [],
        selfId: "user-1",
        onSelectionChange: onChange,
      }),
    );

    await user.tab();
    const trigger = screen.getByRole("button", { name: /select people/i });
    expect(trigger).toHaveFocus();
    await user.keyboard("{Enter}");

    await waitFor(() => screen.getByPlaceholderText("Find a person..."));

    // Narrow to exactly the 3 members (excludes the "Just me"/"Whole team"
    // shortcut rows, which don't match this filter text).
    await user.keyboard("Roster");
    await waitFor(() => {
      expect(screen.getByText("Alice Roster")).toBeInTheDocument();
      expect(screen.getByText("Bob Roster")).toBeInTheDocument();
      expect(screen.getByText("Carol Roster")).toBeInTheDocument();
      expect(screen.queryByText("Just me")).not.toBeInTheDocument();
      expect(screen.queryByText("Whole team")).not.toBeInTheDocument();
    });

    const aliceOption = screen.getByRole("option", { name: /alice roster/i });
    const bobOption = screen.getByRole("option", { name: /bob roster/i });
    const carolOption = screen.getByRole("option", { name: /carol roster/i });

    // cmdk highlights the first filtered row by default before any arrow
    // press -- confirms the starting point so the ArrowDown presses below
    // are the only thing that can move highlight onto Carol.
    await waitFor(() => {
      expect(aliceOption).toHaveAttribute("aria-selected", "true");
    });
    expect(bobOption).toHaveAttribute("aria-selected", "false");
    expect(carolOption).toHaveAttribute("aria-selected", "false");

    // The two ArrowDown presses under test: Alice -> Bob -> Carol.
    await user.keyboard("{ArrowDown}{ArrowDown}");

    await waitFor(() => {
      expect(carolOption).toHaveAttribute("aria-selected", "true");
    });
    expect(carolOption).toHaveAttribute("data-selected", "true");
    expect(aliceOption).toHaveAttribute("aria-selected", "false");
    expect(bobOption).toHaveAttribute("aria-selected", "false");

    const searchInput = screen.getByPlaceholderText("Find a person...");
    expect(searchInput).toHaveAttribute(
      "aria-activedescendant",
      carolOption.id,
    );
  });

  it("test_AS_060_switcher_can_be_opened_searched_and_toggled_with_keyboard_alone", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      createElement(PeopleSwitcher, {
        members: MEMBERS,
        selectedUserIds: ["user-1"],
        selfId: "user-1",
        onSelectionChange: onChange,
      }),
    );

    // Open via keyboard: Tab to the trigger, then activate with Enter --
    // no pointer/click call anywhere in this test.
    await user.tab();
    const trigger = screen.getByRole("button", { name: /people selected/i });
    expect(trigger).toHaveFocus();
    await user.keyboard("{Enter}");

    const searchInput = await waitFor(() => screen.getByPlaceholderText("Find a person..."));

    // Search via keyboard: type to filter down to a single member.
    await user.keyboard("Grace");
    await waitFor(() => {
      expect(screen.getByText("Grace Hopper")).toBeInTheDocument();
      expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
    });

    // Toggle via keyboard: arrow down onto the filtered result, then Enter.
    await user.keyboard("{ArrowDown}{Enter}");

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(["user-1", "user-2"]);
    });
    expect(searchInput).toBeInTheDocument();
  });

  it("test_AS_060_switcher_trigger_is_a_natively_focusable_button_element", () => {
    render(
      createElement(PeopleSwitcher, {
        members: MEMBERS,
        selectedUserIds: [],
        selfId: "user-1",
        onSelectionChange: vi.fn(),
      }),
    );

    // A real <button> (not a div with a click handler) is required for Tab
    // to reach it and Enter/Space to activate it without extra ARIA wiring.
    const trigger = document.querySelector('[data-slot="people-switcher-trigger"]');
    expect(trigger?.tagName).toBe("BUTTON");
    expect(trigger).not.toHaveAttribute("tabindex", "-1");
  });
});
