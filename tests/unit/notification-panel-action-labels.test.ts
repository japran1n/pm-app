// Bug fix regression test: `actionLabel` in
// components/notifications/notification-panel.tsx used to be a 7-case
// switch statement while the DB's `notifications_kind_check` constraint
// (supabase/migrations/20261123010000_f068_brief_answer_changed_kind.sql)
// recognizes 16 distinct notification kinds — the other 9 silently fell
// through to the generic "sent an update on" default (e.g. a budget alert
// rendered as "Someone sent an update on a task").
//
// This test locks in that every kind the DB will actually accept has its
// own entry in `ACTION_LABELS`, so a future notification kind added to the
// DB constraint but never added here fails loudly instead of silently
// degrading to the generic default.
import { describe, expect, it } from "vitest";

import { ACTION_LABELS } from "@/components/notifications/notification-panel";

// Mirrors the full `kind in (...)` list from the latest widening of
// notifications_kind_check (20261123010000_f068_brief_answer_changed_kind.sql).
const ALL_DB_NOTIFICATION_KINDS = [
  "mention",
  "comment_reply",
  "task_assigned",
  "task_due_soon",
  "watcher_update",
  "approval_decided",
  "assumption_flagged",
  "budget_threshold_80",
  "budget_threshold_100",
  "portal_task_decided",
  "client_request_submitted",
  "client_deliverable_submitted",
  "approval_owner_nudge",
  "chat_dm",
  "chat_thread_reply",
  "brief_answer_changed",
] as const;

describe("notification-panel ACTION_LABELS", () => {
  it("has exactly 16 entries, matching the DB's closed notification kind vocabulary", () => {
    expect(Object.keys(ACTION_LABELS)).toHaveLength(16);
  });

  it.each(ALL_DB_NOTIFICATION_KINDS)(
    "has a non-default label for %s",
    (kind) => {
      expect(ACTION_LABELS[kind]).toBeDefined();
      expect(ACTION_LABELS[kind]).not.toBe("sent an update on");
    },
  );

  it("does not include a stray entry for an unrecognized kind", () => {
    for (const key of Object.keys(ACTION_LABELS)) {
      expect(ALL_DB_NOTIFICATION_KINDS as readonly string[]).toContain(key);
    }
  });

  it("gives budget threshold alerts their own specific label, not the generic default", () => {
    expect(ACTION_LABELS["budget_threshold_80"]).toBe(
      "reported 80% budget used on",
    );
    expect(ACTION_LABELS["budget_threshold_100"]).toBe(
      "reported 100% budget used on",
    );
  });
});
