"use client";

// Feature request: desktop/browser push notifications for @mentions and
// approval requests, "no real Web Push (service worker + VAPID) needed for
// this round, just foreground/in-tab Notification API" per this feature's
// own scope note. This module is the thin wrapper around the browser
// `Notification` global -- kept side-effect-light and independently
// testable (mocking `window.Notification`) rather than inlined into the
// bell component.
//
// Persistence: whether the user has opted in is a plain localStorage flag,
// not a server-persisted preference column -- the underlying, authoritative
// state is the browser's own `Notification.permission` (which the OS/browser
// already persists per-origin); this flag only remembers "did the user ask
// for this" so the toggle in preferences-form.tsx renders correctly across
// reloads without re-prompting for permission on every visit.
const STORAGE_KEY = "desktop-notifications-enabled";

function hasNotificationApi(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/** Whether this browser supports the Notification API at all (e.g. false
 * in most mobile browsers, some in-app webviews, and any non-DOM test
 * environment). */
export function isDesktopNotificationSupported(): boolean {
  return hasNotificationApi();
}

/** The browser's own permission state -- "default" (never asked),
 * "granted", or "denied". Never throws in an environment with no
 * Notification global. */
export function getDesktopNotificationPermission(): NotificationPermission | "unsupported" {
  if (!hasNotificationApi()) return "unsupported";
  return window.Notification.permission;
}

/** Whether the user has opted in via the preferences toggle. Independent
 * of the browser's own permission state -- a user can opt in here and
 * still have the browser prompt denied (or not yet asked), in which case
 * showDesktopNotification below simply no-ops. */
export function isDesktopNotificationsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    // Some environments (private browsing in a few older browsers) throw
    // on localStorage access -- treat as "not enabled" rather than crash.
    return false;
  }
}

function setDesktopNotificationsEnabledFlag(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // See isDesktopNotificationsEnabled's own comment.
  }
}

/**
 * Called from the preferences toggle's onCheckedChange. Turning it on
 * triggers the actual browser permission prompt (a no-op if already
 * granted/denied -- `requestPermission()` resolves immediately without
 * re-prompting in that case); turning it off just clears the local opt-in
 * flag, since there is no way to programmatically revoke a browser's
 * already-granted Notification permission.
 *
 * Returns the resulting permission state so the caller can reflect it
 * (e.g. show "blocked in your browser" if the user says yes here but the
 * browser itself denies it).
 */
export async function setDesktopNotificationsEnabled(
  enabled: boolean,
): Promise<NotificationPermission | "unsupported"> {
  if (!enabled) {
    setDesktopNotificationsEnabledFlag(false);
    return getDesktopNotificationPermission();
  }

  if (!hasNotificationApi()) {
    return "unsupported";
  }

  const permission = await window.Notification.requestPermission();
  setDesktopNotificationsEnabledFlag(permission === "granted");
  return permission;
}

/**
 * Shows a foreground browser notification if-and-only-if the user has
 * opted in (isDesktopNotificationsEnabled) AND the browser permission is
 * actually "granted". Silently no-ops otherwise -- callers (the
 * notification bell's realtime handler) don't need their own permission
 * branching, this is the single gate.
 */
export function showDesktopNotification(
  title: string,
  options?: { body?: string; icon?: string; onClick?: () => void },
): void {
  if (!hasNotificationApi()) return;
  if (!isDesktopNotificationsEnabled()) return;
  if (window.Notification.permission !== "granted") return;

  const notification = new window.Notification(title, {
    body: options?.body,
    icon: options?.icon,
  });

  if (options?.onClick) {
    notification.onclick = () => {
      window.focus();
      options.onClick?.();
      notification.close();
    };
  }
}
