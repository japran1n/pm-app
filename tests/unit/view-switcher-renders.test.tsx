// @vitest-environment jsdom
//
// BUGFIX (found while implementing the "Edit filters" follow-up): the
// existing <ViewSwitcher>'s dropdown used <DropdownMenuLabel> (Base UI's
// Menu.GroupLabel) OUTSIDE a <DropdownMenuGroup> (Menu.Group), which Base
// UI's Menu.GroupLabel throws on ("MenuGroupContext is missing") the
// moment the dropdown's content actually mounts -- i.e. every time a user
// opened this menu in a real browser too, not just under test. This test
// proves the dropdown's content renders (and its "Edit filters" trigger is
// present) without that crash.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { ViewSwitcher } from "@/components/views/view-switcher";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/w/acme/projects/p1/list",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/actions/views", () => ({
  setDefaultSavedView: vi.fn(),
  deleteSavedView: vi.fn(),
  updateSavedView: vi.fn(),
}));

afterEach(cleanup);

describe("ViewSwitcher dropdown renders without the missing-group-context crash", () => {
  it("test_opening_the_dropdown_with_saved_views_present_does_not_throw", () => {
    const views = [
      {
        id: "view-1",
        ownerId: "user-1",
        name: "Setup",
        scope: "personal" as const,
        viewType: "list" as const,
        config: { filters: [], sort: [], groupBy: null },
        isDefault: false,
        position: 0,
        isMine: true,
      },
    ];

    expect(() => render(<ViewSwitcher views={views} />)).not.toThrow();
    fireEvent.click(screen.getByRole("button", { name: "Views" }));
    expect(screen.getByText("Your views")).toBeInTheDocument();
    expect(screen.getByText("Setup")).toBeInTheDocument();
    expect(screen.getByLabelText('Edit filters for "Setup"')).toBeInTheDocument();
  });
});
