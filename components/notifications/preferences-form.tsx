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

import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  updateNotificationPreferences,
  type NotificationPreferences,
} from "@/lib/actions/notification-preferences";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

const EMAIL_NOTIFICATIONS_ENABLED = false;

type Field = keyof NotificationPreferences;

const KIND_ROWS: { label: string; description: string; inApp: Field; email: Field }[] = [
  {
    label: "Mentions",
    description: "Someone @mentions you in a comment or task description.",
    inApp: "mentionInApp",
    email: "mentionEmail",
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

  function toggle(field: Field, nextValue: boolean) {
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
            {EMAIL_NOTIFICATIONS_ENABLED ? (
              <Switch
                id={row.email}
                checked={current[row.email]}
                disabled={pendingField === row.email}
                onCheckedChange={(checked) => toggle(row.email, checked)}
                aria-label={`${row.label} email notifications`}
              />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
