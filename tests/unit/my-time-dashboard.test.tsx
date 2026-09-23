// @vitest-environment jsdom
//
// Tests for the "My time" personal dashboard
// (app/(workspace)/w/[workspaceSlug]/time/me/page.tsx): the view-mode
// toggle, the summary cards, the daily/weekly/monthly view bodies, and the
// weekly grid's inline cell-edit interaction (which calls the existing
// `logTimeEntry` action and always inserts a new row -- see
// components/time/weekly-time-grid.tsx's own doc comment for the
// AUTONOMOUS_DECISION rationale).

import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("@/lib/actions/time-entries", () => ({
  logTimeEntry: vi.fn(),
}));

import { logTimeEntry } from "@/lib/actions/time-entries";
import { MyTimeView } from "@/components/time/my-time-view";
import { WeeklyTimeGrid } from "@/components/time/weekly-time-grid";
import { MyTimeBarChart } from "@/components/time/my-time-bar-chart";
import { buildCalendarWeek } from "@/lib/calendar/week-grid";
import { buildCalendarMonth } from "@/lib/calendar/month-grid";

afterEach(() => {
  cleanup();
  vi.mocked(logTimeEntry).mockReset();
});

const WEEK_KEY = "2026-09-07"; // a Monday
const calendarWeek = buildCalendarWeek(WEEK_KEY, "UTC");
const calendarMonth = buildCalendarMonth(2026, 9, "UTC");

const baseProps = {
  workspaceSlug: "acme",
  summary: { todayMinutes: 60, weekMinutes: 300, monthMinutes: 1200 },
  entries: [
    {
      id: "e1",
      taskId: "task-1",
      taskTitle: "Write docs",
      projectId: "proj-1",
      projectName: "Docs project",
      minutes: 90,
      billable: true,
      entryDate: calendarWeek.days[0]!.date,
      note: null,
    },
  ],
  byProject: [
    { projectId: "proj-1", projectName: "Docs project", totalMinutes: 90, billableMinutes: 90 },
  ],
  dailyForRange: [
    { entryDate: calendarWeek.days[0]!.date, totalMinutes: 90, billableMinutes: 90 },
  ],
  assignedTasks: [{ id: "task-2", title: "Fix bug", projectName: "Core" }],
  selectedDate: calendarWeek.days[0]!.date,
  calendarWeek,
  calendarMonth,
  weekKey: WEEK_KEY,
  prevWeekKey: "2026-08-31",
  nextWeekKeyValue: "2026-09-14",
  prevMonthKeyParts: { year: 2026, month: 8 },
  nextMonthKeyParts: { year: 2026, month: 10 },
  prevDate: "2026-09-06",
  nextDate: "2026-09-08",
};

describe("test_AS_my_time_summary_cards_render", () => {
  it("renders today/this week/this month summary totals", () => {
    render(<MyTimeView {...baseProps} view="weekly" />);
    expect(screen.getByTestId("summary-card-today")).toHaveTextContent("1 hr");
    expect(screen.getByTestId("summary-card-this-week")).toHaveTextContent("5 hr");
    expect(screen.getByTestId("summary-card-this-month")).toHaveTextContent("20 hr");
  });
});

describe("test_AS_my_time_view_toggle", () => {
  it("marks the active view tab as selected and exposes daily/weekly/monthly tabs", () => {
    render(<MyTimeView {...baseProps} view="weekly" />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    const weeklyTab = screen.getByRole("tab", { name: "weekly" });
    expect(weeklyTab).toHaveAttribute("aria-selected", "true");
    const dailyTab = screen.getByRole("tab", { name: "daily" });
    expect(dailyTab).toHaveAttribute("aria-selected", "false");
    expect(dailyTab).toHaveAttribute("href", "/w/acme/time/me?view=daily");
  });

  it("renders the weekly grid when view=weekly", () => {
    render(<MyTimeView {...baseProps} view="weekly" />);
    expect(screen.getByTestId("weekly-time-grid")).toBeInTheDocument();
  });

  it("renders the daily entry list when view=daily", () => {
    render(<MyTimeView {...baseProps} view="daily" />);
    expect(screen.getByTestId("daily-entry-row")).toHaveTextContent("Write docs");
  });

  it("renders the monthly calendar grid when view=monthly", () => {
    render(<MyTimeView {...baseProps} view="monthly" />);
    expect(screen.getByTestId("monthly-calendar-grid")).toBeInTheDocument();
    expect(screen.getAllByTestId("monthly-calendar-day").length).toBeGreaterThan(27);
  });
});

describe("test_AS_my_time_by_project_breakdown", () => {
  it("lists each project with total and billable minutes", () => {
    render(<MyTimeView {...baseProps} view="weekly" />);
    const breakdown = screen.getByTestId("by-project-card");
    expect(breakdown).toHaveTextContent("Docs project");
    expect(breakdown).toHaveTextContent("1 hr 30 min");
  });
});

describe("test_AS_weekly_grid_shows_assigned_and_worked_tasks", () => {
  it("includes both a task with logged hours and a task only assigned (zero hours)", () => {
    const days = calendarWeek.days.map((d, i) => ({
      date: d.date,
      label: `Day ${i}`,
      isToday: d.isToday,
    }));
    render(
      <WeeklyTimeGrid
        tasks={[
          { id: "task-1", title: "Write docs", projectName: "Docs project" },
          { id: "task-2", title: "Fix bug", projectName: "Core" },
        ]}
        days={days}
        cellMinutes={{ [`task-1::${days[0]!.date}`]: 90 }}
      />,
    );
    expect(screen.getByText("Write docs")).toBeInTheDocument();
    expect(screen.getByText("Fix bug")).toBeInTheDocument();
    const docsRow = screen.getByText("Write docs").closest("tr")!;
    expect(
      within(docsRow).getByRole("button", { name: `Log time for ${days[0]!.date}` }),
    ).toHaveTextContent("1 hr 30 min");
  });
});

describe("test_AS_weekly_grid_cell_edit_logs_new_time_entry", () => {
  it("clicking a cell, entering hours, and submitting calls logTimeEntry and updates the displayed total", async () => {
    vi.mocked(logTimeEntry).mockResolvedValue({
      ok: true,
      data: {
        id: "new-entry",
        taskId: "task-2",
        userId: "user-1",
        minutes: 90,
        billable: true,
        entryDate: "2026-09-07",
        note: null,
        createdAt: "2026-09-07T00:00:00Z",
        workCategory: null,
      },
    });

    const days = [{ date: "2026-09-07", label: "Mon 7", isToday: false }];
    render(
      <WeeklyTimeGrid
        tasks={[{ id: "task-2", title: "Fix bug", projectName: "Core" }]}
        days={days}
        cellMinutes={{}}
      />,
    );

    const cell = screen.getByRole("button", { name: "Log time for 2026-09-07" });
    fireEvent.click(cell);

    const input = screen.getByLabelText("Hours for 2026-09-07");
    fireEvent.change(input, { target: { value: "1.5" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => {
      expect(logTimeEntry).toHaveBeenCalledWith("task-2", 90, true, "2026-09-07");
    });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Log time for 2026-09-07" }),
      ).toHaveTextContent("1 hr 30 min");
    });
  });
});

describe("test_AS_my_time_bar_chart_renders_accessible_bars", () => {
  it("renders one labeled bar per datum inside an accessible group, no SVG", () => {
    const { container } = render(
      <MyTimeBarChart
        data={[
          { key: "mon", label: "Mon", minutes: 60 },
          { key: "tue", label: "Tue", minutes: 120 },
        ]}
      />,
    );
    expect(screen.getByRole("group")).toBeInTheDocument();
    expect(container.querySelectorAll("svg")).toHaveLength(0);
    expect(screen.getAllByTestId("my-time-bar")).toHaveLength(2);
    expect(screen.getByText("2h")).toBeInTheDocument();
  });
});
