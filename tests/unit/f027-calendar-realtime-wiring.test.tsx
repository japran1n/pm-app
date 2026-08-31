// @vitest-environment jsdom
//
// F027 (AS-019, AS-020, AS-021, AS-022): component-level proof that
// <CalendarDayGrid> is actually WIRED to `useCalendarRealtime` — F009
// covered `reconcileCalendarRealtimeEvent` and `subscribeToCalendarRealtime`
// in isolation (tests/unit/f009-calendar-realtime-subscription.test.ts) but
// never rendered the grid itself, so deleting the
// `useCalendarRealtime({...})` call from calendar-day-grid.tsx left zero
// tests red. These tests render the real component, dispatch fake Realtime
// payloads through the mocked Supabase channel, and assert the rendered
// DOM changes — same "mock the channel, fire its callback, assert on
// screen" shape as tests/unit/f251-list-table-realtime.test.tsx.

import { createElement } from "react";
import { cleanup, render, screen, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("@/lib/actions/tasks", () => ({
  editTask: vi.fn(),
}));

vi.mock("@/components/auth/membership-provider", () => ({
  useMembership: () => null,
}));

// Mirrors f009's own mock shape: `.on()` records the dispatch callback so
// the test can fire it directly, `.channel()` records the topic name.
const onCalls: Array<{ callback: (payload: unknown) => void }> = [];
const channelCalls: string[] = [];

function makeFakeSupabase() {
  const channelObject = {
    on: vi.fn((_event: string, _filter: unknown, callback: (payload: unknown) => void) => {
      onCalls.push({ callback });
      return channelObject;
    }),
    subscribe: vi.fn(() => channelObject),
  };

  return {
    channel: vi.fn((name: string) => {
      channelCalls.push(name);
      return channelObject;
    }),
    removeChannel: vi.fn(),
  };
}

const fakeSupabase = makeFakeSupabase();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => fakeSupabase,
}));

import { CalendarDayGrid } from "@/components/calendar/calendar-day-grid";
import type { CalendarDay } from "@/lib/calendar/month-grid";
import type { CalendarTask } from "@/lib/queries/calendar";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  onCalls.length = 0;
  channelCalls.length = 0;
});

function day(date: string, isCurrentMonth = true): CalendarDay {
  return { date: date as CalendarDay["date"], isCurrentMonth, isToday: false };
}

function days(): CalendarDay[] {
  return [
    day("2026-09-01"),
    day("2026-09-02"),
    day("2026-09-03"),
    day("2026-09-04"),
    day("2026-09-05"),
  ];
}

function existingTask(overrides: Partial<CalendarTask> = {}): CalendarTask {
  return {
    id: "t1",
    title: "Existing task",
    status: "todo",
    statusCategory: "todo",
    isDone: false,
    priority: "medium",
    dueDate: "2026-09-01" as CalendarTask["dueDate"],
    number: 1,
    projectId: "project-1",
    projectKey: "ENG",
    projectName: "Engineering",
    assignees: [],
    ...overrides,
  };
}

// F329's shared-topic-channel registry dedupes `.channel()`/`.on()` calls
// per topic (ref-counted, deferred async teardown -- see f009's own
// "deferred teardown" test) -- a still-live entry from an earlier test in
// this file would silently short-circuit `.on()` and never repopulate
// `onCalls`. Each test gets its OWN workspaceId (own "tasks:calendar:<id>"
// topic) so it always gets a fresh channel/`.on()` registration.
let workspaceCounter = 0;
function renderGrid(tasksByDate: Record<string, CalendarTask[]>) {
  workspaceCounter += 1;
  return render(
    createElement(CalendarDayGrid, {
      days: days(),
      tasksByDate,
      workspaceSlug: "acme",
      workspaceId: `workspace-${workspaceCounter}`,
      projectIds: ["project-1"],
    }),
  );
}

function insertOrUpdateEvent(
  eventType: "INSERT" | "UPDATE",
  row: Partial<Record<string, unknown>> & { id: string },
) {
  return {
    eventType,
    schema: "public",
    table: "tasks",
    new: {
      project_id: "project-1",
      title: "Existing task",
      status: "todo",
      priority: "medium",
      due_date: null,
      number: 1,
      deleted_at: null,
      updated_at: "2026-09-01T00:00:00Z",
      ...row,
    },
    old: { id: row.id },
  };
}

function dispatch(payload: unknown) {
  act(() => {
    onCalls[0]!.callback(payload);
  });
}

describe("F027 (AS-019..AS-022): CalendarDayGrid is wired to useCalendarRealtime", () => {
  it("test_AS_020_INSERT_with_due_date_shows_the_new_task_on_the_correct_day", () => {
    renderGrid({ "2026-09-01": [existingTask()] });

    expect(onCalls).toHaveLength(1);
    expect(screen.queryByText("Brand new task")).not.toBeInTheDocument();

    dispatch(
      insertOrUpdateEvent("INSERT", {
        id: "t2",
        title: "Brand new task",
        due_date: "2026-09-03",
      }),
    );

    const cell3 = screen.getByTestId("calendar-day-cell-2026-09-03");
    expect(cell3).toHaveTextContent("Brand new task");
  });

  it("test_AS_019_UPDATE_changing_due_date_moves_the_task_to_the_new_day", () => {
    renderGrid({ "2026-09-01": [existingTask()] });

    const cell1 = screen.getByTestId("calendar-day-cell-2026-09-01");
    expect(cell1).toHaveTextContent("Existing task");

    dispatch(
      insertOrUpdateEvent("UPDATE", {
        id: "t1",
        due_date: "2026-09-04",
      }),
    );

    expect(
      screen.getByTestId("calendar-day-cell-2026-09-01"),
    ).not.toHaveTextContent("Existing task");
    expect(
      screen.getByTestId("calendar-day-cell-2026-09-04"),
    ).toHaveTextContent("Existing task");
  });

  it("test_AS_021_UPDATE_clearing_due_date_removes_the_task_from_the_grid", () => {
    renderGrid({ "2026-09-01": [existingTask()] });

    expect(
      screen.getByTestId("calendar-day-cell-2026-09-01"),
    ).toHaveTextContent("Existing task");

    dispatch(
      insertOrUpdateEvent("UPDATE", {
        id: "t1",
        due_date: null,
      }),
    );

    expect(screen.queryByText("Existing task")).not.toBeInTheDocument();
  });

  it("test_AS_021_DELETE_removes_the_task_from_the_grid", () => {
    renderGrid({ "2026-09-01": [existingTask()] });

    expect(
      screen.getByTestId("calendar-day-cell-2026-09-01"),
    ).toHaveTextContent("Existing task");

    dispatch({
      eventType: "DELETE",
      schema: "public",
      table: "tasks",
      new: {},
      old: { id: "t1", project_id: "project-1" },
    });

    expect(screen.queryByText("Existing task")).not.toBeInTheDocument();
  });

  it("test_AS_022_subscribes_on_the_workspace_scoped_calendar_channel", () => {
    renderGrid({ "2026-09-01": [existingTask()] });

    expect(channelCalls).toEqual([`tasks:calendar:workspace-${workspaceCounter}`]);
  });
});
