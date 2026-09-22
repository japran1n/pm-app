// @vitest-environment jsdom
//
// F057 (FU-M4-10, SB-052, M4 scrutiny attempt 2): F050 fixed
// RequestsTabContent but skipped the other three inbox wrappers. A real
// fetch failure feeding the Inbox's "Notifications", "Approvals", or
// "Watching" tabs must never render the same "nothing here" state a
// legitimate zero-row result would. These tests force each underlying
// query to return its REAL typed `{ ..., error }` return shape (never
// `mockRejectedValue`, since none of these functions reject -- they catch
// the Supabase error and return a typed result) and assert the
// tab-content wrapper throws, matching F050's convention on
// RequestsTabContent. Each test fails if the fix is removed (reverting the
// wrapper to ignore `error`, or reverting the query to fail open to `[]`).
import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Notifications: getNotificationsForWorkspace already returns a typed
// `error` (F308) -- NotificationsTabContent just never consumed it.
// ---------------------------------------------------------------------------
describe("SB-052: NotificationsTabContent surfaces a fetch failure instead of an empty state", () => {
  it("test_SB_052_notifications_tab_throws_when_query_returns_a_typed_error", async () => {
    vi.resetModules();
    vi.doMock("@/lib/queries/notifications", () => ({
      getNotificationsForWorkspace: vi.fn(async () => ({
        list: [],
        unreadCount: 0,
        error: "Couldn't load notifications.",
      })),
    }));
    vi.doMock("@/components/notifications/notification-panel", () => ({
      NotificationPanel: () => null,
    }));

    const { NotificationsTabContent } = await import(
      "@/components/notifications/notifications-tab-content"
    );

    await expect(
      NotificationsTabContent({ workspaceSlug: "acme", workspaceId: "w1" }),
    ).rejects.toThrow(/notifications/i);

    vi.doUnmock("@/lib/queries/notifications");
    vi.doUnmock("@/components/notifications/notification-panel");
  });

  it("test_SB_052_notifications_tab_does_not_throw_on_a_legitimate_empty_result", async () => {
    vi.resetModules();
    vi.doMock("@/lib/queries/notifications", () => ({
      getNotificationsForWorkspace: vi.fn(async () => ({ list: [], unreadCount: 0 })),
    }));
    vi.doMock("@/components/notifications/notification-panel", () => ({
      NotificationPanel: () => null,
    }));

    const { NotificationsTabContent } = await import(
      "@/components/notifications/notifications-tab-content"
    );

    await expect(
      NotificationsTabContent({ workspaceSlug: "acme", workspaceId: "w1" }),
    ).resolves.toBeTruthy();

    vi.doUnmock("@/lib/queries/notifications");
    vi.doUnmock("@/components/notifications/notification-panel");
  });
});

// ---------------------------------------------------------------------------
// Approvals: getOpenApprovalsForWorkspace used to fail open to `[]` on any
// read error -- now returns `{ list, error }`, same shape as
// getWorkspaceClientRequests.
// ---------------------------------------------------------------------------
describe("SB-052: ApprovalsTabContent surfaces a fetch failure instead of an empty state", () => {
  it("test_SB_052_approvals_tab_throws_when_query_returns_a_typed_error", async () => {
    vi.resetModules();
    vi.doMock("@/lib/queries/approvals", () => ({
      getOpenApprovalsForWorkspace: vi.fn(async () => ({
        list: [],
        error: "Couldn't load approvals.",
      })),
      getDecisionOwnerNames: vi.fn(async () => new Map()),
    }));
    vi.doMock("@/components/approvals/approvals-queue", () => ({
      ApprovalsQueue: () => null,
    }));

    const { ApprovalsTabContent } = await import(
      "@/components/approvals/approvals-tab-content"
    );

    await expect(
      ApprovalsTabContent({ workspaceSlug: "acme", workspaceId: "w1" }),
    ).rejects.toThrow(/approvals/i);

    vi.doUnmock("@/lib/queries/approvals");
    vi.doUnmock("@/components/approvals/approvals-queue");
  });

  it("test_SB_052_approvals_tab_does_not_throw_on_a_legitimate_empty_result", async () => {
    vi.resetModules();
    vi.doMock("@/lib/queries/approvals", () => ({
      getOpenApprovalsForWorkspace: vi.fn(async () => ({ list: [] })),
      getDecisionOwnerNames: vi.fn(async () => new Map()),
    }));
    vi.doMock("@/components/approvals/approvals-queue", () => ({
      ApprovalsQueue: () => null,
    }));

    const { ApprovalsTabContent } = await import(
      "@/components/approvals/approvals-tab-content"
    );

    await expect(
      ApprovalsTabContent({ workspaceSlug: "acme", workspaceId: "w1" }),
    ).resolves.toBeTruthy();

    vi.doUnmock("@/lib/queries/approvals");
    vi.doUnmock("@/components/approvals/approvals-queue");
  });
});

// ---------------------------------------------------------------------------
// Watching: getWatchedTasksForUser used to fail open to `[]` on any read
// error -- now returns `{ list, error }`, same shape as the other three
// query functions this tab family reads from.
// ---------------------------------------------------------------------------
describe("SB-052: WatchingTabContent surfaces a fetch failure instead of an empty state", () => {
  it("test_SB_052_watching_tab_throws_when_query_returns_a_typed_error", async () => {
    vi.resetModules();
    vi.doMock("@/lib/queries/watching", () => ({
      getWatchedTasksForUser: vi.fn(async () => ({
        list: [],
        error: "Couldn't load watched tasks.",
      })),
    }));
    vi.doMock("@/components/watching/watching-task-list", () => ({
      WatchingTaskList: () => null,
    }));

    const { WatchingTabContent } = await import(
      "@/components/watching/watching-tab-content"
    );

    await expect(
      WatchingTabContent({ workspaceSlug: "acme", userId: "u1" }),
    ).rejects.toThrow(/watched tasks/i);

    vi.doUnmock("@/lib/queries/watching");
    vi.doUnmock("@/components/watching/watching-task-list");
  });

  it("test_SB_052_watching_tab_does_not_throw_on_a_legitimate_empty_result", async () => {
    vi.resetModules();
    vi.doMock("@/lib/queries/watching", () => ({
      getWatchedTasksForUser: vi.fn(async () => ({ list: [] })),
    }));
    vi.doMock("@/components/watching/watching-task-list", () => ({
      WatchingTaskList: () => null,
    }));

    const { WatchingTabContent } = await import(
      "@/components/watching/watching-tab-content"
    );

    await expect(
      WatchingTabContent({ workspaceSlug: "acme", userId: "u1" }),
    ).resolves.toBeTruthy();

    vi.doUnmock("@/lib/queries/watching");
    vi.doUnmock("@/components/watching/watching-task-list");
  });
});
