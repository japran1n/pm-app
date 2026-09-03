// @vitest-environment jsdom
//
// F009 (AS-021, AS-022, AS-024): component-level proof that
// <PortalTaskList> is wired to a REAL Realtime subscription on `tasks` via
// `acquireSharedTopicChannel`, and that a genuine `postgres_changes`
// payload flowing through the mocked Supabase channel changes the rendered
// list without a page reload.
//
// Only `.channel()`/`.on()`/`.subscribe()`/`removeChannel` are mocked --
// `subscribeToPortalTaskListRealtime` itself is the real implementation, so
// deleting the subscription call, the `client_visible`/`deleted_at` gate,
// or the unmount teardown breaks these tests, not just the code.
//
// F023: the effect now routes through `subscribeWhenAuthenticated`
// (lib/realtime/subscribe-when-authenticated.ts), which awaits
// `auth.getSession()` + `realtime.setAuth()` before ever calling
// `.channel()`. The mock client below provides both (resolving
// immediately by default), and `flushAuthHydration()` drains that real
// microtask chain after render.

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { PortalTaskList } from "@/components/portal/task-list";
import type { PortalProject } from "@/lib/queries/portal";

type OnCall = {
  event: string;
  filter: { event: string; schema: string; table: string };
  callback: (payload: unknown) => void;
};

let onCalls: OnCall[] = [];
let channelCalls: string[] = [];
let removeChannelCalls: unknown[] = [];

function makeFakeSupabase() {
  const channelObject = {
    on: vi.fn(
      (event: string, filter: OnCall["filter"], callback: (payload: unknown) => void) => {
        onCalls.push({ event, filter, callback });
        return channelObject;
      },
    ),
    subscribe: vi.fn(() => channelObject),
  };

  return {
    channel: vi.fn((name: string) => {
      channelCalls.push(name);
      return channelObject;
    }),
    removeChannel: vi.fn((channel: unknown) => {
      removeChannelCalls.push(channel);
    }),
    auth: {
      getSession: vi.fn(() =>
        Promise.resolve({
          data: { session: { access_token: "test-access-token" } },
        }),
      ),
    },
    realtime: { setAuth: vi.fn(() => Promise.resolve()) },
  };
}

// Fresh mock client per test -- the shared-topic-channel registry is keyed
// per Supabase client instance and reuses an already-live channel for a
// topic without re-invoking `.on()`.
let currentSupabase = makeFakeSupabase();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => currentSupabase,
}));

function tasksCallback() {
  const match = onCalls.find((call) => call.filter.table === "tasks");
  if (!match) throw new Error('no .on() callback captured for table "tasks"');
  return match.callback;
}

// Drains the real `getSession().then(...).then(setAuth).then(subscribe)`
// microtask chain `subscribeWhenAuthenticated` runs before ever touching
// `.channel()`. Not a shortcut around that path -- the mocked promises
// above resolve for real, this just waits for them under `act`.
async function flushAuthHydration() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  cleanup();
  onCalls = [];
  channelCalls = [];
  removeChannelCalls = [];
  currentSupabase = makeFakeSupabase();
  vi.useRealTimers();
});

const project: PortalProject = {
  id: "project-1",
  name: "Website redesign",
  description: null,
  startDate: null,
  endDate: null,
  // F003 (missions/20260903-portal): PortalProject grew these three
  // fields for the portal topbar's launch chips (AS-005); null is a
  // real, common state (not yet set by the team), not a fixture gap.
  targetLaunchDate: null,
  launchConfidence: null,
  launchNote: null,
  tasks: [
    {
      id: "task-1",
      title: "Draft homepage copy",
      status: "In review",
      statusId: "status-1",
      dueDate: null,
      category: "in_progress",
    },
  ],
  notStarted: 0,
  inProgress: 1,
  done: 0,
  total: 1,
  percentComplete: 0,
  nextDue: null,
  overdueCount: 0,
  statuses: [
    { id: "status-1", name: "In review", category: "in_progress" },
    { id: "status-2", name: "Done", category: "done" },
  ],
};

describe("PortalTaskList (F009)", () => {
  it("test_AS_021_status_or_title_change_lands_live", async () => {
    render(<PortalTaskList project={project} workspaceSlug="acme" />);
    await flushAuthHydration();

    expect(screen.getByText("Draft homepage copy")).toBeInTheDocument();

    const callback = tasksCallback();
    act(() => {
      callback({
        eventType: "UPDATE",
        new: {
          id: "task-1",
          title: "Draft homepage copy v2",
          status: "In review",
          project_id: "project-1",
          client_visible: true,
          deleted_at: null,
        },
        old: {},
      });
    });

    expect(screen.getByText("Draft homepage copy v2")).toBeInTheDocument();
    expect(screen.queryByText("Draft homepage copy")).not.toBeInTheDocument();
  });

  it("test_AS_021_status_change_to_done_moves_row_and_updates_heading_live", async () => {
    render(<PortalTaskList project={project} workspaceSlug="acme" />);
    await flushAuthHydration();

    // Seeded status "In review" always renders "Waiting on your review"
    // (name-based override in clientStatusLabel), regardless of category.
    expect(screen.getByText(/Waiting on your review/i)).toBeInTheDocument();

    const callback = tasksCallback();
    act(() => {
      callback({
        eventType: "UPDATE",
        new: {
          id: "task-1",
          title: "Draft homepage copy",
          status: "Done",
          status_id: "status-2",
          project_id: "project-1",
          client_visible: true,
          deleted_at: null,
        },
        old: {},
      });
    });

    // A task whose status moves to a Done column must render under the
    // "Delivered" heading (category "done") -- not stay grouped under the
    // stale "Waiting on your review" heading -- without a reload. This
    // fails against `category: existing?.category ?? "not_started"`,
    // which pins the row to its seeded (in_progress) category forever, so
    // the heading would incorrectly stay "Waiting on your review".
    expect(screen.queryByText(/Waiting on your review/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Delivered/i)).toBeInTheDocument();
  });

  it("test_AS_022_delete_removes_the_row_live", async () => {
    render(<PortalTaskList project={project} workspaceSlug="acme" />);
    await flushAuthHydration();
    expect(screen.getByText("Draft homepage copy")).toBeInTheDocument();

    const callback = tasksCallback();
    act(() => {
      callback({
        eventType: "DELETE",
        new: {},
        old: { id: "task-1" },
      });
    });

    expect(screen.queryByText("Draft homepage copy")).not.toBeInTheDocument();
    // No tasks left -- empty state renders.
    expect(screen.getByText("Nothing shared yet")).toBeInTheDocument();
  });

  it("test_AS_022_client_visible_false_removes_the_row_live", async () => {
    render(<PortalTaskList project={project} workspaceSlug="acme" />);
    await flushAuthHydration();
    expect(screen.getByText("Draft homepage copy")).toBeInTheDocument();

    const callback = tasksCallback();
    act(() => {
      callback({
        eventType: "UPDATE",
        new: {
          id: "task-1",
          title: "Draft homepage copy",
          status: "In review",
          project_id: "project-1",
          client_visible: false,
          deleted_at: null,
        },
        old: {},
      });
    });

    expect(screen.queryByText("Draft homepage copy")).not.toBeInTheDocument();
    expect(screen.getByText("Nothing shared yet")).toBeInTheDocument();
  });

  it("test_AS_022_update_for_a_different_project_is_ignored", async () => {
    render(<PortalTaskList project={project} workspaceSlug="acme" />);
    await flushAuthHydration();
    const callback = tasksCallback();
    act(() => {
      callback({
        eventType: "INSERT",
        new: {
          id: "task-99",
          title: "Someone else's project task",
          status: "Todo",
          project_id: "project-other",
          client_visible: true,
          deleted_at: null,
        },
        old: {},
      });
    });

    expect(
      screen.queryByText("Someone else's project task"),
    ).not.toBeInTheDocument();
  });

  it("test_AS_024_channel_torn_down_on_unmount", async () => {
    vi.useFakeTimers();
    const { unmount } = render(
      <PortalTaskList project={project} workspaceSlug="acme" />,
    );
    await flushAuthHydration();

    expect(channelCalls).toContain("portal:project:project-1:tasks");

    unmount();
    // Teardown is deferred one macrotask by the shared-channel registry.
    act(() => {
      vi.runAllTimers();
    });

    expect(currentSupabase.removeChannel).toHaveBeenCalledTimes(1);
  });

  it("test_AS_024_no_channel_leak_across_remount", async () => {
    vi.useFakeTimers();
    const { unmount } = render(
      <PortalTaskList project={project} workspaceSlug="acme" />,
    );
    await flushAuthHydration();
    unmount();

    const { unmount: unmountTwo } = render(
      <PortalTaskList project={project} workspaceSlug="acme" />,
    );
    await flushAuthHydration();
    unmountTwo();

    act(() => {
      vi.runAllTimers();
    });

    // Both mounts shared the same channel (StrictMode-style remount
    // reuse) -- exactly one channel was ever created for this topic.
    expect(
      channelCalls.filter((name) => name === "portal:project:project-1:tasks")
        .length,
    ).toBe(1);
  });

  // F023: closes the regression scrutiny-2 found in F012's own fix -- an
  // unmount that happens BEFORE `getSession()` resolves must never let the
  // deferred `subscribe()` call run afterwards. Reverting the `cancelled`
  // guard in `lib/realtime/subscribe-when-authenticated.ts` makes this
  // fail (a channel gets created after the component is already gone).
  it("test_AS_024_unmount_before_session_resolves_never_subscribes", async () => {
    let resolveSession: (value: {
      data: { session: { access_token: string } | null };
    }) => void = () => {};
    currentSupabase.auth.getSession = vi.fn(
      () =>
        new Promise<{
          data: { session: { access_token: string } | null };
        }>((resolve) => {
          resolveSession = resolve;
        }),
    ) as typeof currentSupabase.auth.getSession;

    const { unmount } = render(
      <PortalTaskList project={project} workspaceSlug="acme" />,
    );

    // Unmount happens before `getSession()` ever resolves.
    unmount();

    resolveSession({ data: { session: { access_token: "late-token" } } });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(channelCalls).not.toContain("portal:project:project-1:tasks");
  });

  // F023: a rejected `getSession()` must not surface as an unhandled
  // promise rejection and must leave the mount with no live subscription,
  // not a silently-anonymous one.
  it("test_AS_024_rejected_getSession_does_not_throw_or_subscribe", async () => {
    currentSupabase.auth.getSession = vi.fn(() =>
      Promise.reject(new Error("network down")),
    ) as typeof currentSupabase.auth.getSession;

    render(<PortalTaskList project={project} workspaceSlug="acme" />);

    await flushAuthHydration();

    expect(channelCalls).not.toContain("portal:project:project-1:tasks");
  });
});
