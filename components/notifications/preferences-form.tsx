"use client";

// F211 (AS-391, AS-396): the notification preferences settings form.
// Smallest possible client boundary (clarified spec's default pattern):
// the profile settings page above is a Server Component that loads the
// current row via getNotificationPreferences; this owns only the
// interaction — a grid of per-kind in-app/email switches plus the
// email_enabled master kill switch.
//
// Failure handling (clarified spec, Q5): each toggle applies
// optimistically, then reverts to the last-saved value and shows a sonner
// toast stating what failed in plain language on a server rejection —
// same pattern as components/profile/profile-form.tsx.
//
// F307 (AS-391 follow-up, FU-10 from M15 scrutiny): the email column and
// the `email_enabled` master switch are hidden behind
// EMAIL_NOTIFICATIONS_ENABLED below. F213-F217 (the email-sending chain)
// are [SKIPPED] in this mission — no email sender exists, so no code
// anywhere reads the `*_email` columns or `email_enabled`. Per the
// scrutiny report's explicit recommendation, shipping controls that
// silently do nothing (a user unchecks "Mentions -> Email", gets a
// success toast, and the value is persisted but never consulted) is
// worse than not shipping them. The underlying schema columns and any
// already-persisted values are untouched — this only hides the UI
// surface. To re-enable once F213-F217 land and an email sender actually
// reads these columns: flip EMAIL_NOTIFICATIONS_ENABLED to true below.
// That one-line flip is sufficient — the email Switch controls, the
// KIND_ROWS.email wiring, and the "In-app / Email" grid header already
// exist below and only need the flag, not a UI rebuild.

import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import { toast } from "sonner";
import { Volume2 } from "lucide-react";

import {
  updateNotificationPreferences,
  type NotificationPreferences,
} from "@/lib/actions/notification-preferences";
import { playNotificationSound } from "@/lib/notifications/sound";
import {
  getDesktopNotificationPermission,
  isDesktopNotificationSupported,
  isDesktopNotificationsEnabled,
  setDesktopNotificationsEnabled,
} from "@/lib/notifications/browser-notify";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const EMAIL_NOTIFICATIONS_ENABLED = false;

type Field = keyof NotificationPreferences;
// Faza D: every KIND_ROWS toggle is a plain on/off switch -- soundVolume
// (the one non-boolean field on NotificationPreferences) is excluded so
// `current[row.inApp]` below type-checks as `boolean`, not `boolean |
// number`, without every call site needing its own cast.
type BooleanField = Exclude<Field, "soundVolume">;

// Faza D (docs/chat-slack-parity-plan.md): chat_dm/chat_thread_reply have
// no email column at all (in-app only, see the validation schema's own
// comment on why) -- `email` is optional here rather than every row
// requiring one, and the email Switch below simply doesn't render for a
// row that omits it (moot today either way since EMAIL_NOTIFICATIONS_ENABLED
// is false, but correct if that flag is ever flipped before these two
// kinds grow an email column of their own).
const KIND_ROWS: { label: string; description: string; inApp: BooleanField; email?: BooleanField }[] = [
  {
    label: "Mentions",
    description: "Someone @mentions you in a comment, task description, or chat message.",
    inApp: "mentionInApp",
    email: "mentionEmail",
  },
  {
    label: "Direct messages",
    description: "Someone sends you a direct message.",
    inApp: "chatDmInApp",
  },
  {
    label: "Thread replies",
    description: "Someone replies in a chat thread you're part of.",
    inApp: "chatThreadReplyInApp",
  },
  {
    label: "Assignments",
    description: "A task is assigned to you.",
    inApp: "taskAssignedInApp",
    email: "taskAssignedEmail",
  },
  {
    label: "Comment replies",
    description: "A new comment is posted on a task you're watching.",
    inApp: "commentReplyInApp",
    email: "commentReplyEmail",
  },
  {
    label: "Watched task updates",
    description: "The status changes on a task you're watching.",
    inApp: "watcherUpdateInApp",
    email: "watcherUpdateEmail",
  },
  {
    label: "Due soon",
    description: "A task you're assigned to is approaching its due date.",
    inApp: "taskDueSoonInApp",
    email: "taskDueSoonEmail",
  },
];

export function NotificationPreferencesForm({
  initialPreferences,
}: {
  initialPreferences: NotificationPreferences;
}) {
  const [saved, setSaved] = useState(initialPreferences);
  const [current, setCurrent] = useState(initialPreferences);
  const [, startTransition] = useTransition();
  const [pendingField, setPendingField] = useState<Field | null>(null);
  // Faza D: the volume range input fires continuously while dragging --
  // tracked separately from `current.soundVolume` so the slider handle
  // moves smoothly on every input event while the actual save is
  // debounced (see changeVolume below), rather than one Server Action
  // call per pixel of drag.
  const [volumeDraft, setVolumeDraft] = useState(initialPreferences.soundVolume);
  const volumeSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Feature request: desktop/browser notifications toggle. Local-only
  // state (see lib/notifications/browser-notify.ts's own doc comment for
  // why this isn't a server-persisted column).
  //
  // F274 follow-up: this used to read `isDesktopNotificationSupported()`
  // etc. via lazy `useState(() => ...)` initializers. Those getters branch
  // on `typeof window !== "undefined"`, which is exactly the SSR/client
  // branch React's hydration-mismatch warning calls out by name: this
  // component is SSR'd (server: window is undefined -> desktopSupported
  // false, the whole "Enable desktop notifications" block renders absent
  // from the server HTML), then hydrates in a real browser where the same
  // initializer now runs with `window` defined and returns true --
  // conjuring the entire block into existence only on the client. React
  // detects the server/client markup mismatch, throws an uncaught
  // "Hydration failed" error in the browser, and discards + resynthesizes
  // this Suspense boundary's whole subtree client-side-only to recover.
  // That teardown/remount race is what made the avatar upload input's
  // change handler intermittently miss the file Playwright had just set
  // (AS-205) -- a real bug, not a copy-drift issue in the test.
  //
  // Fix: `useSyncExternalStore` is the pattern React itself documents for
  // exactly this "value differs between server and client, and isn't
  // owned by React state" case -- its `getServerSnapshot` argument renders
  // the deterministic SSR-safe default (matching what the server actually
  // sent down), and its `getSnapshot` argument supplies the real browser
  // value once mounted, with React handling the "re-read after hydration"
  // step itself. This is the one of the three browser reads that actually
  // changes *markup structure* (the whole "Enable desktop notifications"
  // block is conditionally rendered on it) -- the only one capable of
  // producing the "Hydration failed" uncaught error seen above, as opposed
  // to a same-structure attribute mismatch (which React reconciles as a
  // patch, not a subtree teardown).
  const desktopSupported = useSyncExternalStore(
    () => () => {},
    isDesktopNotificationSupported,
    () => false,
  );
  // These two only ever affect attribute-level state (a switch's `checked`
  // prop, some copy) on a block that's otherwise identical between server
  // and client -- a plain lazy initializer is fine here (no full-subtree
  // hydration failure is possible from an attribute diff), and keeps the
  // update-on-toggle code below simple.
  const [desktopEnabled, setDesktopEnabledState] = useState(() =>
    isDesktopNotificationsEnabled(),
  );
  const [desktopPermission, setDesktopPermission] = useState<
    NotificationPermission | "unsupported"
  >(() => getDesktopNotificationPermission());

  async function toggleDesktopNotifications(nextValue: boolean) {
    setDesktopEnabledState(nextValue);
    const permission = await setDesktopNotificationsEnabled(nextValue);
    setDesktopPermission(permission);
    if (nextValue && permission !== "granted") {
      // The browser itself denied (or the user dismissed) the prompt --
      // reflect that back on the switch rather than showing it "on" for a
      // feature that will never actually fire.
      setDesktopEnabledState(false);
      if (permission === "denied") {
        toast.error(
          "Desktop notifications are blocked in your browser. Enable them in your browser's site settings.",
        );
      }
    }
  }

  function toggle(field: BooleanField, nextValue: boolean) {
    setCurrent((prev) => ({ ...prev, [field]: nextValue }));
    setPendingField(field);

    startTransition(async () => {
      const result = await updateNotificationPreferences({
        [field]: nextValue,
      });

      if (result.ok) {
        setSaved(result.data);
        setCurrent(result.data);
        toast.success("Notification preferences updated.");
      } else {
        // The optimistic toggle reverts to the last-saved value (not
        // simply "whatever it was a moment ago", which could itself be a
        // stale unsaved value if a previous toggle on the same field
        // hadn't resolved yet) and the control returns to an actionable
        // state.
        setCurrent((prev) => ({ ...prev, [field]: saved[field] }));
        toast.error(result.error);
      }
      setPendingField(null);
    });
  }

  // Faza D: debounced save (300ms after the last drag movement) so
  // dragging the slider doesn't fire a Server Action per pixel -- the
  // draft value is what's actually displayed/played, `current.soundVolume`
  // only updates once the save lands.
  function changeVolume(nextValue: number) {
    setVolumeDraft(nextValue);
    if (volumeSaveTimerRef.current) clearTimeout(volumeSaveTimerRef.current);
    volumeSaveTimerRef.current = setTimeout(() => {
      startTransition(async () => {
        const result = await updateNotificationPreferences({
          soundVolume: nextValue,
        });
        if (result.ok) {
          setSaved(result.data);
          setCurrent(result.data);
        } else {
          setVolumeDraft(saved.soundVolume);
          toast.error(result.error);
        }
      });
    }, 300);
  }

  const gridColsClassName = EMAIL_NOTIFICATIONS_ENABLED
    ? "grid-cols-[1fr_auto_auto]"
    : "grid-cols-[1fr_auto]";

  return (
    <div className="flex flex-col gap-6">
      {EMAIL_NOTIFICATIONS_ENABLED ? (
        <div className="flex items-center justify-between gap-4 rounded-md border p-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="email-enabled">Email notifications</Label>
            <p className="text-sm text-muted-foreground">
              Turn this off to stop all email notifications, regardless of
              the per-type settings below.
            </p>
          </div>
          <Switch
            id="email-enabled"
            checked={current.emailEnabled}
            disabled={pendingField === "emailEnabled"}
            onCheckedChange={(checked) => toggle("emailEnabled", checked)}
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-4">
        <div
          className={`grid ${gridColsClassName} items-center gap-x-6 gap-y-1 text-sm font-medium text-muted-foreground`}
        >
          <span />
          <span className="text-center">In-app</span>
          {EMAIL_NOTIFICATIONS_ENABLED ? (
            <span className="text-center">Email</span>
          ) : null}
        </div>

        {KIND_ROWS.map((row) => (
          <div
            key={row.inApp}
            className={`grid ${gridColsClassName} items-center gap-x-6 border-t pt-4 first:border-t-0 first:pt-0`}
          >
            <div className="flex flex-col gap-1">
              <Label htmlFor={row.inApp}>{row.label}</Label>
              <p className="text-sm text-muted-foreground">
                {row.description}
              </p>
            </div>
            <Switch
              id={row.inApp}
              checked={current[row.inApp]}
              disabled={pendingField === row.inApp}
              onCheckedChange={(checked) => toggle(row.inApp, checked)}
              aria-label={`${row.label} in-app notifications`}
            />
            {EMAIL_NOTIFICATIONS_ENABLED && row.email ? (
              <Switch
                id={row.email}
                checked={current[row.email]}
                disabled={pendingField === row.email}
                onCheckedChange={(checked) => toggle(row.email!, checked)}
                aria-label={`${row.label} email notifications`}
              />
            ) : EMAIL_NOTIFICATIONS_ENABLED ? (
              // A row with no email column at all (chat_dm/chat_thread_reply)
              // still needs an empty cell so the grid's three columns stay
              // aligned with every other row.
              <span />
            ) : null}
          </div>
        ))}
      </div>

      {desktopSupported ? (
        <div className="flex items-center justify-between gap-4 rounded-md border p-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="desktop-notifications-enabled">
              Enable desktop notifications
            </Label>
            <p className="text-sm text-muted-foreground">
              Show a browser notification for @mentions and approval
              requests while this tab is open in the background.
              {desktopPermission === "denied"
                ? " Currently blocked in your browser's site settings."
                : null}
            </p>
          </div>
          <Switch
            id="desktop-notifications-enabled"
            checked={desktopEnabled}
            onCheckedChange={(checked) => void toggleDesktopNotifications(checked)}
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-4 rounded-md border p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="sound-enabled">Notification sound</Label>
            <p className="text-sm text-muted-foreground">
              Play a short sound for direct messages, thread replies, and
              mentions.
            </p>
          </div>
          <Switch
            id="sound-enabled"
            checked={current.soundEnabled}
            disabled={pendingField === "soundEnabled"}
            onCheckedChange={(checked) => toggle("soundEnabled", checked)}
          />
        </div>

        <div className="flex items-center gap-3">
          <Volume2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={volumeDraft}
            disabled={!current.soundEnabled}
            onChange={(e) => changeVolume(Number(e.target.value))}
            aria-label="Notification sound volume"
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-primary disabled:cursor-not-allowed disabled:opacity-50"
          />
          <span className="w-9 shrink-0 text-right text-sm text-muted-foreground tabular-nums">
            {volumeDraft}%
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!current.soundEnabled}
            onClick={() => playNotificationSound(volumeDraft)}
          >
            Test
          </Button>
        </div>

        <div className="flex items-center justify-between gap-4 border-t pt-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="sound-only-unfocused">
              Only play when this tab isn&apos;t focused
            </Label>
            <p className="text-sm text-muted-foreground">
              Off means it also plays for messages you&apos;re already looking
              at.
            </p>
          </div>
          <Switch
            id="sound-only-unfocused"
            checked={current.soundOnlyWhenUnfocused}
            disabled={pendingField === "soundOnlyWhenUnfocused" || !current.soundEnabled}
            onCheckedChange={(checked) => toggle("soundOnlyWhenUnfocused", checked)}
          />
        </div>
      </div>
    </div>
  );
}
