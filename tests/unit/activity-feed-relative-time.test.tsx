// @vitest-environment jsdom
//
// F308 (FU-12 item 1, AS-361): "The activity feed is grouped by day with
// readable relative timestamps." Before this fix, ActivityFeed
// (components/task/activity-feed.tsx) rendered each entry's timestamp as
// an absolute clock time ("10:32 AM") via formatTaskActivityTime, not a
// relative one — this test renders the real component (mocking only the
// Server Action it fetches through) and asserts a relative-time string
// ("... ago") is actually on screen, not just that some code path exists
// for it.
//
// Also covers item 2 (assignee-change entries showing a real name, not
// "someone") since it's the same component and the same fix touches the
// same render path.

import { createElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { ActivityFeed } from "@/components/task/activity-feed";

vi.mock("@/lib/actions/task-activity", () => ({
  getTaskActivityFeed: vi.fn(async () => ({
    ok: true,
    data: {
      rows: [
        {
          id: "a1",
          taskId: "t1",
          kind: "field_changed",
          field: "assignee_id",
          oldValue: null,
          newValue: "u2",
          actorId: "u1",
          actorName: "Alice Anderson",
          actorEmail: "alice@example.com",
          actorAvatarUrl: null,
          // Recent enough that formatDistanceToNow reliably renders "a
          // few seconds ago" / "less than a minute ago" rather than
          // something that could flake near a minute boundary.
          createdAt: new Date(Date.now() - 5_000).toISOString(),
        },
      ],
      hasMore: false,
    },
  })),
}));

const MEMBERS = [
  { userId: "u1", email: "alice@example.com", name: "Alice Anderson" },
  { userId: "u2", email: "bob@example.com", name: "Bob Brown" },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ActivityFeed (AS-361, assignee label wiring)", () => {
  it("test_AS_361_renders_a_relative_timestamp_not_an_absolute_clock_time", async () => {
    render(
      createElement(ActivityFeed, {
        taskId: "t1",
        timezone: "UTC",
        members: MEMBERS,
      }),
    );

    await waitFor(() => {
      expect(screen.getByText(/ago$/)).toBeInTheDocument();
    });

    // Never an absolute AM/PM clock string as the visible entry timestamp.
    expect(screen.queryByText(/\d{1,2}:\d{2}\s?(AM|PM)/i)).not.toBeInTheDocument();
  });

  it("test_assignee_entry_shows_a_real_name_not_someone", async () => {
    render(
      createElement(ActivityFeed, {
        taskId: "t1",
        timezone: "UTC",
        members: MEMBERS,
      }),
    );

    await waitFor(() => {
      expect(screen.getByText(/Bob Brown/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/someone/)).not.toBeInTheDocument();
  });
});
