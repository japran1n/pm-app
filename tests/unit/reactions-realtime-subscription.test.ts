// F202 (AS-369): unit tests for the comment-reactions Realtime wiring —
// reactions appear live for other viewers without a reload.
//
// Mirrors tests/unit/comment-realtime-subscription.test.ts's (F062) shape:
// this repo's vitest config runs with environment: "node" (no React
// Testing Library), so what's verified here is (1) the exact
// channel/table/event configuration passed to the Supabase client
// (subscribeToReactionsRealtime) and that its registered postgres_changes
// callbacks translate INSERT/DELETE payloads into the flat
// ReactionRealtimeEvent shape, and (2) that comment-list.tsx's own
// reconciliation (folding a ReactionRealtimeEvent into a comment's
// `reactions` via the same pure `applyReactionToggle` reducer F201 already
// uses for its own optimistic update) produces the right end state,
// including the "don't echo my own toggle twice" guard.

import { describe, expect, it, vi } from "vitest";

import { subscribeToReactionsRealtime } from "@/lib/tasks/subscribe-comments-realtime";
import { applyReactionToggle } from "@/components/task/comment-reactions";

function createMockSupabaseClient() {
  const onCalls: Array<{
    event: string;
    filter: Record<string, unknown>;
    callback: (payload: unknown) => void;
  }> = [];
  const channelCalls: string[] = [];
  const removedChannels: unknown[] = [];

  const channelObject = {
    on: vi.fn(
      (
        event: string,
        filter: Record<string, unknown>,
        callback: (payload: unknown) => void,
      ) => {
        onCalls.push({ event, filter, callback });
        return channelObject;
      },
    ),
    subscribe: vi.fn(() => channelObject),
  };

  const supabase = {
    channel: vi.fn((name: string) => {
      channelCalls.push(name);
      return channelObject;
    }),
    removeChannel: vi.fn((ch: unknown) => {
      removedChannels.push(ch);
    }),
  };

  return { supabase, onCalls, channelCalls, removedChannels, channelObject };
}

describe("subscribeToReactionsRealtime (AS-369)", () => {
  it("test_AS_369_subscribes_on_a_per_task_channel_filtered_server_side_to_that_tasks_task_id", () => {
    const { supabase, onCalls, channelCalls } = createMockSupabaseClient();
    const onChange = vi.fn();

    subscribeToReactionsRealtime(supabase as never, "task-123", onChange);

    expect(channelCalls).toEqual(["comment_reactions:task-123"]);

    const insertCall = onCalls.find(
      (c) =>
        c.event === "postgres_changes" &&
        (c.filter as { event?: string }).event === "INSERT",
    );
    expect(insertCall).toBeDefined();
    expect(insertCall?.filter).toEqual({
      event: "INSERT",
      schema: "public",
      table: "comment_reactions",
      filter: "task_id=eq.task-123",
    });

    const deleteCall = onCalls.find(
      (c) =>
        c.event === "postgres_changes" &&
        (c.filter as { event?: string }).event === "DELETE",
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall?.filter).toEqual({
      event: "DELETE",
      schema: "public",
      table: "comment_reactions",
      filter: "task_id=eq.task-123",
    });
  });

  it("test_AS_369_a_different_tasks_channel_is_filtered_to_its_own_task_id_not_the_first_tasks", () => {
    const { supabase, onCalls } = createMockSupabaseClient();

    subscribeToReactionsRealtime(supabase as never, "task-a", vi.fn());
    subscribeToReactionsRealtime(supabase as never, "task-b", vi.fn());

    const filters = onCalls
      .filter((c) => c.event === "postgres_changes")
      .map((c) => (c.filter as { filter?: string }).filter);
    expect(filters).toContain("task_id=eq.task-a");
    expect(filters).toContain("task_id=eq.task-b");
    expect(filters).not.toContain(undefined);
  });

  it("test_AS_369_forwards_an_INSERT_payload_as_a_flat_reaction_added_event", () => {
    const { supabase, onCalls } = createMockSupabaseClient();
    const onChange = vi.fn();

    subscribeToReactionsRealtime(supabase as never, "task-123", onChange);

    const insertCall = onCalls.find(
      (c) =>
        c.event === "postgres_changes" &&
        (c.filter as { event?: string }).event === "INSERT",
    )!;

    insertCall.callback({
      new: { comment_id: "c1", user_id: "u2", emoji: "👍" },
      old: {},
    });

    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      eventType: "INSERT",
      commentId: "c1",
      userId: "u2",
      emoji: "👍",
    });
  });

  it("test_AS_369_forwards_a_DELETE_payload_as_a_flat_reaction_removed_event_using_old_row", () => {
    const { supabase, onCalls } = createMockSupabaseClient();
    const onChange = vi.fn();

    subscribeToReactionsRealtime(supabase as never, "task-123", onChange);

    const deleteCall = onCalls.find(
      (c) =>
        c.event === "postgres_changes" &&
        (c.filter as { event?: string }).event === "DELETE",
    )!;

    deleteCall.callback({
      new: {},
      old: { comment_id: "c1", user_id: "u2", emoji: "👍" },
    });

    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      eventType: "DELETE",
      commentId: "c1",
      userId: "u2",
      emoji: "👍",
    });
  });

  it("ignores an INSERT payload missing required fields (no onChange call)", () => {
    const { supabase, onCalls } = createMockSupabaseClient();
    const onChange = vi.fn();

    subscribeToReactionsRealtime(supabase as never, "task-123", onChange);

    const insertCall = onCalls.find(
      (c) =>
        c.event === "postgres_changes" &&
        (c.filter as { event?: string }).event === "INSERT",
    )!;

    insertCall.callback({ new: { comment_id: "c1" }, old: {} });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("returns an unsubscribe function that removes the channel", () => {
    const { supabase, removedChannels, channelObject } =
      createMockSupabaseClient();

    const unsubscribe = subscribeToReactionsRealtime(
      supabase as never,
      "task-123",
      vi.fn(),
    );
    unsubscribe();

    expect(removedChannels).toEqual([channelObject]);
  });

  it("scopes different tasks to different channel names", () => {
    const { supabase, channelCalls } = createMockSupabaseClient();

    subscribeToReactionsRealtime(supabase as never, "task-a", vi.fn());
    subscribeToReactionsRealtime(supabase as never, "task-b", vi.fn());

    expect(channelCalls).toEqual([
      "comment_reactions:task-a",
      "comment_reactions:task-b",
    ]);
  });
});

describe("comment-list.tsx's reaction-event reconciliation (AS-369)", () => {
  // Reproduces comment-list.tsx's useReactionsRealtime callback logic
  // directly against the pure applyReactionToggle reducer it calls, since
  // this repo's node-environment vitest config can't mount the Client
  // Component itself (no DOM/effects) — same rationale
  // tests/unit/comment-realtime-subscription.test.ts documents for
  // reconcileComment.
  function reconcileReaction(
    comments: { id: string; reactions?: { emoji: string; userIds: string[] }[] }[],
    event: { eventType: "INSERT" | "DELETE"; commentId: string; userId: string; emoji: string },
  ) {
    return comments.map((comment) =>
      comment.id === event.commentId
        ? {
            ...comment,
            reactions: applyReactionToggle(
              comment.reactions ?? [],
              event.emoji,
              event.eventType === "INSERT",
              event.userId,
            ),
          }
        : comment,
    );
  }

  const baseComments = [
    { id: "c1", reactions: [] as { emoji: string; userIds: string[] }[] },
    { id: "c2", reactions: [{ emoji: "🎉", userIds: ["u9"] }] },
  ];

  it("test_AS_369_a_reaction_added_by_another_viewer_is_folded_into_local_state", () => {
    const next = reconcileReaction(baseComments, {
      eventType: "INSERT",
      commentId: "c1",
      userId: "u2",
      emoji: "👍",
    });

    expect(next.find((c) => c.id === "c1")?.reactions).toEqual([
      { emoji: "👍", userIds: ["u2"] },
    ]);
    // The other comment, untouched by this event, is unaffected.
    expect(next.find((c) => c.id === "c2")).toEqual(baseComments[1]);
  });

  it("test_AS_369_a_reaction_removed_by_another_viewer_is_folded_into_local_state", () => {
    const next = reconcileReaction(baseComments, {
      eventType: "DELETE",
      commentId: "c2",
      userId: "u9",
      emoji: "🎉",
    });

    expect(next.find((c) => c.id === "c2")?.reactions).toEqual([]);
  });

  it("test_AS_369_a_second_tab_for_the_same_user_receives_and_applies_their_own_reaction_event", () => {
    // F305 (AS-369 fix): self-events used to be dropped unconditionally,
    // which meant a user's second browser tab never synced a reaction
    // made in the first tab until a manual reload. Now the event is
    // folded in like any other, and since applyReactionToggle is
    // idempotent, the originating tab (which already applied this
    // optimistically) sees no user-visible change either.
    const next = reconcileReaction(baseComments, {
      eventType: "INSERT",
      commentId: "c1",
      userId: "u1",
      emoji: "👍",
    });

    expect(next.find((c) => c.id === "c1")?.reactions).toEqual([
      { emoji: "👍", userIds: ["u1"] },
    ]);
  });

  it("test_AS_369_reapplying_the_same_users_own_already_applied_toggle_is_idempotent", () => {
    const alreadyApplied = [
      { id: "c1", reactions: [{ emoji: "👍", userIds: ["u1"] }] },
    ];
    const next = reconcileReaction(alreadyApplied, {
      eventType: "INSERT",
      commentId: "c1",
      userId: "u1",
      emoji: "👍",
    });

    // No duplicate entry — the current tab's optimistic update and the
    // echoed Realtime event converge to the same state.
    expect(next.find((c) => c.id === "c1")?.reactions).toEqual([
      { emoji: "👍", userIds: ["u1"] },
    ]);
  });

  it("test_AS_369_an_event_for_a_comment_not_in_local_state_is_a_no_op", () => {
    const next = reconcileReaction(baseComments, {
      eventType: "INSERT",
      commentId: "c-unknown",
      userId: "u2",
      emoji: "👍",
    });

    expect(next).toEqual(baseComments);
  });
});
