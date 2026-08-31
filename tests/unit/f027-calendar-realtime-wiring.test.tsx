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

// F041 (MUT-N wiring test): spy on the real reconciler while keeping its
// real implementation (so every other test's DOM assertions still work
// unchanged) -- this lets one test assert on the exact arguments
// `CalendarDayGrid` passes it, catching a mutant that drops/undefines the
// `visibleDateRange` argument at the call site even though no DOM query in
// this file can otherwise distinguish that mutation.
const reconcileSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/calendar/reconcile-realtime-task", async (importActual) => {
  const actual = await importActual<
    typeof import("@/lib/calendar/reconcile-realtime-task")
  >();
  reconcileSpy.mockImplementation(actual.reconcileCalendarRealtimeEvent);
  return {
    ...actual,
    reconcileCalendarRealtimeEvent: reconcileSpy,
  };
});

import { CalendarDayGrid } from "@/components/calendar/calendar-day-grid";
import type { CalendarDay } from "@/lib/calendar/month-grid";
import type { CalendarTask } from "@/lib/queries/calendar";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  onCalls.length = 0;
  channelCalls.length = 0;
  reconcileSpy.mockClear();
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

  it("test_AS_022_DELETE_with_minimal_old_id_payload_removes_the_task_from_the_grid", () => {
    // Replica identity default on `tasks` means a real DELETE's `old` only
    // ever carries `{id}` -- this is the realistic minimal payload shape.
    // Proves the grid actually unwires from useCalendarRealtime: if the
    // `useCalendarRealtime({...})` call in calendar-day-grid.tsx were
    // removed, `onCalls` would stay empty, `dispatch` would throw on
    // `onCalls[0]`, and this test would fail.
    renderGrid({ "2026-09-01": [existingTask()] });

    expect(
      screen.getByTestId("calendar-day-cell-2026-09-01"),
    ).toHaveTextContent("Existing task");

    dispatch({
      eventType: "DELETE",
      schema: "public",
      table: "tasks",
      new: {},
      old: { id: "t1" },
    });

    expect(screen.queryByText("Existing task")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("calendar-day-cell-2026-09-01"),
    ).not.toHaveTextContent("Existing task");
  });

  it("test_AS_022_passes_the_rendered_grid_own_date_window_to_the_reconciler", () => {
    // F041 (scrutiny-6 MUT-N fix): a mutant that replaces the
    // `visibleDateRange` argument at the call site
    // (components/calendar/calendar-day-grid.tsx) with `undefined` leaves
    // every DOM-assertion test in this suite green, because `days()`
    // above only renders 5 contiguous days -- any due_date OUTSIDE that
    // window can never gain a rendered `<DayCell>` regardless of whether
    // scoping ran, so no DOM query can distinguish "scoped and dropped"
    // from "unscoped but nothing to render into". This test instead spies
    // on the real (un-mocked) `reconcileCalendarRealtimeEvent` export and
    // asserts the grid calls it with the ACTUAL 4th argument derived from
    // `days[0].date`/`days[days.length - 1].date` (2026-09-01..2026-09-05,
    // per `days()` above) -- not `undefined` -- proving the wiring exists
    // independent of what any individual event happens to render.
    renderGrid({ "2026-09-01": [existingTask()] });

    dispatch(
      insertOrUpdateEvent("INSERT", {
        id: "t3",
        title: "Some new task",
        due_date: "2026-09-02",
      }),
    );

    expect(reconcileSpy).toHaveBeenCalled();
    const lastCallArgs = reconcileSpy.mock.calls.at(-1)!;
    expect(lastCallArgs[3]).toEqual({
      start: "2026-09-01",
      end: "2026-09-05",
    });
  });

  it("test_AS_022_ignores_an_INSERT_for_a_task_outside_the_caller_visible_projects", () => {
    // AS-022: "Calendar realtime only delivers events for tasks the current
    // user is permitted to see." projectIds=["project-1"] is the caller's
    // visible set; an event for a task in a different project must never
    // reach the rendered grid, even though the mocked channel forwards it.
    renderGrid({ "2026-09-01": [existingTask()] });

    dispatch(
      insertOrUpdateEvent("INSERT", {
        id: "t9",
        title: "Task from a private project",
        project_id: "private-project",
        due_date: "2026-09-03",
      }),
    );

    expect(
      screen.queryByText("Task from a private project"),
    ).not.toBeInTheDocument();
  });
});
