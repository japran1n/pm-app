// @vitest-environment jsdom
//
// Render tests for the global "Track Time" header widget
// (components/time/global-time-tracker.tsx): trigger renders, opening the
// popover shows the daily progress + form + recent entries, an active
// timer renders a live-updating badge, and submitting the manual form
// calls the existing logTimeEntry Server Action with a parsed duration.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { GlobalTimeTracker } from "@/components/time/global-time-tracker";
import type { MyRecentTimeEntry } from "@/lib/queries/time-entries";

const logTimeEntryMock = vi.fn();
const startTimerMock = vi.fn();
const stopTimerMock = vi.fn();
const deleteTimeEntryMock = vi.fn();

vi.mock("@/lib/actions/time-entries", () => ({
  logTimeEntry: (...args: unknown[]) => logTimeEntryMock(...args),
  startTimer: (...args: unknown[]) => startTimerMock(...args),
  stopTimer: (...args: unknown[]) => stopTimerMock(...args),
  deleteTimeEntry: (...args: unknown[]) => deleteTimeEntryMock(...args),
}));

const searchPaletteMock = vi.fn();
vi.mock("@/lib/actions/palette-search", () => ({
  searchPalette: (...args: unknown[]) => searchPaletteMock(...args),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const RECENT_ENTRIES: MyRecentTimeEntry[] = [
  {
    id: "entry-1",
    taskId: "task-1",
    taskTitle: "Fix the header bug",
    minutes: 90,
    billable: true,
    entryDate: "2026-09-04",
    note: null,
  },
];

async function openPanel() {
  const trigger = screen.getByTestId("global-time-tracker-trigger");
  fireEvent.click(trigger);
  await waitFor(() => screen.getByText("Track Time"));
}

describe("GlobalTimeTracker", () => {
  it("test_track_time_trigger_renders_in_the_header_with_no_active_timer_badge", () => {
    render(
      <GlobalTimeTracker
        workspaceId="w1"
        workspaceSlug="acme"
        initialActiveTimer={null}
        initialRecentEntries={[]}
      />,
    );

    expect(screen.getByTestId("global-time-tracker-trigger")).toBeInTheDocument();
    expect(screen.queryByTestId("global-time-tracker-live-badge")).not.toBeInTheDocument();
  });

  it("test_track_time_shows_a_live_updating_badge_when_a_timer_is_active", () => {
    render(
      <GlobalTimeTracker
        workspaceId="w1"
        workspaceSlug="acme"
        initialActiveTimer={{
          id: "timer-1",
          taskId: "task-1",
          taskTitle: "Fix the header bug",
          startedAt: new Date(Date.now() - 65_000).toISOString(),
        }}
        initialRecentEntries={[]}
      />,
    );

    const badge = screen.getByTestId("global-time-tracker-live-badge");
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toMatch(/^\d{2}:\d{2}$/);
  });

  it("test_track_time_opening_the_popover_shows_daily_progress_against_the_8h_goal", async () => {
    render(
      <GlobalTimeTracker
        workspaceId="w1"
        workspaceSlug="acme"
        initialActiveTimer={null}
        initialRecentEntries={[]}
      />,
    );

    await openPanel();
    expect(screen.getByTestId("daily-progress-label")).toHaveTextContent("0m / 8h");
  });

  it("test_track_time_opening_the_popover_lists_recent_entries_grouped_by_day", async () => {
    render(
      <GlobalTimeTracker
        workspaceId="w1"
        workspaceSlug="acme"
        initialActiveTimer={null}
        initialRecentEntries={RECENT_ENTRIES}
      />,
    );

    await openPanel();
    expect(screen.getByText("Fix the header bug")).toBeInTheDocument();
    expect(screen.getAllByText("1h 30m").length).toBeGreaterThan(0);
  });

  it("test_track_time_footer_links_to_my_timesheet_and_dashboard", async () => {
    render(
      <GlobalTimeTracker
        workspaceId="w1"
        workspaceSlug="acme"
        initialActiveTimer={null}
        initialRecentEntries={[]}
      />,
    );

    await openPanel();
    expect(screen.getByRole("link", { name: "My Timesheet" })).toHaveAttribute(
      "href",
      "/w/acme/time/me?view=weekly",
    );
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "href",
      "/w/acme/time/me",
    );
  });

  it("test_track_time_submitting_a_manual_duration_calls_logTimeEntry_with_parsed_minutes", async () => {
    searchPaletteMock.mockResolvedValue({
      projects: [],
      tasks: [
        {
          type: "task",
          id: "task-1",
          title: "Fix the header bug",
          projectId: "p1",
          projectName: "Website",
          projectKey: "WEB",
          number: 12,
        },
      ],
      members: [],
    });
    logTimeEntryMock.mockResolvedValue({
      ok: true,
      data: {
        id: "entry-2",
        taskId: "task-1",
        userId: "u1",
        minutes: 200,
        billable: true,
        entryDate: "2026-09-06",
        note: null,
        createdAt: "2026-09-06T00:00:00.000Z",
        workCategory: null,
      },
    });

    render(
      <GlobalTimeTracker
        workspaceId="w1"
        workspaceSlug="acme"
        initialActiveTimer={null}
        initialRecentEntries={[]}
      />,
    );

    await openPanel();

    fireEvent.change(screen.getByLabelText("Select task"), {
      target: { value: "Fix" },
    });
    await waitFor(() => expect(searchPaletteMock).toHaveBeenCalled());
    await waitFor(() => screen.getByText("Fix the header bug"));
    fireEvent.mouseDown(screen.getByText("Fix the header bug"));

    fireEvent.change(screen.getByLabelText("Enter time or start timer"), {
      target: { value: "3h 20m" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(logTimeEntryMock).toHaveBeenCalledWith(
        "task-1",
        200,
        true,
        expect.any(String),
        undefined,
      ),
    );
  });
});
