// @vitest-environment jsdom
//
// F098 (AS-002): the week time grid's hour axis must render a genuine
// 24-hour grid (00:00 through 23:00), not the 08:00-16:00 stacked window
// used elsewhere. This test renders the real component and counts the
// rendered "HH:00" hour-label elements -- so mutating the component's
// `length: 24` hour-count down to (say) `9` makes this test fail, unlike a
// source-text regex which only proves the string "24" appears somewhere.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("@/lib/actions/calendar-blocks", () => ({
  createCalendarBlock: vi.fn(),
  updateCalendarBlock: vi.fn(),
  deleteCalendarBlock: vi.fn(),
}));

vi.mock("@/components/auth/membership-provider", () => ({
  useMembership: () => null,
}));

import { WeekTimeGrid } from "@/components/calendar/week-time-grid";

afterEach(cleanup);

const DAY = { date: "2026-06-01", isToday: false };

describe("Week time-grid hour axis (F098/AS-002: single-person view shows a full 24h grid)", () => {
  it("test_AS_002_single_person_shows_24h_grid", () => {
    render(
      <WeekTimeGrid
        days={[DAY]}
        blocksByDate={{}}
        workspaceSlug="acme"
        workspaceId="workspace-1"
        currentUserId="user-1"
      />,
    );

    // Every hour of the day, 00:00 through 23:00, must have its own
    // rendered label in the hour axis -- exactly 24, no more, no fewer.
    for (let hour = 0; hour < 24; hour += 1) {
      const label = `${String(hour).padStart(2, "0")}:00`;
      expect(screen.getAllByText(label)).toHaveLength(1);
    }

    // Also assert the total count of hour-axis rows directly: the hour
    // axis column renders one label div per hour, with no other text
    // matching the "HH:00" pattern elsewhere in the tree.
    const hourLabels = screen.getAllByText(/^\d{2}:00$/);
    expect(hourLabels).toHaveLength(24);
  });
});
