// @vitest-environment jsdom
//
// Unit test for F249 (AS-481): the quick-add card appears immediately
// (optimistically) and is reconciled with the server result once
// createTask resolves. Renders the real <Board> (which owns
// handleTaskOptimisticAdd/handleTaskCreated/handleCreateError -- see
// board.tsx's own doc comments) with a mocked createTask so nothing
// touches a real database, and a mocked useBoardRealtime so this test can
// simulate the Realtime INSERT echo of the created row independently of
// the local createTask promise's own resolution order -- the single most
// likely bug per this feature's spec ("realtime interaction").

import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "test-publishable-key";

vi.mock("@/lib/actions/tasks", () => ({
  moveAndReorderTask: vi.fn(async () => ({ ok: true, data: {} })),
  reorderTask: vi.fn(async () => ({ ok: true, data: {} })),
  createTask: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/w/acme/projects/proj-1/board",
  useSearchParams: () => new URLSearchParams(),
}));

// F249: this board's own Realtime `postgres_changes` subscription
// (lib/board/subscribe-board-realtime.ts, wired via
// components/board/use-board-realtime.ts) -- mocked here so this test
// fully controls WHEN the INSERT echo for the just-created task arrives,
// relative to createTask's own promise settling, to prove both orderings
// converge to exactly one card.
let capturedOnChange: ((event: unknown) => void) | null = null;
vi.mock("@/components/board/use-board-realtime", () => ({
  useBoardRealtime: (_projectId: string, onChange: (event: unknown) => void) => {
    capturedOnChange = onChange;
  },
}));

// F093 follow-up: board.tsx also mounts useBoardColumnsRealtime (a
// SEPARATE Realtime subscription, on the `project_columns` table) --
// missing this mock is exactly what let this file open a real WebSocket
// (this test only mocked useBoardRealtime above, not this one) even
// though it "controls" the board's own task Realtime. No behavior under
// test here depends on column change events, so this is a plain no-op.
vi.mock("@/components/board/use-board-columns-realtime", () => ({
  useBoardColumnsRealtime: () => {},
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}));

import { Board } from "@/components/board/board";
import { createTask } from "@/lib/actions/tasks";
import type { TaskCardTask } from "@/components/task/task-card";

const mockedCreateTask = vi.mocked(createTask);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  capturedOnChange = null;
});

beforeEach(() => {
  capturedOnChange = null;
});

function realtimeInsertEvent(row: {
  id: string;
  project_id: string;
  title: string;
  status: string;
  priority: string | null;
  assignee_id: string | null;
  due_date: string | null;
  position: number;
}) {
  return {
    eventType: "INSERT",
    schema: "public",
    table: "tasks",
    new: {
      deleted_at: null,
      updated_at: "2026-08-24T00:00:00Z",
      number: 5,
      startDate: null,
      estimateMinutes: null,
      tags: [],
      billable: true,
      ...row,
    },
    old: {},
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function renderBoard(initialTasks: TaskCardTask[] = []) {
  render(
    createElement(Board, {
      projectId: "project-1",
      initialTasks,
      timezone: "UTC",
    }),
  );
}

// Board renders one <QuickAdd> per column (DEFAULT_COLUMNS: todo,
// in_progress, in_review, done -- see board-column.tsx's own
// `data-status` attribute) -- scope to the requested column's own
// container so this doesn't collide with the other three columns' own
// "Add task" triggers.
function openQuickAddFor(status: string) {
  const column = document.querySelector(`[data-status="${status}"]`) as HTMLElement;
  fireEvent.click(
    within(column).getByRole("button", { name: /^add task$/i }),
  );
  return within(column).getByRole("textbox") as HTMLInputElement;
}

describe("F249 AS-481: quick-add card appears immediately and reconciles with the server result", () => {
  it("test_AS_481_optimistic_card_appears_before_createTask_resolves_then_reconciles_to_the_real_row", async () => {
    let resolveCreate!: (value: Awaited<ReturnType<typeof createTask>>) => void;
    mockedCreateTask.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );

    renderBoard([]);
    const input = openQuickAddFor("todo");
    fireEvent.change(input, { target: { value: "New optimistic task" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await flush();

    // The card is already on the board, before createTask has resolved
    // at all -- this is the "appears immediately" half of AS-481.
    expect(screen.getByText("New optimistic task")).toBeInTheDocument();
    expect(screen.getAllByText("New optimistic task")).toHaveLength(1);

    resolveCreate({
      ok: true,
      data: {
        id: "real-task-1",
        projectId: "project-1",
        title: "New optimistic task",
        description: null,
        status: "todo",
        priority: null,
        assigneeId: null,
        dueDate: null,
        authorId: "user-1",
        position: 1000,
        createdAt: "2026-08-24T00:00:00Z",
        parentTaskId: null,
        number: 5,
        startDate: null,
        estimateMinutes: null,
        tags: [],
        billable: true,
      },
    });
    await flush();

    // Still exactly one card -- reconciled to the real row, not a
    // second, permanently-fake one.
    expect(screen.getAllByText("New optimistic task")).toHaveLength(1);
  });

  it("test_AS_481_realtime_insert_echo_of_the_just_created_task_does_not_produce_a_duplicate_card", async () => {
    let resolveCreate!: (value: Awaited<ReturnType<typeof createTask>>) => void;
    mockedCreateTask.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );

    renderBoard([]);
    const input = openQuickAddFor("todo");
    fireEvent.change(input, { target: { value: "Echoed task" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await flush();

    expect(screen.getAllByText("Echoed task")).toHaveLength(1);

    // Simulate the server's Realtime INSERT for this same row arriving
    // BEFORE the local createTask() call has resolved -- the ordering
    // this feature's spec calls out as the single most likely bug.
    expect(capturedOnChange).not.toBeNull();
    act(() => {
      capturedOnChange!(
        realtimeInsertEvent({
          id: "real-task-2",
          project_id: "project-1",
          title: "Echoed task",
          status: "todo",
          priority: null,
          assignee_id: null,
          due_date: null,
          position: 1000,
        }),
      );
    });
    await flush();

    // The realtime echo must NOT produce a second card alongside the
    // still-pending optimistic one.
    expect(screen.getAllByText("Echoed task")).toHaveLength(1);

    resolveCreate({
      ok: true,
      data: {
        id: "real-task-2",
        projectId: "project-1",
        title: "Echoed task",
        description: null,
        status: "todo",
        priority: null,
        assigneeId: null,
        dueDate: null,
        authorId: "user-1",
        position: 1000,
        createdAt: "2026-08-24T00:00:00Z",
        parentTaskId: null,
        number: 5,
        startDate: null,
        estimateMinutes: null,
        tags: [],
        billable: true,
      },
    });
    await flush();

    // Still exactly one card once createTask's own promise also
    // resolves -- the placeholder was dropped, not duplicated.
    expect(screen.getAllByText("Echoed task")).toHaveLength(1);
  });

  it("test_AS_481_createTask_failure_rolls_the_optimistic_card_back_with_exactly_one_toast", async () => {
    mockedCreateTask.mockResolvedValue({
      ok: false,
      error: "Could not create task.",
    });

    renderBoard([]);
    const input = openQuickAddFor("todo");
    fireEvent.change(input, { target: { value: "Doomed task" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // The optimistic card is committed synchronously, in the same event
    // handler pass, before createTask's promise has even had a chance to
    // settle -- checked before `flush()` on purpose.
    expect(screen.getByText("Doomed task")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByText("Doomed task")).not.toBeInTheDocument();
    });
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith("Could not create task.");
  });

  it("test_AS_481_two_rapid_quick_adds_do_not_collide_on_position_or_placeholder_identity", async () => {
    const pending: Array<(value: Awaited<ReturnType<typeof createTask>>) => void> = [];
    mockedCreateTask.mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(resolve);
        }),
    );

    renderBoard([]);
    const input = openQuickAddFor("todo");

    fireEvent.change(input, { target: { value: "First rapid task" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await flush();

    fireEvent.change(input, { target: { value: "Second rapid task" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await flush();

    // Both optimistic cards are present, distinctly -- neither
    // overwrote/replaced the other via a colliding placeholder id.
    expect(screen.getByText("First rapid task")).toBeInTheDocument();
    expect(screen.getByText("Second rapid task")).toBeInTheDocument();
    expect(mockedCreateTask).toHaveBeenCalledTimes(2);

    pending[0]({
      ok: true,
      data: {
        id: "real-1",
        projectId: "project-1",
        title: "First rapid task",
        description: null,
        status: "todo",
        priority: null,
        assigneeId: null,
        dueDate: null,
        authorId: "user-1",
        position: 1000,
        createdAt: "2026-08-24T00:00:00Z",
        parentTaskId: null,
        number: 5,
        startDate: null,
        estimateMinutes: null,
        tags: [],
        billable: true,
      },
    });
    pending[1]({
      ok: true,
      data: {
        id: "real-2",
        projectId: "project-1",
        title: "Second rapid task",
        description: null,
        status: "todo",
        priority: null,
        assigneeId: null,
        dueDate: null,
        authorId: "user-1",
        position: 2000,
        createdAt: "2026-08-24T00:00:00Z",
        parentTaskId: null,
        number: 6,
        startDate: null,
        estimateMinutes: null,
        tags: [],
        billable: true,
      },
    });
    await flush();

    expect(screen.getAllByText("First rapid task")).toHaveLength(1);
    expect(screen.getAllByText("Second rapid task")).toHaveLength(1);
  });
});
