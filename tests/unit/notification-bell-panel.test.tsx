// @vitest-environment jsdom
//
// F208 (AS-379, AS-385, AS-386, AS-387): the notification bell + panel.

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const markNotificationReadMock = vi.fn();
const markAllNotificationsReadMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("@/lib/actions/notifications", () => ({
  markNotificationRead: (...args: unknown[]) => markNotificationReadMock(...args),
  markAllNotificationsRead: (...args: unknown[]) => markAllNotificationsReadMock(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: vi.fn(),
  },
}));

import { NotificationBell } from "@/components/notifications/notification-bell";
import { NotificationPanel } from "@/components/notifications/notification-panel";
import type { NotificationListItem } from "@/lib/queries/notifications";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const NOW = new Date();
const EARLIER = new Date(NOW.getTime() - 60_000);

const NEWEST: NotificationListItem = {
  id: "n-newest",
  kind: "task_assigned",
  createdAt: NOW.toISOString(),
  readAt: null,
  actor: { id: "u1", name: "Alice", email: "alice@example.com", avatarUrl: null },
  task: { id: "t1", key: "PM-1", title: "Newest task" },
};

const OLDER: NotificationListItem = {
  id: "n-older",
  kind: "comment_reply",
  createdAt: EARLIER.toISOString(),
  readAt: null,
  actor: { id: "u2", name: "Bob", email: "bob@example.com", avatarUrl: null },
  task: { id: "t2", key: "PM-2", title: "Older task" },
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
