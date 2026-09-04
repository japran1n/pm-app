// @vitest-environment jsdom
//
// F009 (AS-023, AS-024): component-level proof that <RequestList> is wired
// to a REAL Realtime subscription on `client_requests` via
// `acquireSharedTopicChannel`, and that a genuine `postgres_changes`
// payload flowing through the mocked Supabase channel changes the
// rendered list without a page reload.
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

import { RequestList } from "@/components/portal/request-list";
import type { PortalRequest } from "@/lib/queries/portal";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/actions/client-requests", () => ({
  withdrawClientRequest: vi.fn(async () => ({ ok: true, data: {} })),
}));

type OnCall = {
  event: string;
  filter: { event: string; schema: string; table: string };
  callback: (payload: unknown) => void;
};

let onCalls: OnCall[] = [];
let channelCalls: string[] = [];

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
    removeChannel: vi.fn(),
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

let currentSupabase = makeFakeSupabase();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => currentSupabase,
}));

function requestsCallback() {
  const match = onCalls.find((call) => call.filter.table === "client_requests");
  if (!match) {
    throw new Error('no .on() callback captured for table "client_requests"');
  }
  return match.callback;
}

// Drains the real `getSession().then(...).then(setAuth).then(subscribe)`
// microtask chain `subscribeWhenAuthenticated` runs before ever touching
// `.channel()`.
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
  currentSupabase = makeFakeSupabase();
  vi.useRealTimers();
});

const seedRequest: PortalRequest = {
  id: "req-1",
  projectId: "project-1",
  projectName: "Website redesign",
  title: "Add a pricing page",
  body: null,
  desiredBy: null,
  status: "submitted",
  declineReason: null,
  convertedTaskId: null,
  convertedTaskTitle: null,
  convertedTaskStatus: null,
  createdAt: "2026-09-01T00:00:00.000Z",
};

describe("RequestList (F009)", () => {
  it("test_AS_023_insert_lands_live", async () => {
    render(<RequestList requests={[]} />);
    await flushAuthHydration();

    expect(screen.getByText("No requests yet")).toBeInTheDocument();

    const callback = requestsCallback();
    act(() => {
      callback({
        eventType: "INSERT",
        new: {
          id: "req-2",
          project_id: "project-1",
          title: "New live request",
          body: null,
          desired_by: null,
          status: "submitted",
          decline_reason: null,
          converted_task_id: null,
          created_at: "2026-09-02T00:00:00.000Z",
        },
        old: {},
      });
    });

    expect(screen.getByText("New live request")).toBeInTheDocument();
  });

  // F079 (missions/20260903-portal audit, defect 2): the Realtime channel
  // itself has no server-side row filter (see RequestList's own
  // `projectId` prop comment) — a live insert for a DIFFERENT project of
  // the same workspace must never reach the rendered list once this page
  // is project-scoped, even though the initial `requests` prop already
  // was.
  it("test_projectId_scoping_a_live_insert_for_a_different_project_is_dropped", async () => {
    render(<RequestList requests={[]} projectId="project-1" />);
    await flushAuthHydration();

    expect(screen.getByText("No requests yet")).toBeInTheDocument();

    const callback = requestsCallback();
    act(() => {
      callback({
        eventType: "INSERT",
        new: {
          id: "req-other-project",
          project_id: "project-2",
          title: "A different project's request",
          body: null,
          desired_by: null,
          status: "submitted",
          decline_reason: null,
          converted_task_id: null,
          created_at: "2026-09-02T00:00:00.000Z",
        },
        old: {},
      });
    });

    expect(screen.queryByText("A different project's request")).not.toBeInTheDocument();
    expect(screen.getByText("No requests yet")).toBeInTheDocument();
  });

  it("test_projectId_scoping_a_live_insert_for_the_current_project_still_lands", async () => {
    render(<RequestList requests={[]} projectId="project-1" />);
    await flushAuthHydration();

    const callback = requestsCallback();
    act(() => {
      callback({
        eventType: "INSERT",
        new: {
          id: "req-same-project",
          project_id: "project-1",
          title: "Same project request",
          body: null,
          desired_by: null,
          status: "submitted",
          decline_reason: null,
          converted_task_id: null,
          created_at: "2026-09-02T00:00:00.000Z",
        },
        old: {},
      });
    });

    expect(screen.getByText("Same project request")).toBeInTheDocument();
  });

  it("test_AS_023_status_change_lands_live", async () => {
    render(<RequestList requests={[seedRequest]} />);
    await flushAuthHydration();

    expect(screen.getByText("Waiting for review")).toBeInTheDocument();

    const callback = requestsCallback();
    act(() => {
      callback({
        eventType: "UPDATE",
        new: {
          id: "req-1",
          project_id: "project-1",
          title: "Add a pricing page",
          body: null,
          desired_by: null,
          status: "accepted",
          decline_reason: null,
          converted_task_id: null,
          created_at: "2026-09-01T00:00:00.000Z",
        },
        old: {},
      });
    });

    expect(screen.getByText("Accepted")).toBeInTheDocument();
    expect(screen.queryByText("Waiting for review")).not.toBeInTheDocument();
  });

  it("test_AS_024_channel_torn_down_on_unmount", async () => {
    vi.useFakeTimers();
    const { unmount } = render(<RequestList requests={[seedRequest]} />);
    await flushAuthHydration();

    expect(channelCalls).toContain("portal:client-requests");

    unmount();
    act(() => {
      vi.runAllTimers();
    });

    expect(currentSupabase.removeChannel).toHaveBeenCalledTimes(1);
  });

  // F023: closes the regression scrutiny-2 found in F012's fix on the
  // sibling overview hook -- an unmount before `getSession()` resolves
  // must never let the deferred `subscribe()` call run afterwards.
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

    const { unmount } = render(<RequestList requests={[seedRequest]} />);

    unmount();

    resolveSession({ data: { session: { access_token: "late-token" } } });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(channelCalls).not.toContain("portal:client-requests");
  });

  // F023: a rejected `getSession()` must not surface as an unhandled
  // promise rejection and must leave the mount with no live subscription.
  it("test_AS_024_rejected_getSession_does_not_throw_or_subscribe", async () => {
    currentSupabase.auth.getSession = vi.fn(() =>
      Promise.reject(new Error("network down")),
    ) as typeof currentSupabase.auth.getSession;

    render(<RequestList requests={[seedRequest]} />);

    await flushAuthHydration();

    expect(channelCalls).not.toContain("portal:client-requests");
  });
});
