// @vitest-environment jsdom
//
// F008 (AS-018, AS-019, AS-020, AS-024): component test for
// components/portal/portal-overview-live.tsx -- the live "Waiting on you"
// region on the client portal overview. Renders the real component
// (@testing-library/react + jsdom, per tests/unit/user-avatar.test.tsx's
// established pattern) with a mocked Supabase client and a mocked
// subscribe function so no live channel/network is involved (AS-034).
//
// Each test derives from the assertion text, not the implementation:
// AS-018/019 assert on what's IN the rendered "Waiting on you" list after
// a realtime event, AS-020 asserts a row that fails the visibility
// predicate is never rendered even though the raw event reaches the
// client, and AS-024 asserts the mocked unsubscribe function is called on
// unmount -- deleting the cleanup call in the component would fail that
// test regardless of any other change.

import { act, createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

afterEach(() => {
  cleanup();
  unsubscribeSpy.mockClear();
  capturedOnChange = undefined;
  getSessionMock = vi.fn(() =>
    Promise.resolve({
      data: { session: { access_token: "test-access-token" } },
    }),
  );
});

// F012/F023: usePortalOverviewRealtime (via the shared
// `subscribeWhenAuthenticated` helper) now awaits `auth.getSession()` and
// hands its token to `realtime.setAuth()` BEFORE subscribing (fixes
// AS-029's real-world unauthenticated-join race -- see that helper's own
// comment). The mocked client needs both, resolving immediately by
// default, so this component test's existing synchronous
// `capturedOnChange` assertions keep working without adding a real async
// wait to every test below. `getSessionMock` is reassignable per-test so
// the AS-024 regression tests below can exercise a pending/rejected
// session promise.
let getSessionMock: () => Promise<{
  data: { session: { access_token: string } | null };
}> = vi.fn(() =>
  Promise.resolve({
    data: { session: { access_token: "test-access-token" } },
  }),
);
vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({
    auth: {
      getSession: (...args: unknown[]) => getSessionMock(...(args as [])),
    },
    realtime: { setAuth: vi.fn(() => Promise.resolve()) },
  })),
}));

const unsubscribeSpy = vi.fn();
let capturedOnChange: ((event: unknown) => void) | undefined;

vi.mock("@/lib/portal/subscribe-portal-overview-realtime", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/portal/subscribe-portal-overview-realtime")
  >("@/lib/portal/subscribe-portal-overview-realtime");
  return {
    ...actual,
    subscribeToPortalOverviewRealtime: vi.fn(
      (_supabase: unknown, _workspaceId: string, onChange: (event: unknown) => void) => {
        capturedOnChange = onChange;
        return unsubscribeSpy;
      },
    ),
  };
});

import { PortalOverviewLive } from "@/components/portal/portal-overview-live";
import { subscribeToPortalOverviewRealtime } from "@/lib/portal/subscribe-portal-overview-realtime";
import type { PortalOverview } from "@/lib/queries/portal";

const subscribeMock = vi.mocked(subscribeToPortalOverviewRealtime);

afterEach(() => {
  subscribeMock.mockClear();
});

const baseOverview: PortalOverview = {
  waitingOnYou: [
    {
      id: "t1",
      title: "Review homepage copy",
      projectId: "p1",
      projectName: "Website relaunch",
      dueDate: null,
      updatedAt: "2026-08-30T00:00:00Z",
    },
  ],
  deliveredThisWeek: [],
};

async function renderLive(overview: PortalOverview = baseOverview) {
  const result = render(
    createElement(PortalOverviewLive, {
      workspaceId: "ws-1",
      workspaceSlug: "acme",
      initialOverview: overview,
    }),
  );
  // F012: the hook's effect now awaits `getSession()` then `setAuth()`
  // (both mocked to resolve immediately) before it actually subscribes --
  // flush those microtasks so `capturedOnChange`/`subscribeMock` are set
  // before each test interacts with them, same as the real browser does
  // once session hydration settles.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return result;
}

describe("PortalOverviewLive", () => {
  it("test_AS_004_waiting_on_you_link_points_at_the_relocated_project_scoped_task_detail_route", async () => {
    await renderLive();

    // F003b (missions/20260903-portal): task detail moved from
    // `/portal/<slug>/t/<taskId>` to `/portal/<slug>/p/<projectId>/t/<taskId>`.
    // This overview widget spans every project (each row carries its own
    // `projectId`), so the link must use that task's own project, not a
    // single project id threaded from above.
    const link = screen.getByRole("link", { name: /Review homepage copy/i });
    expect(link).toHaveAttribute("href", "/portal/acme/p/p1/t/t1");
  });

  it("test_AS_018_task_leaving_pending_approval_leaves_waiting_on_you", async () => {
    await renderLive();

    expect(screen.getByText("Review homepage copy")).toBeInTheDocument();

    act(() => {
      capturedOnChange?.({
      eventType: "UPDATE",
      schema: "public",
      table: "tasks",
      new: {
        id: "t1",
        title: "Review homepage copy",
        project_id: "p1",
        due_date: null,
        updated_at: "2026-09-01T00:00:00Z",
        pending_client_approval: false,
        client_visible: true,
        deleted_at: null,
      },
      old: { id: "t1" },
    });
    });

    expect(
      screen.queryByText("Review homepage copy"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Nothing waiting on you right now."),
    ).toBeInTheDocument();
  });

  it("test_AS_019_task_becoming_pending_approval_and_client_visible_appears_in_waiting_on_you", async () => {
    await renderLive({ waitingOnYou: [], deliveredThisWeek: [] });

    expect(
      screen.getByText("Nothing waiting on you right now."),
    ).toBeInTheDocument();

    act(() => {
      capturedOnChange?.({
      eventType: "UPDATE",
      schema: "public",
      table: "tasks",
      new: {
        id: "t2",
        title: "Approve new logo",
        project_id: "p1",
        due_date: null,
        updated_at: "2026-09-01T00:00:00Z",
        pending_client_approval: true,
        client_visible: true,
        deleted_at: null,
      },
      old: { id: "t2" },
    });
    });

    expect(screen.getByText("Approve new logo")).toBeInTheDocument();
  });

  it("test_AS_020_row_failing_client_visible_predicate_is_never_rendered", async () => {
    await renderLive({ waitingOnYou: [], deliveredThisWeek: [] });

    // Reaches the client as a raw event exactly as AS-020 describes, but
    // client_visible is false -- must never render, whether it's a brand
    // new INSERT or the first update this session sees for it.
    act(() => {
      capturedOnChange?.({
      eventType: "INSERT",
      schema: "public",
      table: "tasks",
      new: {
        id: "t3",
        title: "Internal-only task",
        project_id: "p1",
        due_date: null,
        updated_at: "2026-09-01T00:00:00Z",
        pending_client_approval: true,
        client_visible: false,
        deleted_at: null,
      },
      old: {},
    });
    });

    expect(screen.queryByText("Internal-only task")).not.toBeInTheDocument();
    expect(
      screen.getByText("Nothing waiting on you right now."),
    ).toBeInTheDocument();
  });

  it("test_AS_020_row_that_was_visible_and_becomes_invisible_is_removed", async () => {
    await renderLive();

    expect(screen.getByText("Review homepage copy")).toBeInTheDocument();

    act(() => {
      capturedOnChange?.({
      eventType: "UPDATE",
      schema: "public",
      table: "tasks",
      new: {
        id: "t1",
        title: "Review homepage copy",
        project_id: "p1",
        due_date: null,
        updated_at: "2026-09-01T00:00:00Z",
        pending_client_approval: true,
        client_visible: false,
        deleted_at: null,
      },
      old: { id: "t1" },
    });
    });

    expect(
      screen.queryByText("Review homepage copy"),
    ).not.toBeInTheDocument();
  });

  it("test_AS_024_subscription_is_torn_down_on_unmount", async () => {
    const { unmount } = await renderLive();

    expect(unsubscribeSpy).not.toHaveBeenCalled();

    unmount();

    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
  });

  it("test_AS_024_subscription_is_torn_down_and_reacquired_when_workspace_id_changes", async () => {
    const { rerender } = await renderLive();

    expect(subscribeMock).toHaveBeenCalledTimes(1);
    expect(subscribeMock.mock.calls[0]?.[1]).toBe("ws-1");
    expect(unsubscribeSpy).not.toHaveBeenCalled();

    // Same component instance, but the workspace it's scoped to changes
    // mid-life (e.g. the portal viewer navigates to a different client
    // workspace without a full page reload). The old channel must be
    // released and a new one acquired for the new workspaceId -- staying
    // subscribed to the old workspace's topic would leak stale updates
    // (or none at all) into the new workspace's view.
    rerender(
      createElement(PortalOverviewLive, {
        workspaceId: "ws-2",
        workspaceSlug: "acme",
        initialOverview: baseOverview,
      }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
    expect(subscribeMock).toHaveBeenCalledTimes(2);
    expect(subscribeMock.mock.calls[1]?.[1]).toBe("ws-2");
  });

  // F023: closes the regression scrutiny-2 found in F012's own fix -- an
  // unmount that happens BEFORE `getSession()` resolves must never let the
  // deferred `subscribe()` call run afterwards. Reverting the `cancelled`
  // guard in `lib/realtime/subscribe-when-authenticated.ts` makes this
  // fail (subscribeMock gets called after unmount).
  it("test_AS_024_unmount_before_session_resolves_never_subscribes", async () => {
    let resolveSession: (value: {
      data: { session: { access_token: string } | null };
    }) => void = () => {};
    getSessionMock = vi.fn(
      () =>
        new Promise<{
          data: { session: { access_token: string } | null };
        }>((resolve) => {
          resolveSession = resolve;
        }),
    );

    const { unmount } = render(
      createElement(PortalOverviewLive, {
        workspaceId: "ws-1",
        workspaceSlug: "acme",
        initialOverview: baseOverview,
      }),
    );

    // Unmount happens before `getSession()` ever resolves.
    unmount();

    resolveSession({ data: { session: { access_token: "late-token" } } });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(subscribeMock).not.toHaveBeenCalled();
  });

  // F023: a rejected `getSession()` must not surface as an unhandled
  // promise rejection and must leave the mount with no live subscription.
  it("test_AS_024_rejected_getSession_does_not_throw_or_subscribe", async () => {
    getSessionMock = vi.fn(() => Promise.reject(new Error("network down")));

    render(
      createElement(PortalOverviewLive, {
        workspaceId: "ws-1",
        workspaceSlug: "acme",
        initialOverview: baseOverview,
      }),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(subscribeMock).not.toHaveBeenCalled();
  });
});
