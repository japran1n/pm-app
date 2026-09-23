// @vitest-environment jsdom
//
// Planner overlay mode picker: `OverlayPersonSelect` lets the viewer choose
// ONE other workspace member to overlay on top of the single-person
// week-grid view (`?overlay=<userId>` in the URL, mirroring how
// `PeopleSwitcherUrlBound` keeps `?people=` as the sole source of truth).
// This file proves (a) it renders nothing when there are no candidates,
// (b) picking a member navigates with `?overlay=<userId>` set and every
// other existing search param preserved, and (c) picking "No overlay"
// removes the param instead of leaving a stale value behind.
//
// The real <Select> (components/ui/select.tsx) wraps @base-ui/react's
// pointer-event-driven combobox, which jsdom cannot reliably drive (same
// constraint documented in tests/unit/list-priority-select-optimistic.
// test.tsx). `OverlayPersonSelect`'s own URL-building logic lives entirely
// in its `handleChange` -- not inside the Select primitive -- so this test
// replaces <Select> with a bare native <select>, wired to the same
// value/onValueChange contract, to exercise the REAL handleChange function
// through a real DOM change event.

import { createElement, Fragment, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => new URLSearchParams("week=2026-06-01&people=user-1"),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string | null) => void;
    children: ReactNode;
  }) =>
    createElement(
      "select",
      {
        "data-testid": "calendar-overlay-person-select",
        value,
        onChange: (e: { target: { value: string } }) => onValueChange(e.target.value),
      },
      children,
    ),
  SelectContent: ({ children }: { children: ReactNode }) => createElement(Fragment, null, children),
  SelectItem: ({ value, children, ...rest }: { value: string; children: ReactNode }) =>
    createElement("option", { value, ...rest }, children),
  SelectTrigger: ({ children }: { children: ReactNode }) => createElement(Fragment, null, children),
  SelectValue: () => null,
}));

import { OverlayPersonSelect } from "@/components/calendar/overlay-person-select";

afterEach(() => {
  cleanup();
  pushMock.mockClear();
});

const members = [
  { userId: "user-2", name: "Grace Hopper", email: "grace@example.com", avatarUrl: null },
  { userId: "user-3", name: "Ada Lovelace", email: "ada@example.com", avatarUrl: null },
];

describe("OverlayPersonSelect", () => {
  it("test_renders_nothing_when_there_are_no_overlay_candidates", () => {
    render(
      <OverlayPersonSelect
        members={[]}
        selectedOverlayUserId={null}
        workspaceSlug="acme"
      />,
    );
    expect(screen.queryByTestId("calendar-overlay-person-select")).not.toBeInTheDocument();
  });

  it("test_picking_a_member_navigates_with_overlay_param_set_and_other_params_preserved", () => {
    render(
      <OverlayPersonSelect
        members={members}
        selectedOverlayUserId={null}
        workspaceSlug="acme"
      />,
    );

    fireEvent.change(screen.getByTestId("calendar-overlay-person-select"), {
      target: { value: "user-2" },
    });

    expect(pushMock).toHaveBeenCalledTimes(1);
    const url = pushMock.mock.calls[0]![0] as string;
    expect(url).toContain("/w/acme/calendar?");
    expect(url).toContain("week=2026-06-01");
    expect(url).toContain("people=user-1");
    expect(url).toContain("overlay=user-2");
  });

  it("test_picking_no_overlay_removes_the_param", () => {
    render(
      <OverlayPersonSelect
        members={members}
        selectedOverlayUserId="user-2"
        workspaceSlug="acme"
      />,
    );

    fireEvent.change(screen.getByTestId("calendar-overlay-person-select"), {
      target: { value: "__none__" },
    });

    expect(pushMock).toHaveBeenCalledTimes(1);
    const url = pushMock.mock.calls[0]![0] as string;
    expect(url).not.toContain("overlay=");
  });
});
