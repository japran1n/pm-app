// F211: unit coverage for lib/notifications/preferences.ts's
// filterRecipientsByInAppPreference (AS-391) — the pure filtering logic
// against a mocked Supabase client, isolated from the real-DB proof in
// tests/integration/notification-fanout.test.ts (which proves the actual
// end-to-end skip against a real project).

import { describe, expect, it } from "vitest";

import { filterRecipientsByInAppPreference } from "@/lib/notifications/preferences";
import type { FanoutRecipient } from "@/lib/notifications/fanout";

// Minimal stand-in for the slice of SupabaseClient this function actually
// calls (`.from(...).select(...).in(...)`), returning canned rows.
function mockClient(rows: Array<Record<string, unknown>>, error: unknown = null) {
  return {
    from: () => ({
      select: () => ({
        in: async () => ({ data: error ? null : rows, error }),
      }),
    }),
  } as never;
}

describe("F211 filterRecipientsByInAppPreference", () => {
  it("test_AS_391_drops_a_recipient_whose_in_app_preference_for_that_kind_is_disabled", async () => {
    const recipients: FanoutRecipient[] = [
      { userId: "user-1", kind: "mention" },
      { userId: "user-2", kind: "mention" },
    ];
    const client = mockClient([
      { user_id: "user-1", mention_in_app: false, task_assigned_in_app: true, comment_reply_in_app: true, watcher_update_in_app: true },
      { user_id: "user-2", mention_in_app: true, task_assigned_in_app: true, comment_reply_in_app: true, watcher_update_in_app: true },
    ]);

    const result = await filterRecipientsByInAppPreference(client, recipients);

    expect(result).toEqual([{ userId: "user-2", kind: "mention" }]);
  });

  it("test_AS_391_keeps_a_recipient_with_no_preferences_row_fail_open", async () => {
    const recipients: FanoutRecipient[] = [{ userId: "user-no-row", kind: "watcher_update" }];
    const client = mockClient([]); // no matching row

    const result = await filterRecipientsByInAppPreference(client, recipients);

    expect(result).toEqual(recipients);
  });

  it("test_AS_391_fails_open_and_keeps_everyone_on_a_preferences_read_error", async () => {
    const recipients: FanoutRecipient[] = [{ userId: "user-1", kind: "task_assigned" }];
    const client = mockClient([], { message: "boom" });

    const result = await filterRecipientsByInAppPreference(client, recipients);

    expect(result).toEqual(recipients);
  });

  it("test_AS_391_an_empty_recipient_list_returns_empty_without_querying", async () => {
    const client = mockClient([]);
    const result = await filterRecipientsByInAppPreference(client, []);
    expect(result).toEqual([]);
  });

  it("test_AS_391_a_kind_specific_preference_only_gates_its_own_kind_not_others", async () => {
    const recipients: FanoutRecipient[] = [
      { userId: "user-1", kind: "comment_reply" },
      { userId: "user-1", kind: "mention" },
    ];
    const client = mockClient([
      { user_id: "user-1", mention_in_app: true, task_assigned_in_app: true, comment_reply_in_app: false, watcher_update_in_app: true },
    ]);

    const result = await filterRecipientsByInAppPreference(client, recipients);

    expect(result).toEqual([{ userId: "user-1", kind: "mention" }]);
  });
});
