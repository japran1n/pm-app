// @vitest-environment jsdom
//
// F026 (AS-052, AS-053): the people switcher lists active workspace members
// with avatar + name, and narrows the list as the user types.
//
// Note: by the time this worker ran, a concurrent F027 worker (multiselect,
// AS-054/AS-055, depends on F026) had already built
// components/calendar/people-switcher.tsx end-to-end — including the
// AS-052/AS-053 shell behaviour F026 owns, since F027 couldn't proceed
// without it. These tests exercise that shipped component directly against
// AS-052/AS-053's assertion text (not against F027's multiselect additions,
// which are that feature's own scope).

import { createElement } from "react";
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

import { PeopleSwitcher } from "@/components/calendar/people-switcher";

const members = [
  {
    userId: "user-1",
    name: "Ada Lovelace",
    email: "ada@example.com",
    avatarUrl: "https://example.com/ada.png",
  },
  {
    userId: "user-2",
    name: "Grace Hopper",
    email: "grace@example.com",
    avatarUrl: null,
  },
];

afterEach(() => {
  cleanup();
});

function openSwitcher() {
  fireEvent.click(screen.getByRole("button", { name: "Select people" }));
}

function openSwitcherWithSelection() {
  fireEvent.click(
    screen.getByRole("button", { name: /\d+ people selected/ }),
  );
}

describe("PeopleSwitcher", () => {
  it("test_AS_052_lists_active_members_with_avatar_and_name", async () => {
    // Base UI's <Avatar.Image> (components/ui/avatar.tsx's AvatarImage) only
    // mounts the real <img> once a background `new window.Image()` probe
    // reports `loaded` -- jsdom never fires that event on its own, so
    // without this shim the image path would never render and this test
    // would only ever exercise the fallback-initials path, masking a
    // mutation that drops `avatarUrl` from the row entirely.
    class AutoLoadingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      complete = false;
      naturalWidth = 1;
      private _src = "";
      set src(value: string) {
        this._src = value;
        queueMicrotask(() => this.onload?.());
      }
      get src() {
        return this._src;
      }
    }
    vi.stubGlobal("Image", AutoLoadingImage);

    try {
      render(
        createElement(PeopleSwitcher, {
          members,
          selectedUserIds: [],
          onSelectionChange: vi.fn(),
          selfId: "user-1",
        }),
      );

      openSwitcher();

      await waitFor(() => {
        expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
        expect(screen.getByText("Grace Hopper")).toBeInTheDocument();
      });

      // Every listed member row renders an avatar (image or fallback initial).
      const rows = document.querySelectorAll(
        '[data-slot="people-switcher-content"] [data-slot="avatar"]',
      );
      expect(rows).toHaveLength(2);

      // Ada Lovelace has a non-null avatarUrl: her row must render a real
      // <img> pointed at that URL, not just an empty avatar shell.
      const adaRow = rows[0]!;
      await waitFor(() => {
        expect(adaRow.querySelector("img")).not.toBeNull();
      });
      expect(adaRow.querySelector("img")!.getAttribute("src")).toBe(
        "https://example.com/ada.png",
      );

      // Grace Hopper has a null avatarUrl: her row must render the fallback
      // initials derived from her name ("GH"), not an empty avatar shell.
      const graceRow = rows[1]!;
      expect(graceRow.querySelector("img")).toBeNull();
      expect(graceRow.querySelector('[data-slot="avatar-fallback"]')?.textContent).toBe(
        "GH",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("test_AS_052_empty_member_list_shows_empty_state", async () => {
    render(
      createElement(PeopleSwitcher, {
        members: [],
        selectedUserIds: [],
        onSelectionChange: vi.fn(),
        selfId: "user-1",
      }),
    );

    openSwitcher();

    await waitFor(
      () => {
        expect(screen.getByText("No members found.")).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it("test_AS_053_typing_narrows_the_listed_members", async () => {
    render(
      createElement(PeopleSwitcher, {
        members,
        selectedUserIds: [],
        onSelectionChange: vi.fn(),
        selfId: "user-1",
      }),
    );

    openSwitcher();

    const input = await waitFor(() =>
      screen.getByPlaceholderText("Find a person..."),
    );
    fireEvent.change(input, { target: { value: "Grace" } });

    await waitFor(() => {
      expect(screen.getByText("Grace Hopper")).toBeInTheDocument();
      expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
    });
  });

  it("test_AS_053_typing_a_query_matching_nobody_shows_the_empty_state", async () => {
    render(
      createElement(PeopleSwitcher, {
        members,
        selectedUserIds: [],
        onSelectionChange: vi.fn(),
        selfId: "user-1",
      }),
    );

    openSwitcher();

    const input = await waitFor(() =>
      screen.getByPlaceholderText("Find a person..."),
    );
    fireEvent.change(input, { target: { value: "zzzznotamatch" } });

    await waitFor(() => {
      expect(screen.getByText("No members found.")).toBeInTheDocument();
      expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
      expect(screen.queryByText("Grace Hopper")).not.toBeInTheDocument();
    });
  });
});

// F028 (AS-056, AS-057): the "Just me" and "whole team" shortcuts.
describe("PeopleSwitcher shortcuts (F028)", () => {
  it("test_AS_056_just_me_shortcut_returns_selection_to_the_signed_in_member_alone", async () => {
    const onSelectionChange = vi.fn();

    render(
      createElement(PeopleSwitcher, {
        members,
        selectedUserIds: ["user-1", "user-2"],
        onSelectionChange,
        selfId: "user-1",
      }),
    );

    openSwitcherWithSelection();

    const justMe = await waitFor(() => screen.getByText("Just me"));
    fireEvent.click(justMe);

    expect(onSelectionChange).toHaveBeenCalledWith(["user-1"]);
  });

  it("test_AS_056_just_me_shortcut_is_offered_even_when_nobody_else_is_selected", async () => {
    const onSelectionChange = vi.fn();

    render(
      createElement(PeopleSwitcher, {
        members,
        selectedUserIds: [],
        onSelectionChange,
        selfId: "user-2",
      }),
    );

    openSwitcher();

    await waitFor(() => {
      expect(screen.getByText("Just me")).toBeInTheDocument();
    });
  });

  it("test_AS_057_whole_team_shortcut_selects_every_active_member", async () => {
    const onSelectionChange = vi.fn();

    render(
      createElement(PeopleSwitcher, {
        members,
        selectedUserIds: [],
        onSelectionChange,
        selfId: "user-2",
      }),
    );

    openSwitcher();

    const wholeTeam = await waitFor(() => screen.getByText("Whole team"));
    fireEvent.click(wholeTeam);

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    const nextSelection = onSelectionChange.mock.calls[0]![0] as string[];
    // Every active member is present (order asserted separately by F006's
    // own orderPeopleForWholeTeam unit tests) — self first, per AS-058.
    expect(new Set(nextSelection)).toEqual(new Set(["user-1", "user-2"]));
    expect(nextSelection[0]).toBe("user-2");
  });

  it("test_AS_057_whole_team_shortcut_replaces_any_prior_partial_selection", async () => {
    const onSelectionChange = vi.fn();

    render(
      createElement(PeopleSwitcher, {
        members,
        selectedUserIds: ["user-1"],
        onSelectionChange,
        selfId: "user-1",
      }),
    );

    openSwitcherWithSelection();

    const wholeTeam = await waitFor(() => screen.getByText("Whole team"));
    fireEvent.click(wholeTeam);

    expect(onSelectionChange).toHaveBeenCalledWith(["user-1", "user-2"]);
  });
});
