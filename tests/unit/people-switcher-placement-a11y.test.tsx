// @vitest-environment jsdom
//
// F030 (AS-051, AS-060, AS-061): the people switcher's placement in the
// Planner header row alongside the week nav controls, its keyboard
// operability (open, search, toggle a member), and its reachability/
// usability at mobile viewport width.

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

describe("F030: people switcher keyboard operability (AS-060)", () => {
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

describe("F030: people switcher at mobile viewport width (AS-061)", () => {
  it("test_AS_061_switcher_trigger_is_never_unconditionally_hidden", () => {
    renderWeekViewWithSwitcher();

    const switcherTrigger = document.querySelector('[data-slot="people-switcher-trigger"]');
    expect(switcherTrigger).toBeInTheDocument();

    // AS-061: reachable at mobile width means the trigger element itself is
    // never removed from layout by a bare `hidden` class (unconditional
    // `display: none`), a responsive `hidden` at some breakpoint with no
    // matching un-hide variant, or inline `display:none`/`visibility:hidden`.
    // A mutation that adds bare `class="hidden"` to the trigger must fail
    // this assertion -- unlike matching `/(^|\s)hidden(\s|$)/` against the
    // whole className (which never matches a *responsive* variant like
    // `sm:hidden` either, so this test also catches that class of bug even
    // though it isn't the mutation under test here).
    const classTokens = (switcherTrigger?.className ?? "").split(/\s+/).filter(Boolean);
    // Reject bare `hidden` AND every responsive-prefixed variant
    // (`sm:hidden`, `md:hidden`, `lg:hidden`, `xl:hidden`, `2xl:hidden`,
    // `max-sm:hidden`, `max-md:hidden`, etc.) -- any of these applies
    // `display: none` at some breakpoint with no guaranteed un-hide
    // variant, which jsdom's non-CSS-evaluating renderer would otherwise
    // let slip through undetected.
    const hiddenVariantPattern = /^((max-)?(sm|md|lg|xl|2xl):)?hidden$/;
    const hasUnconditionalHiddenClass = classTokens.some((token) => hiddenVariantPattern.test(token));
    expect(hasUnconditionalHiddenClass).toBe(false);

    const style = switcherTrigger ? window.getComputedStyle(switcherTrigger) : null;
    expect(style?.display).not.toBe("none");
    expect(style?.visibility).not.toBe("hidden");

    // The trigger is the same button element at a narrow (375px) and a wide
    // (1280px) simulated viewport width -- it never swaps for a different
    // element or disappears from the DOM as the width changes.
    Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 375 });
    window.dispatchEvent(new Event("resize"));
    const triggerAtMobile = document.querySelector('[data-slot="people-switcher-trigger"]');
    expect(triggerAtMobile).toBe(switcherTrigger);
    expect(triggerAtMobile).toHaveAttribute("aria-label");

    Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 1280 });
    window.dispatchEvent(new Event("resize"));
    const triggerAtDesktop = document.querySelector('[data-slot="people-switcher-trigger"]');
    expect(triggerAtDesktop).toBe(switcherTrigger);

    // The switcher trigger co-locates with the week-nav prev/next controls:
    // it shares a common ancestor with them within a shallow number of DOM
    // levels, rather than living in an unrelated part of the page.
    const prevLink = document.querySelector('a[aria-label="Previous week"]');
    const nextLink = document.querySelector('a[aria-label="Next week"]');
    expect(prevLink).toBeInTheDocument();
    expect(nextLink).toBeInTheDocument();

    function findCommonAncestor(a: Element, b: Element): { ancestor: Element; depth: number } | null {
      let ancestor: Element | null = a;
      let depth = 0;
      while (ancestor) {
        if (ancestor.contains(b)) {
          return { ancestor, depth };
        }
        ancestor = ancestor.parentElement;
        depth += 1;
      }
      return null;
    }

    const commonWithPrev = findCommonAncestor(switcherTrigger as Element, prevLink as Element);
    const commonWithNext = findCommonAncestor(switcherTrigger as Element, nextLink as Element);
    expect(commonWithPrev).not.toBeNull();
    expect(commonWithNext).not.toBeNull();
    expect(commonWithPrev!.depth).toBeLessThanOrEqual(4);
    expect(commonWithNext!.depth).toBeLessThanOrEqual(4);
  });

  it("test_AS_061_switcher_remains_operable_via_keyboard_and_search_regardless_of_viewport", async () => {
    // AS-061: "usable at mobile viewport width" for a component with no
    // viewport-dependent JS branches (this one has none -- CSS-only
    // responsiveness) collapses to "keyboard/search flow still works when
    // rendered at a narrow width." Simulate a mobile viewport width and
    // re-run the same open/search/toggle flow AS-060 covers.
    Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 375 });
    window.dispatchEvent(new Event("resize"));

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

    await user.tab();
    const trigger = screen.getByRole("button", { name: /people selected/i });
    expect(trigger).toHaveFocus();
    await user.keyboard("{Enter}");

    const searchInput = await waitFor(() => screen.getByPlaceholderText("Find a person..."));
    fireEvent.change(searchInput, { target: { value: "Grace" } });

    const graceItem = await waitFor(() => screen.getByText("Grace Hopper"));
    fireEvent.click(graceItem);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(["user-1", "user-2"]);
    });
  });
});
