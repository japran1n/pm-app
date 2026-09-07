// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from "vitest";

// Feature request: desktop/browser notifications. Mocks the `Notification`
// global (jsdom doesn't implement it) to exercise the permission-request
// flow and the single show/no-show gate without a real browser.
import {
  getDesktopNotificationPermission,
  isDesktopNotificationSupported,
  isDesktopNotificationsEnabled,
  setDesktopNotificationsEnabled,
  showDesktopNotification,
} from "@/lib/notifications/browser-notify";

// jsdom in this repo's configuration has no window.localStorage (see
// tests/unit/palette-actions-recents.test.tsx's own comment for the same
// polyfill) -- a minimal in-memory implementation, scoped to this file.
if (typeof window !== "undefined" && !window.localStorage) {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => store.clear(),
    },
    configurable: true,
  });
}

class MockNotification {
  static permission: NotificationPermission = "default";
  static requestPermission = vi.fn(async (): Promise<NotificationPermission> => {
    return MockNotification.permission;
  });
  onclick: (() => void) | null = null;
  close = vi.fn();
  constructor(
    public title: string,
    public options?: NotificationOptions,
  ) {}
}

describe("browser-notify", () => {
  beforeEach(() => {
    window.localStorage.clear();
    MockNotification.permission = "default";
    MockNotification.requestPermission.mockClear();
    // @ts-expect-error -- test-only global assignment
    window.Notification = MockNotification;
  });

  it("reports supported when window.Notification exists", () => {
    expect(isDesktopNotificationSupported()).toBe(true);
  });

  it("reports unsupported when window.Notification is absent", () => {
    // @ts-expect-error -- test-only global deletion
    delete window.Notification;
    expect(isDesktopNotificationSupported()).toBe(false);
    expect(getDesktopNotificationPermission()).toBe("unsupported");
  });

  it("enabling requests permission and persists the opt-in flag on grant", async () => {
    MockNotification.permission = "granted";
    const result = await setDesktopNotificationsEnabled(true);

    expect(MockNotification.requestPermission).toHaveBeenCalledTimes(1);
    expect(result).toBe("granted");
    expect(isDesktopNotificationsEnabled()).toBe(true);
  });

  it("enabling does not persist opt-in when the browser denies permission", async () => {
    MockNotification.permission = "denied";
    const result = await setDesktopNotificationsEnabled(true);

    expect(result).toBe("denied");
    expect(isDesktopNotificationsEnabled()).toBe(false);
  });

  it("disabling clears the opt-in flag without prompting", async () => {
    MockNotification.permission = "granted";
    await setDesktopNotificationsEnabled(true);
    expect(isDesktopNotificationsEnabled()).toBe(true);

    MockNotification.requestPermission.mockClear();
    await setDesktopNotificationsEnabled(false);

    expect(MockNotification.requestPermission).not.toHaveBeenCalled();
    expect(isDesktopNotificationsEnabled()).toBe(false);
  });

  it("showDesktopNotification does nothing when the user hasn't opted in", () => {
    MockNotification.permission = "granted";
    const spy = vi.spyOn(window, "Notification" as never);
    showDesktopNotification("Title");
    expect(spy).not.toHaveBeenCalled();
  });

  it("showDesktopNotification does nothing when permission isn't granted, even if opted in", async () => {
    MockNotification.permission = "granted";
    await setDesktopNotificationsEnabled(true);
    MockNotification.permission = "denied";

    const spy = vi.spyOn(window, "Notification" as never);
    showDesktopNotification("Title");
    expect(spy).not.toHaveBeenCalled();
  });

  it("showDesktopNotification fires a Notification when opted in and permission granted", async () => {
    MockNotification.permission = "granted";
    await setDesktopNotificationsEnabled(true);

    const spy = vi.spyOn(window, "Notification" as never);
    showDesktopNotification("A mention", { body: "Someone mentioned you" });
    expect(spy).toHaveBeenCalledWith("A mention", expect.objectContaining({ body: "Someone mentioned you" }));
  });
});
