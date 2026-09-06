// @vitest-environment jsdom
//
// Regression test for a real bug in components/views/view-tabs.tsx's
// `move` handler: the "move right" branch used `tabs[index]` (the tab's
// OWN current position) as the `before` anchor instead of `tabs[swapWith]`
// (the tab it's swapping past). That could compute a new position that
// still sorted BEFORE the tab it was supposed to move past, silently
// failing to reorder instead of throwing -- exactly the kind of bug that
// slips past manual testing (mentioned in the task as "some errors when I
// make a custom view" -- views-as-tabs is part of that same feature area).
//
// This test reverts the fix mentally by checking the ACTUAL position value
// passed to `updateSavedView` on a "move right" click: it must fall
// strictly between the position of the tab being passed (tabs[swapWith])
// and the tab after it (tabs[swapWith + 1]) -- never anchored off the
// moved tab's own old position.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const updateSavedViewMock = vi.fn(async (_input: { viewId: string; position: number }) => ({
  ok: true as const,
  data: {},
}));

vi.mock("@/lib/actions/views", () => ({
  updateSavedView: (input: { viewId: string; position: number }) => updateSavedViewMock(input),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/w/acme/projects/p1/list",
}));

vi.mock("@/components/auth/membership-provider", () => ({
  useMembership: () => ({ role: "admin", hasClient: false, projectRoles: {} }),
}));

import { ViewTabs } from "@/components/views/view-tabs";

describe("ViewTabs reorder (F401 views-as-tabs)", () => {
  beforeEach(() => {
    updateSavedViewMock.mockClear();
  });

  it("test_view_tabs_move_right_anchors_between_the_swapped_tab_and_its_new_next_neighbor", async () => {
    // Three shared tabs at fractional positions -- deliberately unevenly
    // spaced (not simple integers) so the old, buggy `before = tabs[index]`
    // anchor would compute a midpoint that could still sort before
    // `tabs[1]`'s own position, exposing the bug instead of accidentally
    // passing.
    // Deliberately TIGHT spacing between "Design" and "Dev" (105 -> 110):
    // the old buggy anchor (tabs[index]'s own position, 100) averaged with
    // 110 lands exactly ON "Design"'s position (105) -- a real collision,
    // not just "off by a little" -- which is what makes this a reliable
    // regression check rather than a coincidental pass.
    const views = [
      { id: "a", ownerId: "u1", name: "Setup", scope: "shared" as const, viewType: "list" as const, config: { filters: [], sort: [], groupBy: null }, isDefault: false, isMine: true, position: 100 },
      { id: "b", ownerId: "u1", name: "Design", scope: "shared" as const, viewType: "list" as const, config: { filters: [], sort: [], groupBy: null }, isDefault: false, isMine: true, position: 105 },
      { id: "c", ownerId: "u1", name: "Dev", scope: "shared" as const, viewType: "list" as const, config: { filters: [], sort: [], groupBy: null }, isDefault: false, isMine: true, position: 110 },
    ];

    render(<ViewTabs views={views} activeViewId={undefined} />);

    // Move "Setup" (index 0) to the right, past "Design" (index 1).
    const moveRightButton = screen.getByLabelText('Move "Setup" later');
    fireEvent.click(moveRightButton);

    expect(updateSavedViewMock).toHaveBeenCalledTimes(1);
    const call = updateSavedViewMock.mock.calls[0][0];
    expect(call.viewId).toBe("a");
    // Correct anchors: between tabs[1] ("Design", 105) and tabs[2] ("Dev", 110).
    expect(call.position).toBeGreaterThan(105);
    expect(call.position).toBeLessThan(110);
  });
});
