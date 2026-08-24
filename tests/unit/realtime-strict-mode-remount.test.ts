// F329: proves the actual production crash class is fixed —
//
//   "cannot add `postgres_changes` callbacks for realtime:<topic> after
//   `subscribe()`."
//
// — for all four subscribe*Realtime modules that share the
// fixed-topic + `.on()` + `.subscribe()` + async `removeChannel` pattern.
//
// Uses tests/unit/helpers/faithful-realtime-client.ts, a channel double
// that (unlike the hand-built fakes in each module's own existing test
// file) actually throws on `.on()` after `subscribe()` and models
// `removeChannel` as async — the exact conditions under which the bug
// was unrepresentable before this feature. The scenario driven below —
// mount, synchronous cleanup, synchronous remount on the SAME topic — is
// React StrictMode's dev-only double-invoke sequence, the one that
// crashed every `/w/*` page via AppSidebar -> useNotificationsRealtime.
import { describe, expect, it, vi } from "vitest";

import { createFaithfulSupabaseClient } from "@/tests/unit/helpers/faithful-realtime-client";
import { subscribeToNotificationsRealtime } from "@/lib/notifications/subscribe-notifications-realtime";
import {
  subscribeToCommentsRealtime,
  subscribeToReactionsRealtime,
} from "@/lib/tasks/subscribe-comments-realtime";
import { subscribeToBoardRealtime } from "@/lib/board/subscribe-board-realtime";
import { subscribeToBoardColumnsRealtime } from "@/lib/board/subscribe-board-columns-realtime";

async function flushDeferredTeardown() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("F329: StrictMode mount -> cleanup -> mount does not crash", () => {
  it("test_F329_notifications_remount_on_same_topic_does_not_throw", () => {
    const { supabase } = createFaithfulSupabaseClient();

    expect(() => {
      const unsubscribe1 = subscribeToNotificationsRealtime(
        supabase as never,
        "user-123",
        vi.fn(),
      );
      unsubscribe1(); // synchronous StrictMode cleanup, same tick
      const unsubscribe2 = subscribeToNotificationsRealtime(
        supabase as never,
        "user-123",
        vi.fn(),
      );
      unsubscribe2();
    }).not.toThrow();
  });

  it("test_F329_comments_remount_on_same_topic_does_not_throw", () => {
    const { supabase } = createFaithfulSupabaseClient();

    expect(() => {
      const unsubscribe1 = subscribeToCommentsRealtime(
        supabase as never,
        "task-123",
        vi.fn(),
      );
      unsubscribe1();
      const unsubscribe2 = subscribeToCommentsRealtime(
        supabase as never,
        "task-123",
        vi.fn(),
      );
      unsubscribe2();
    }).not.toThrow();
  });

  it("test_F329_comment_reactions_remount_on_same_topic_does_not_throw", () => {
    const { supabase } = createFaithfulSupabaseClient();

    expect(() => {
      const unsubscribe1 = subscribeToReactionsRealtime(
        supabase as never,
        "task-123",
        vi.fn(),
      );
      unsubscribe1();
      const unsubscribe2 = subscribeToReactionsRealtime(
        supabase as never,
        "task-123",
        vi.fn(),
      );
      unsubscribe2();
    }).not.toThrow();
  });

  it("test_F329_board_tasks_remount_on_same_topic_does_not_throw", () => {
    const { supabase } = createFaithfulSupabaseClient();

    expect(() => {
      const unsubscribe1 = subscribeToBoardRealtime(
        supabase as never,
        "project-123",
        vi.fn(),
      );
      unsubscribe1();
      const unsubscribe2 = subscribeToBoardRealtime(
        supabase as never,
        "project-123",
        vi.fn(),
      );
      unsubscribe2();
    }).not.toThrow();
  });

  it("test_F329_board_columns_remount_on_same_topic_does_not_throw", () => {
    const { supabase } = createFaithfulSupabaseClient();

    expect(() => {
      const unsubscribe1 = subscribeToBoardColumnsRealtime(
        supabase as never,
        "project-123",
        vi.fn(),
      );
      unsubscribe1();
      const unsubscribe2 = subscribeToBoardColumnsRealtime(
        supabase as never,
        "project-123",
        vi.fn(),
      );
      unsubscribe2();
    }).not.toThrow();
  });

  it("test_F329_reused_channel_still_delivers_events_to_the_surviving_subscriber_after_remount", () => {
    const { supabase, channels } = createFaithfulSupabaseClient();
    const onInsert = vi.fn();

    const unsubscribe1 = subscribeToNotificationsRealtime(
      supabase as never,
      "user-123",
      vi.fn(), // the discarded first-mount callback (StrictMode's throwaway mount)
    );
    unsubscribe1();
    subscribeToNotificationsRealtime(supabase as never, "user-123", onInsert);

    const channel = channels.find((c) => c.topic === "notifications:user-123")!;
    const postgresChangesCall = channel.onCalls.find((c) => c.type === "postgres_changes")!;
    postgresChangesCall.callback({
      new: {
        id: "n1",
        user_id: "user-123",
        workspace_id: "w1",
        kind: "task_assigned",
        created_at: "2026-08-24T00:00:00.000Z",
      },
    });

    expect(onInsert).toHaveBeenCalledExactlyOnceWith({
      id: "n1",
      userId: "user-123",
      workspaceId: "w1",
      kind: "task_assigned",
      createdAt: "2026-08-24T00:00:00.000Z",
    });
  });

  it("test_F329_a_real_unmount_eventually_tears_the_channel_down", async () => {
    const { supabase, removeChannelCalls } = createFaithfulSupabaseClient();

    const unsubscribe = subscribeToNotificationsRealtime(
      supabase as never,
      "user-123",
      vi.fn(),
    );
    unsubscribe();
    // No synchronous remount follows -> the deferred teardown should run.
    await flushDeferredTeardown();
    await flushDeferredTeardown();

    expect(removeChannelCalls).toHaveLength(1);
  });

  it("test_F329_comments_broadcast_listen_pairing_still_works_after_a_remount", () => {
    // Regression guard for the spec's explicit warning: if topics were
    // made unique per subscription instance to dodge the collision, the
    // broadcaster (lib/actions/comments.ts, which sends on the fixed
    // topic `comments:<taskId>`) and a post-remount listener would land
    // on different channel objects and broadcast delivery would silently
    // break. This fix keeps the topic fixed, so the broadcaster's
    // `supabase.channel(`comments:${taskId}`)` call reuses the exact same
    // channel object the listener is attached to.
    const { supabase, channels } = createFaithfulSupabaseClient();
    const onChange = vi.fn();

    const unsubscribe1 = subscribeToCommentsRealtime(
      supabase as never,
      "task-123",
      vi.fn(),
    );
    unsubscribe1();
    subscribeToCommentsRealtime(supabase as never, "task-123", onChange);

    // Mirrors lib/actions/comments.ts's deleteComment: broadcasts on a
    // freshly-obtained channel for the same fixed topic.
    const broadcastChannel = supabase.channel(`comments:task-123`);
    expect(broadcastChannel).toBe(
      channels.find((c) => c.topic === "comments:task-123"),
    );

    const deletedHandler = broadcastChannel.onCalls.find(
      (c) => c.type === "broadcast",
    )!;
    deletedHandler.callback({ payload: { id: "c1" } });

    expect(onChange).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        eventType: "DELETE",
        old: { id: "c1" },
      }),
    );
  });
});
