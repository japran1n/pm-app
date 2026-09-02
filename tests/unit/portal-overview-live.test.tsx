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
});

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({})),
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
import type { PortalOverview } from "@/lib/queries/portal";

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

function renderLive(overview: PortalOverview = baseOverview) {
  return render(
    createElement(PortalOverviewLive, {
      workspaceId: "ws-1",
      workspaceSlug: "acme",
      initialOverview: overview,
    }),
  );
}

describe("PortalOverviewLive", () => {
  it("test_AS_018_task_leaving_pending_approval_leaves_waiting_on_you", () => {
    renderLive();

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

  it("test_AS_019_task_becoming_pending_approval_and_client_visible_appears_in_waiting_on_you", () => {
    renderLive({ waitingOnYou: [], deliveredThisWeek: [] });

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

  it("test_AS_020_row_failing_client_visible_predicate_is_never_rendered", () => {
    renderLive({ waitingOnYou: [], deliveredThisWeek: [] });

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

  it("test_AS_020_row_that_was_visible_and_becomes_invisible_is_removed", () => {
    renderLive();

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

  it("test_AS_024_subscription_is_torn_down_on_unmount", () => {
    const { unmount } = renderLive();

    expect(unsubscribeSpy).not.toHaveBeenCalled();

    unmount();

    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
  });
});
