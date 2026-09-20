// @vitest-environment jsdom
//
// F027 (AS-054, AS-055): the Planner's people switcher multi-select
// behaviour and closed-trigger avatar-group overflow.

import { createElement, useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

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

import { PeopleSwitcher, type PeopleSwitcherMember } from "@/components/calendar/people-switcher";

const members: PeopleSwitcherMember[] = [
  { userId: "user-1", name: "Ada Lovelace", email: "ada@example.com", avatarUrl: null },
  { userId: "user-2", name: "Grace Hopper", email: "grace@example.com", avatarUrl: null },
  { userId: "user-3", name: "Katherine Johnson", email: "katherine@example.com", avatarUrl: null },
  { userId: "user-4", name: "Margaret Hamilton", email: "margaret@example.com", avatarUrl: null },
];

afterEach(() => {
  cleanup();
});

function Controlled({
  initial,
  onChangeSpy,
}: {
  initial: string[];
  onChangeSpy: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>(initial);
  return createElement(PeopleSwitcher, {
    members,
    selectedUserIds: selected,
    selfId: "user-1",
    onSelectionChange: (next: string[]) => {
      onChangeSpy(next);
      setSelected(next);
    },
  });
}

describe("PeopleSwitcher multi-select (AS-054)", () => {
  it("test_AS_054_selecting_a_second_member_keeps_the_first_selected", async () => {
    const onChange = vi.fn();
    render(createElement(Controlled, { initial: ["user-1"], onChangeSpy: onChange }));

    fireEvent.click(screen.getByRole("button", { name: /people selected|select people/i }));

    const gracesItem = await waitFor(() => screen.getByText("Grace Hopper"));
    fireEvent.click(gracesItem);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(["user-1", "user-2"]);
    });
  });

  it("test_AS_054_clicking_a_selected_member_deselects_only_that_member", async () => {
    const onChange = vi.fn();
    render(
      createElement(Controlled, {
        initial: ["user-1", "user-2", "user-3"],
        onChangeSpy: onChange,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /people selected/i }));

    const gracesItem = await waitFor(() => screen.getByText("Grace Hopper"));
    fireEvent.click(gracesItem);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(["user-1", "user-3"]);
    });
  });

  it("test_AS_054_three_members_can_be_selected_simultaneously", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      createElement(PeopleSwitcher, {
        members,
        selectedUserIds: ["user-1", "user-2", "user-3"],
        selfId: "user-1",
        onSelectionChange: onChange,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /people selected/i }));

    await waitFor(() => {
      const item1 = screen.getByText("Ada Lovelace").closest('[data-checked]');
      const item2 = screen.getByText("Grace Hopper").closest('[data-checked]');
      const item3 = screen.getByText("Katherine Johnson").closest('[data-checked]');
      expect(item1).toHaveAttribute("data-checked", "true");
      expect(item2).toHaveAttribute("data-checked", "true");
      expect(item3).toHaveAttribute("data-checked", "true");
    });

    rerender(
      createElement(PeopleSwitcher, {
        members,
        selectedUserIds: ["user-1", "user-2", "user-3"],
        selfId: "user-1",
        onSelectionChange: onChange,
      }),
    );
  });
});

describe("PeopleSwitcher closed-trigger avatar group (AS-055)", () => {
  it("test_AS_055_closed_trigger_renders_an_avatar_per_selected_member_when_it_fits", () => {
    render(
      createElement(PeopleSwitcher, {
        members,
        selectedUserIds: ["user-1", "user-2"],
        selfId: "user-1",
        onSelectionChange: vi.fn(),
        maxVisibleAvatars: 3,
      }),
    );

    const group = document.querySelector('[data-slot="people-switcher-avatar-group"]');
    expect(group).not.toBeNull();
    expect(group!.querySelectorAll('[data-slot="avatar"]')).toHaveLength(2);
    expect(
      document.querySelector('[data-slot="people-switcher-overflow-count"]'),
    ).not.toBeInTheDocument();
  });

  it("test_AS_055_closed_trigger_shows_an_overflow_count_when_selection_does_not_fit", () => {
    render(
      createElement(PeopleSwitcher, {
        members,
        selectedUserIds: ["user-1", "user-2", "user-3", "user-4"],
        selfId: "user-1",
        onSelectionChange: vi.fn(),
        maxVisibleAvatars: 3,
      }),
    );

    const group = document.querySelector('[data-slot="people-switcher-avatar-group"]');
    expect(group!.querySelectorAll('[data-slot="avatar"]')).toHaveLength(3);

    const overflow = document.querySelector('[data-slot="people-switcher-overflow-count"]');
    expect(overflow).toBeInTheDocument();
    expect(overflow).toHaveTextContent("+1");
  });

  it("test_AS_055_overflow_count_reflects_exact_number_of_members_not_shown", () => {
    render(
      createElement(PeopleSwitcher, {
        members: [
          ...members,
          { userId: "user-5", name: "Hedy Lamarr", email: "hedy@example.com", avatarUrl: null },
          { userId: "user-6", name: "Radia Perlman", email: "radia@example.com", avatarUrl: null },
        ],
        selectedUserIds: ["user-1", "user-2", "user-3", "user-4", "user-5", "user-6"],
        selfId: "user-1",
        onSelectionChange: vi.fn(),
        maxVisibleAvatars: 2,
      }),
    );

    const overflow = document.querySelector('[data-slot="people-switcher-overflow-count"]');
    expect(overflow).toHaveTextContent("+4");
  });

  it("test_AS_055_closed_trigger_shows_no_avatar_group_when_nothing_is_selected", () => {
    render(
      createElement(PeopleSwitcher, {
        members,
        selectedUserIds: [],
        selfId: "user-1",
        onSelectionChange: vi.fn(),
      }),
    );

    expect(
      document.querySelector('[data-slot="people-switcher-avatar-group"]'),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Select people")).toBeInTheDocument();
  });
});
