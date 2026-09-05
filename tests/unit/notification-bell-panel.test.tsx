// @vitest-environment jsdom
//
// F208 (AS-379, AS-385, AS-386, AS-387): the notification bell + panel.

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const markNotificationReadMock = vi.fn();
const markAllNotificationsReadMock = vi.fn();
const getNotificationSnapshotMock = vi.fn();
const toastErrorMock = vi.fn();
const toastCallMock = vi.fn();

vi.mock("@/lib/actions/notifications", () => ({
  markNotificationRead: (...args: unknown[]) => markNotificationReadMock(...args),
  markAllNotificationsRead: (...args: unknown[]) => markAllNotificationsReadMock(...args),
  getNotificationSnapshot: (...args: unknown[]) => getNotificationSnapshotMock(...args),
}));

// Faza D: NotificationBell now calls plain `toast(...)` (a chat DM/thread-
// reply/mention toast), not just `toast.error`/`toast.success` -- sonner's
// real export is a callable function with methods attached, so the mock
// needs the same shape or `toast(...)` throws "not a function".
vi.mock("sonner", () => ({
  toast: Object.assign(
    (...args: unknown[]) => toastCallMock(...args),
    {
      error: (...args: unknown[]) => toastErrorMock(...args),
      success: vi.fn(),
    },
  ),
}));

// Faza D: NotificationBell fetches sound preferences on mount via this
// Server Action -- mocked so the test never touches the real action's
// `cookies()`/Supabase call (unavailable outside a request scope in this
// jsdom test, same reason @/lib/actions/notifications is mocked above).
vi.mock("@/lib/actions/notification-preferences", () => ({
  getNotificationPreferences: vi.fn(async () => ({
    ok: true,
    data: {
      soundEnabled: true,
      soundVolume: 60,
      soundOnlyWhenUnfocused: true,
    },
  })),
}));

// Faza D: NotificationBell's chat toast plays a sound via the real Web
// Audio API, unavailable in jsdom -- mocked to a no-op.
vi.mock("@/lib/notifications/sound", () => ({
  playNotificationSound: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// F209 (AS-388): capture the onInsert callback NotificationBell registers
// with the realtime hook so tests can simulate a live Realtime insert
// without a real Supabase WebSocket — mirrors how the channel wiring
// itself is unit-tested in isolation in
// tests/unit/notifications-realtime-subscription.test.ts. The hook's own
// mount/unmount lifecycle glue is intentionally not re-tested here.
let capturedOnInsert: ((event: { workspaceId: string }) => void) | null =
  null;

vi.mock("@/components/notifications/use-notifications-realtime", () => ({
  useNotificationsRealtime: (
    _userId: string | null | undefined,
    onInsert: (event: { workspaceId: string }) => void,
  ) => {
    capturedOnInsert = onInsert;
  },
}));

import { NotificationBell } from "@/components/notifications/notification-bell";
import { NotificationPanel } from "@/components/notifications/notification-panel";
import type { NotificationListItem } from "@/lib/queries/notifications";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  capturedOnInsert = null;
});

const NOW = new Date();
const EARLIER = new Date(NOW.getTime() - 60_000);

const NEWEST: NotificationListItem = {
  id: "n-newest",
  kind: "task_assigned",
  createdAt: NOW.toISOString(),
  readAt: null,
  actor: { id: "u1", name: "Alice", email: "alice@example.com", avatarUrl: null },
  task: { id: "t1", key: "PM-1", title: "Newest task", projectId: "proj-1" },
};

const OLDER: NotificationListItem = {
  id: "n-older",
  kind: "comment_reply",
  createdAt: EARLIER.toISOString(),
  readAt: null,
  actor: { id: "u2", name: "Bob", email: "bob@example.com", avatarUrl: null },
  task: { id: "t2", key: "PM-2", title: "Older task", projectId: "proj-2" },
};

describe("NotificationBell (F208: AS-379)", () => {
  it("test_AS_379_bell_shows_the_unread_count", () => {
    render(
      createElement(NotificationBell, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        initialNotifications: [NEWEST, OLDER],
        initialUnreadCount: 5,
      }),
    );

    expect(
      screen.getByRole("button", { name: /notifications, 5 unread/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("test_AS_379_negative_no_badge_is_shown_when_the_unread_count_is_zero", () => {
    render(
      createElement(NotificationBell, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        initialNotifications: [],
        initialUnreadCount: 0,
      }),
    );

    expect(
      screen.getByRole("button", { name: "Notifications" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});

describe("NotificationPanel (F208: AS-385, AS-386, AS-387)", () => {
  it("test_AS_385_lists_notifications_newest_first_with_actor_action_and_task", () => {
    render(
      createElement(NotificationPanel, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        initialNotifications: [NEWEST, OLDER],
        initialUnreadCount: 2,
      }),
    );

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    // Newest first (caller-provided order, already newest-first per the
    // query's own `order("created_at", { ascending: false })`).
    expect(items[0].textContent).toContain("Alice");
    expect(items[0].textContent).toContain("PM-1");
    expect(items[0].textContent).toContain("Newest task");
    expect(items[1].textContent).toContain("Bob");
    expect(items[1].textContent).toContain("PM-2");
  });

  it("test_AS_385_negative_an_empty_notification_list_renders_the_empty_state_not_a_blank_area", () => {
    render(
      createElement(NotificationPanel, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        initialNotifications: [],
        initialUnreadCount: 0,
      }),
    );

    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(
      screen.getByText(/you.re all caught up\. no notifications yet\./i),
    ).toBeInTheDocument();
  });

  it("test_AS_386_clicking_an_unread_notification_marks_it_read_and_updates_the_unread_count", async () => {
    markNotificationReadMock.mockResolvedValue({ ok: true });
    const onUnreadCountChange = vi.fn();

    render(
      createElement(NotificationPanel, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        initialNotifications: [NEWEST],
        initialUnreadCount: 1,
        onUnreadCountChange,
      }),
    );

    fireEvent.click(screen.getByRole("link", { name: /Alice/i }));

    // Optimistic: unread count drops immediately.
    expect(onUnreadCountChange).toHaveBeenCalledWith(0);

    await waitFor(() =>
      expect(markNotificationReadMock).toHaveBeenCalledWith("n-newest"),
    );
  });

  it("test_AS_386_negative_a_failed_mark_read_reverts_the_optimistic_change_and_shows_a_toast", async () => {
    markNotificationReadMock.mockResolvedValue({
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    });
    const onUnreadCountChange = vi.fn();

    render(
      createElement(NotificationPanel, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        initialNotifications: [NEWEST],
        initialUnreadCount: 1,
        onUnreadCountChange,
      }),
    );

    fireEvent.click(screen.getByRole("link", { name: /Alice/i }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledTimes(1));
    // Reverted back to the original unread count (1) after the failure.
    expect(onUnreadCountChange).toHaveBeenLastCalledWith(1);
  });

  it("test_AS_387_mark_all_as_read_clears_the_unread_count", async () => {
    markAllNotificationsReadMock.mockResolvedValue({ ok: true });
    const onUnreadCountChange = vi.fn();

    render(
      createElement(NotificationPanel, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        initialNotifications: [NEWEST, OLDER],
        initialUnreadCount: 2,
        onUnreadCountChange,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /mark all as read/i }));

    expect(onUnreadCountChange).toHaveBeenCalledWith(0);
    await waitFor(() =>
      expect(markAllNotificationsReadMock).toHaveBeenCalledWith("w1"),
    );
  });

  it("test_AS_387_negative_a_failed_mark_all_reverts_the_unread_count_and_shows_a_toast", async () => {
    markAllNotificationsReadMock.mockResolvedValue({
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    });
    const onUnreadCountChange = vi.fn();

    render(
      createElement(NotificationPanel, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        initialNotifications: [NEWEST, OLDER],
        initialUnreadCount: 2,
        onUnreadCountChange,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /mark all as read/i }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledTimes(1));
    expect(onUnreadCountChange).toHaveBeenLastCalledWith(2);
  });

  it("test_AS_386_a_notification_with_a_resolvable_task_and_project_links_to_the_board_deep_link_not_search", () => {
    render(
      createElement(NotificationPanel, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        initialNotifications: [NEWEST],
        initialUnreadCount: 1,
      }),
    );

    const link = screen.getByRole("link", { name: /Alice/i });
    expect(link).toHaveAttribute(
      "href",
      "/w/acme/projects/proj-1/board?taskId=t1",
    );
  });

  it("test_AS_386_negative_a_notification_whose_task_project_id_is_unresolvable_falls_back_to_the_search_link", () => {
    const notificationWithoutProject: NotificationListItem = {
      ...NEWEST,
      task: { id: "t1", key: "PM-1", title: "Newest task", projectId: null },
    };

    render(
      createElement(NotificationPanel, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        initialNotifications: [notificationWithoutProject],
        initialUnreadCount: 1,
      }),
    );

    const link = screen.getByRole("link", { name: /Alice/i });
    expect(link).toHaveAttribute("href", "/w/acme/search?q=PM-1");
  });

  it("test_AS_374_a_notification_with_a_resolvable_comment_produces_a_link_carrying_commentId", () => {
    const notificationWithComment: NotificationListItem = {
      ...NEWEST,
      commentId: "comment-42",
    };

    render(
      createElement(NotificationPanel, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        initialNotifications: [notificationWithComment],
        initialUnreadCount: 1,
      }),
    );

    const link = screen.getByRole("link", { name: /Alice/i });
    expect(link).toHaveAttribute(
      "href",
      "/w/acme/projects/proj-1/board?taskId=t1&commentId=comment-42",
    );
  });

  it("test_AS_374_negative_a_notification_with_no_comment_omits_commentId_from_the_link", () => {
    render(
      createElement(NotificationPanel, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        initialNotifications: [NEWEST],
        initialUnreadCount: 1,
      }),
    );

    const link = screen.getByRole("link", { name: /Alice/i });
    expect(link).toHaveAttribute(
      "href",
      "/w/acme/projects/proj-1/board?taskId=t1",
    );
  });

  it("test_AS_387_the_mark_all_button_is_disabled_when_there_is_nothing_unread", () => {
    render(
      createElement(NotificationPanel, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        initialNotifications: [{ ...NEWEST, readAt: NOW.toISOString() }],
        initialUnreadCount: 0,
      }),
    );

    expect(
      screen.getByRole("button", { name: /mark all as read/i }),
    ).toBeDisabled();
    expect(markAllNotificationsReadMock).not.toHaveBeenCalled();
  });
});

describe("NotificationBell realtime reconciliation (F209: AS-388)", () => {
  it("test_AS_388_a_realtime_insert_for_the_active_workspace_reconciles_the_badge_from_the_server_snapshot", async () => {
    getNotificationSnapshotMock.mockResolvedValue({
      ok: true,
      list: [NEWEST, OLDER],
      unreadCount: 6,
    });

    render(
      createElement(NotificationBell, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        currentUserId: "u-current",
        initialNotifications: [OLDER],
        initialUnreadCount: 1,
      }),
    );

    // Starts at the server-fetched initial count.
    expect(
      screen.getByRole("button", { name: /notifications, 1 unread/i }),
    ).toBeInTheDocument();

    // Simulate a live Realtime INSERT for the active workspace — the bell
    // re-fetches the server-authoritative snapshot rather than blindly
    // incrementing a local counter.
    expect(capturedOnInsert).not.toBeNull();
    capturedOnInsert!({ workspaceId: "w1" });

    await waitFor(() => expect(getNotificationSnapshotMock).toHaveBeenCalledWith("w1"));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /notifications, 6 unread/i }),
      ).toBeInTheDocument(),
    );
  });

  it("test_AS_388_negative_a_realtime_insert_for_a_different_workspace_does_not_reconcile", async () => {
    render(
      createElement(NotificationBell, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        currentUserId: "u-current",
        initialNotifications: [OLDER],
        initialUnreadCount: 1,
      }),
    );

    expect(capturedOnInsert).not.toBeNull();
    capturedOnInsert!({ workspaceId: "some-other-workspace" });

    // Give any accidental async work a tick to run, then assert nothing
    // changed and no snapshot fetch happened for the wrong workspace.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getNotificationSnapshotMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /notifications, 1 unread/i }),
    ).toBeInTheDocument();
  });
});
