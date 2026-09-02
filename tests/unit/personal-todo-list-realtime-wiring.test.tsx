// @vitest-environment jsdom
//
// F025/F031 (AS-015, AS-016, AS-017, AS-018): component-level proof that
// <PersonalTodoList> is actually wired to the REAL useMyTasksRealtime
// implementation, and that a genuine Realtime payload flowing through the
// mocked Supabase channel causes the rendered My Tasks output to change (via
// router.refresh() triggering a fresh server render, simulated here by
// re-rendering with new `initialTodos`).
//
// Unlike the previous version of this test, `useMyTasksRealtime` itself is
// NOT mocked -- only the Supabase client's `.channel()` is, mirroring
// tests/unit/palette-search-realtime.test.ts's "CommandPalette wiring to
// Realtime" pattern. This means:
//   - deleting the `useMyTasksRealtime(...)` call from personal-todo-list.tsx
//     makes every test below fail (no `.channel()` call happens at all);
//   - deleting the hook's internal event-dispatch logic (the switch on
//     eventType) makes the AS-016/AS-017/AS-018 tests fail, since they only
//     pass by driving a REAL `postgres_changes` payload through the
//     captured `.on()` callback, not by calling a handler directly;
//   - a regression of AS-018's fix (forwarding `tasks` UPDATE/DELETE for
//     ANY row, not just tracked ones) is caught by the last test below.

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

// Captures every `.on(event, filter, callback)` registration made against
// the mocked channel, across every table subscribed (`task_assignees` and
// `tasks`), so tests can drive a real payload through whichever callback
// matches the table/event they care about.
type OnCall = {
  event: string;
  filter: { event: string; schema: string; table: string };
  callback: (payload: unknown) => void;
  // Which `.channel(name)` topic this `.on()` binding was registered
  // against -- lets tests prove a table's binding lives on the specific
  // per-table channel (F003), not merely that the binding exists somewhere.
  channelName: string;
};

let onCalls: OnCall[] = [];
let channelCalls: string[] = [];

function makeFakeSupabase() {
  // A distinct channel object per `.channel(name)` topic (rather than one
  // shared object for every name) so `.on()` registrations can be
  // attributed back to the specific channel they were made on.
  const channelObjects = new Map<string, ReturnType<typeof makeChannelObject>>();

  function makeChannelObject(name: string) {
    const obj = {
      on: vi.fn(
        (event: string, filter: OnCall["filter"], callback: (payload: unknown) => void) => {
          onCalls.push({ event, filter, callback, channelName: name });
          return obj;
        },
      ),
      subscribe: vi.fn(() => obj),
    };
    return obj;
  }

  return {
    channel: vi.fn((name: string) => {
      channelCalls.push(name);
      let obj = channelObjects.get(name);
      if (!obj) {
        obj = makeChannelObject(name);
        channelObjects.set(name, obj);
      }
      return obj;
    }),
    removeChannel: vi.fn(),
  };
}

// A fresh mock client per test (not a shared module-level singleton): the
// shared-topic-channel registry (lib/realtime/shared-topic-channel.ts) is
// keyed per Supabase client instance and reuses an already-live channel for
// a topic without re-invoking `.on()` -- a single shared mock across tests
// would mean only the FIRST test's render actually registers `.on()`
// callbacks, since later renders would just reuse that channel.
let currentSupabase = makeFakeSupabase();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => currentSupabase,
}));

function callbackFor(table: "task_assignees" | "tasks") {
  const match = onCalls.find((call) => call.filter.table === table);
  if (!match) throw new Error(`no .on() callback captured for table "${table}"`);
  return match.callback;
}

afterEach(() => {
  cleanup();
  refresh.mockClear();
  onCalls = [];
  channelCalls = [];
  currentSupabase = makeFakeSupabase();
});

// F035: distinct ids -- "todo-1" (personal_todos table) must never be used
// as a stand-in for a `tasks.id`. AS-016/AS-018 seed the realtime hook's
// tracked-id set from `initialTaskIds` (real task ids, e.g. "task-1"), NOT
// from the personal-todo ids rendered by this component.
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
    <PersonalTodoList
      workspaceId="ws-1"
      initialTodos={todos}
      currentUserId="user-1"
      initialTaskIds={["task-1"]}
    />
  );
}

describe("PersonalTodoList realtime wiring (AS-015, AS-016, AS-017, AS-018)", () => {
  it("mounts the real hook, subscribing to user-scoped channels split per table (F003)", () => {
    render(<Harness />);

    // F003 deliberately split the single "tasks:my-tasks:user-1" channel
    // into two per-table channels so an unpublished table on one binding
    // cannot silently kill the other's subscription.
    expect(channelCalls.sort()).toEqual([
      "tasks:my-tasks:user-1:assignees",
      "tasks:my-tasks:user-1:tasks",
    ]);

    // Each channel must carry exactly the binding for its own table -- not
    // just "some binding for that table exists somewhere" -- so this test
    // still fails if the split ever regresses back onto one shared channel
    // (which would put both bindings' `.on()` calls on the same channel
    // name) or if a table's binding ends up on the wrong channel.
    const assigneesChannelCall = onCalls.find(
      (c) =>
        c.filter.table === "task_assignees" &&
        c.channelName === "tasks:my-tasks:user-1:assignees",
    );
    const tasksChannelCall = onCalls.find(
      (c) => c.filter.table === "tasks" && c.channelName === "tasks:my-tasks:user-1:tasks",
    );
    expect(assigneesChannelCall).toBeDefined();
    expect(tasksChannelCall).toBeDefined();
    expect(onCalls).toHaveLength(2);
  });

  it("AS-015: a task_assignees INSERT for this user triggers a refresh whose fresh data renders", () => {
    render(<Harness />);
    expect(screen.queryByText("Second reminder (arrived live)")).not.toBeInTheDocument();

    act(() =>
      callbackFor("task_assignees")({
        eventType: "INSERT",
        schema: "public",
        table: "task_assignees",
        new: { task_id: "t1", user_id: "user-1" },
        old: {},
      }),
    );

    expect(refresh).toHaveBeenCalled();
    expect(screen.getByText("Second reminder (arrived live)")).toBeInTheDocument();
  });

  it("AS-016: a real tasks UPDATE payload for a task already visible on this page (seeded via initialTaskIds, F035) triggers a refresh whose fresh data renders", () => {
    render(<Harness />);

    // No task_assignees INSERT fires first -- production wiring seeds the
    // tracked-id set directly from the server-fetched real TASK ids passed
    // as `initialTaskIds` (F035, NOT the personal-todo ids), so "task-1" is
    // already tracked at mount without any prior assignment event this
    // session.
    act(() =>
      callbackFor("tasks")({
        eventType: "UPDATE",
        schema: "public",
        table: "tasks",
        new: { id: "task-1", title: "Some task", status: "done" },
        old: { id: "task-1", title: "Some task", status: "todo" },
      }),
    );

    expect(refresh).toHaveBeenCalled();
    expect(screen.getByText("Second reminder (arrived live)")).toBeInTheDocument();
  });

  it("AS-017: a task_assignees DELETE for this user triggers a refresh whose fresh data renders", () => {
    render(<Harness />);

    act(() =>
      callbackFor("task_assignees")({
        eventType: "DELETE",
        schema: "public",
        table: "task_assignees",
        new: {},
        old: { task_id: "t1", user_id: "user-1" },
      }),
    );

    expect(refresh).toHaveBeenCalled();
    expect(screen.getByText("Second reminder (arrived live)")).toBeInTheDocument();
  });

  it("AS-018: a real tasks DELETE payload for a task already visible on this page (seeded via initialTaskIds, F035) triggers a refresh whose fresh data renders", () => {
    render(<Harness />);

    act(() =>
      callbackFor("tasks")({
        eventType: "DELETE",
        schema: "public",
        table: "tasks",
        new: {},
        old: { id: "task-1" },
      }),
    );

    expect(refresh).toHaveBeenCalled();
    expect(screen.getByText("Second reminder (arrived live)")).toBeInTheDocument();
  });

  it("AS-018: a tasks UPDATE for a task never tracked by this session is NOT propagated", () => {
    render(<Harness />);

    // No task_assignees event has fired for "t-other" -- it's some
    // workspace-wide task this user never had, but is still RLS-visible on
    // the shared `tasks` topic.
    act(() =>
      callbackFor("tasks")({
        eventType: "UPDATE",
        schema: "public",
        table: "tasks",
        new: { id: "t-other", title: "Someone else's task", status: "done" },
        old: { id: "t-other", title: "Someone else's task", status: "todo" },
      }),
    );

    expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByText("Second reminder (arrived live)")).not.toBeInTheDocument();
  });

  it("AS-018: a tasks DELETE for a task never tracked by this session is NOT propagated", () => {
    render(<Harness />);

    act(() =>
      callbackFor("tasks")({
        eventType: "DELETE",
        schema: "public",
        table: "tasks",
        new: {},
        old: { id: "t-other" },
      }),
    );

    expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByText("Second reminder (arrived live)")).not.toBeInTheDocument();
  });
});
