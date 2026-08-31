// @vitest-environment jsdom
//
// F025 (AS-015, AS-016, AS-017, AS-018): component-level proof that
// <PersonalTodoList> is actually wired to useMyTasksRealtime, and that a
// realtime event flowing through it causes the rendered My Tasks output to
// change (via router.refresh() triggering a fresh server render, simulated
// here by re-rendering with new `initialTodos`). This is a genuine DOM-level
// wiring test, not source inspection -- deleting the `useMyTasksRealtime(...)`
// call from personal-todo-list.tsx makes the "hook is called with the
// current user id" assertion below fail.

import { useState } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { PersonalTodoList } from "@/components/my-tasks/personal-todo-list";
import type { PersonalTodo } from "@/lib/queries/personal-todos";

vi.mock("@/lib/actions/personal-todos", () => ({
  createPersonalTodo: vi.fn(async () => ({ ok: true, data: {} })),
  deleteTodo: vi.fn(async () => ({ ok: true, data: {} })),
  toggleTodo: vi.fn(async () => ({ ok: true, data: {} })),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

type Handlers = {
  onAssigned: (taskId: string) => void;
  onUnassigned: (taskId: string) => void;
  onUpdate: (row: { id: string; [key: string]: unknown }) => void;
  onDelete: (taskId: string) => void;
};

let capturedHandlers: Handlers | null = null;
const useMyTasksRealtimeMock = vi.fn((options: { userId: string | undefined } & Handlers) => {
  capturedHandlers = options;
});

vi.mock("@/components/my-tasks/use-my-tasks-realtime", () => ({
  useMyTasksRealtime: (options: { userId: string | undefined } & Handlers) =>
    useMyTasksRealtimeMock(options),
}));

afterEach(() => {
  cleanup();
  refresh.mockClear();
  useMyTasksRealtimeMock.mockClear();
  capturedHandlers = null;
});

const initialTodos: PersonalTodo[] = [{ id: "todo-1", title: "First reminder", isDone: false, position: 0 }];
const updatedTodos: PersonalTodo[] = [
  { id: "todo-1", title: "First reminder", isDone: false, position: 0 },
  { id: "todo-2", title: "Second reminder (arrived live)", isDone: false, position: 1 },
];

// Test harness: owns the "server" state that a real router.refresh() would
// eventually update via a fresh Server Component render. Wiring
// router.refresh -> new props here stands in for that round trip so the
// test can observe the DOM actually changing.
function Harness() {
  const [todos, setTodos] = useState(initialTodos);
  refresh.mockImplementation(() => setTodos(updatedTodos));
  return (
    <PersonalTodoList workspaceId="ws-1" initialTodos={todos} currentUserId="user-1" />
  );
}

describe("PersonalTodoList realtime wiring (AS-015, AS-016, AS-017, AS-018)", () => {
  it("mounts useMyTasksRealtime scoped to the current user", () => {
    render(<Harness />);

    expect(useMyTasksRealtimeMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
    );
  });

  it("AS-015: a new-assignment event triggers a refresh whose fresh data renders", () => {
    render(<Harness />);
    expect(screen.queryByText("Second reminder (arrived live)")).not.toBeInTheDocument();

    act(() => capturedHandlers!.onAssigned("t1"));

    expect(refresh).toHaveBeenCalled();
    expect(screen.getByText("Second reminder (arrived live)")).toBeInTheDocument();
  });

  it("AS-016: a task update event triggers a refresh whose fresh data renders", () => {
    render(<Harness />);

    act(() => capturedHandlers!.onUpdate({ id: "t1", title: "Task 1", status: "done" }));

    expect(refresh).toHaveBeenCalled();
    expect(screen.getByText("Second reminder (arrived live)")).toBeInTheDocument();
  });

  it("AS-017: an un-assignment event triggers a refresh whose fresh data renders", () => {
    render(<Harness />);

    act(() => capturedHandlers!.onUnassigned("t1"));

    expect(refresh).toHaveBeenCalled();
    expect(screen.getByText("Second reminder (arrived live)")).toBeInTheDocument();
  });

  it("AS-018: a task delete event triggers a refresh whose fresh data renders", () => {
    render(<Harness />);

    act(() => capturedHandlers!.onDelete("t1"));

    expect(refresh).toHaveBeenCalled();
    expect(screen.getByText("Second reminder (arrived live)")).toBeInTheDocument();
  });
});
