// @vitest-environment jsdom
//
// F009 (AS-023, AS-024): component-level proof that <RequestList> is wired
// to a REAL Realtime subscription on `client_requests` via
// `acquireSharedTopicChannel`, and that a genuine `postgres_changes`
// payload flowing through the mocked Supabase channel changes the
// rendered list without a page reload.

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
  it("test_AS_023_insert_lands_live", () => {
    render(<RequestList requests={[]} />);

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

  it("test_AS_023_status_change_lands_live", () => {
    render(<RequestList requests={[seedRequest]} />);

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

  it("test_AS_024_channel_torn_down_on_unmount", () => {
    vi.useFakeTimers();
    const { unmount } = render(<RequestList requests={[seedRequest]} />);

    expect(channelCalls).toContain("portal:client-requests");

    unmount();
    act(() => {
      vi.runAllTimers();
    });

    expect(currentSupabase.removeChannel).toHaveBeenCalledTimes(1);
  });
});
