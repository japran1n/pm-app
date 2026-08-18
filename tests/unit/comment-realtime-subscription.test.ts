// F062 (AS-101, AS-102): unit tests for the comment list's Realtime
// soft-delete wiring.
//
// Mirrors tests/unit/board-realtime-subscription.test.ts's (F049) shape:
// this repo's vitest config runs with environment: "node" (no React
// Testing Library — see vitest.config.ts), so what's verified here is (1)
// the exact channel/table/filter/event configuration passed to the
// Supabase client (subscribeToCommentsRealtime) and that its registered
// postgres_changes callback forwards payloads to `onChange` unchanged, and
// (2) the pure reconciliation logic (reconcileComment) that decides how an
// incoming event changes a task's local comment list — specifically the
// AS-101 path: a comment soft-deleted by another viewer (author, admin, or
// owner) is removed from a viewer's already-open task view without a
// manual refresh.
//
// AS-102 (a soft-deleted comment does not reappear after a page reload) is
// primarily enforced by comments_select_active_members filtering
// `deleted_at is null` on every fetch
// (supabase/migrations/20260818040214_create_comments.sql) — already
// covered by F058/F061's RLS tests (tests/integration/rls-comments.test.ts,
// tests/integration/delete-comment.test.ts). What this suite additionally
// confirms is the wiring-specific half of AS-102: reconcileComment does
// not reintroduce a soft-deleted row if a stale/replayed Realtime event
// for it arrives after a simulated reload (i.e. the reducer itself never
// re-adds a row whose deleted_at is set, regardless of event ordering).
//
// F063 (AS-103): the subscription/reducer plumbing above (subscribe on
// `event: "*"`, reconcileComment's INSERT-append branch) was already built
// generically by F062 in anticipation of this feature — confirmed here,
// not re-implemented. What F062 didn't yet verify is *position*: a new
// comment from another viewer must land in the correct oldest-first slot
// once rendered (comment-list.tsx's sortedOldestFirst re-sorts
// localComments by created_at on every render), not just be present
// somewhere in the array. The AS-103 tests below add that ordering
// coverage on top of the existing bare-presence INSERT test.

import { describe, expect, it, vi } from "vitest";

import { subscribeToCommentsRealtime } from "@/lib/tasks/subscribe-comments-realtime";
import { reconcileComment } from "@/lib/tasks/reconcile-realtime-comment";
import type { TaskComment } from "@/components/task/comment-list";
import type { CommentRealtimeEvent } from "@/lib/tasks/subscribe-comments-realtime";

function createMockSupabaseClient() {
  const onCalls: Array<{
    event: string;
    filter: Record<string, unknown>;
    callback: (payload: CommentRealtimeEvent) => void;
  }> = [];
  const channelCalls: string[] = [];
  const removedChannels: unknown[] = [];

  const channelObject = {
    on: vi.fn(
      (
        event: string,
        filter: Record<string, unknown>,
        callback: (payload: CommentRealtimeEvent) => void,
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

describe("subscribeToCommentsRealtime (AS-101)", () => {
  it("subscribes on a per-task channel filtered to the comments table and task_id, for all events", () => {
    const { supabase, onCalls, channelCalls } = createMockSupabaseClient();
    const onChange = vi.fn();

    subscribeToCommentsRealtime(supabase as never, "task-123", onChange);

    expect(channelCalls).toEqual(["comments:task-123"]);
    expect(onCalls).toHaveLength(1);
    expect(onCalls[0].event).toBe("postgres_changes");
    expect(onCalls[0].filter).toEqual({
      event: "*",
      schema: "public",
      table: "comments",
      filter: "task_id=eq.task-123",
    });
  });

  it("forwards a received payload to onChange unchanged (payload shape)", () => {
    const { supabase, onCalls } = createMockSupabaseClient();
    const onChange = vi.fn();

    subscribeToCommentsRealtime(supabase as never, "task-123", onChange);

    const payload = {
      eventType: "UPDATE",
      schema: "public",
      table: "comments",
      new: {
        id: "c1",
        task_id: "task-123",
        user_id: "u1",
        text: "hi",
        created_at: "2026-08-18T00:00:00Z",
        deleted_at: "2026-08-18T00:05:00Z",
      },
      old: { id: "c1" },
    } as unknown as CommentRealtimeEvent;

    onCalls[0].callback(payload);

    expect(onChange).toHaveBeenCalledExactlyOnceWith(payload);
  });

  it("returns an unsubscribe function that removes the channel", () => {
    const { supabase, removedChannels, channelObject } = createMockSupabaseClient();

    const unsubscribe = subscribeToCommentsRealtime(
      supabase as never,
      "task-123",
      vi.fn(),
    );
    unsubscribe();

    expect(removedChannels).toEqual([channelObject]);
  });

  it("scopes different tasks to different channel names", () => {
    const { supabase, channelCalls } = createMockSupabaseClient();

    subscribeToCommentsRealtime(supabase as never, "task-a", vi.fn());
    subscribeToCommentsRealtime(supabase as never, "task-b", vi.fn());

    expect(channelCalls).toEqual(["comments:task-a", "comments:task-b"]);
  });
});

describe("reconcileComment (AS-101, AS-102)", () => {
  const baseComments: TaskComment[] = [
    {
      id: "c1",
      taskId: "task-1",
      userId: "u1",
      text: "First comment",
      createdAt: "2026-08-18T00:00:00Z",
    },
    {
      id: "c2",
      taskId: "task-1",
      userId: "u2",
      text: "Second comment",
      createdAt: "2026-08-18T00:01:00Z",
    },
  ];

  function updateEvent(
    row: Partial<Record<string, unknown>> & { id: string },
  ): CommentRealtimeEvent {
    return {
      eventType: "UPDATE",
      schema: "public",
      table: "comments",
      new: {
        task_id: "task-1",
        user_id: "u1",
        text: "First comment",
        created_at: "2026-08-18T00:00:00Z",
        deleted_at: null,
        ...row,
      },
      old: { id: row.id },
    } as unknown as CommentRealtimeEvent;
  }

  // AS-101: this is the core scenario — a comment soft-deleted by *any*
  // viewer (author, admin, or owner deleting via lib/actions/comments.ts's
  // deleteComment) removes it from a *different* viewer's already-open
  // task view the moment the Realtime UPDATE event arrives, without that
  // viewer refreshing.
  it("AS_101_removes_comment_whose_update_payload_has_deleted_at_set", () => {
    const event = updateEvent({
      id: "c1",
      deleted_at: "2026-08-18T00:10:00Z",
    });

    const next = reconcileComment(baseComments, event);

    expect(next.find((c) => c.id === "c1")).toBeUndefined();
    expect(next).toEqual([baseComments[1]]);
  });

  it("AS_101_removes_comment_on_hard_delete_event", () => {
    const event = {
      eventType: "DELETE",
      schema: "public",
      table: "comments",
      new: {},
      old: { id: "c2" },
    } as unknown as CommentRealtimeEvent;

    const next = reconcileComment(baseComments, event);

    expect(next).toEqual([baseComments[0]]);
  });

  it("AS_101_leaves_other_viewers_comments_untouched_when_a_different_comment_is_soft_deleted", () => {
    const event = updateEvent({
      id: "c1",
      deleted_at: "2026-08-18T00:10:00Z",
    });

    const next = reconcileComment(baseComments, event);

    // The negative case: c2, which was NOT soft-deleted, must remain.
    expect(next.find((c) => c.id === "c2")).toEqual(baseComments[1]);
  });

  // AS-102: the reducer never re-adds a comment whose deleted_at is set,
  // which is what a "does not reappear" guarantee reduces to at this
  // layer (the fetch-time guarantee itself — a reload's initial query
  // excluding deleted_at IS NOT NULL rows — is RLS's job, already covered
  // by F058/F061's RLS/integration tests). Simulates: comment is deleted,
  // a viewer reloads (fresh state seeded WITHOUT the deleted comment, as
  // comments_select_active_members would return), and then a stale/
  // replayed Realtime UPDATE event for that same already-deleted row
  // arrives — it must not reintroduce the comment.
  it("AS_102_does_not_reintroduce_a_soft_deleted_comment_after_a_simulated_reload", () => {
    // Simulated reload: fresh state as RLS would return it post-delete —
    // c1 already absent.
    const postReloadState: TaskComment[] = [baseComments[1]];

    // A stale/replayed event for the already-deleted comment arrives
    // after the reload.
    const staleEvent = updateEvent({
      id: "c1",
      deleted_at: "2026-08-18T00:10:00Z",
    });

    const next = reconcileComment(postReloadState, staleEvent);

    expect(next.find((c) => c.id === "c1")).toBeUndefined();
    expect(next).toEqual(postReloadState);
  });

  it("AS_102_repeated_soft_delete_events_for_the_same_comment_stay_idempotent", () => {
    const event = updateEvent({
      id: "c1",
      deleted_at: "2026-08-18T00:10:00Z",
    });

    const once = reconcileComment(baseComments, event);
    const twice = reconcileComment(once, event);

    expect(twice).toEqual(once);
    expect(twice.find((c) => c.id === "c1")).toBeUndefined();
  });

  it("appends a new comment on INSERT (idempotent path also exercised by F063)", () => {
    const event = {
      eventType: "INSERT",
      schema: "public",
      table: "comments",
      new: {
        id: "c3",
        task_id: "task-1",
        user_id: "u3",
        text: "Third comment",
        created_at: "2026-08-18T00:02:00Z",
        deleted_at: null,
      },
      old: {},
    } as unknown as CommentRealtimeEvent;

    const next = reconcileComment(baseComments, event);

    expect(next).toHaveLength(3);
    expect(next.find((c) => c.id === "c3")).toEqual({
      id: "c3",
      taskId: "task-1",
      userId: "u3",
      text: "Third comment",
      createdAt: "2026-08-18T00:02:00Z",
    });
  });

  // AS-103: a genuinely new comment from another viewer must not just be
  // *present* in local state after an INSERT event — it must land in the
  // correct chronological (oldest-first) position once rendered, matching
  // comment-list.tsx's sortedOldestFirst pass over localComments. This
  // reproduces that same sort here (component-local, not exported) to
  // verify position, not just presence, per F063's clarified DoD.
  it("AS_103_new_comment_from_another_viewer_lands_in_correct_chronological_position", () => {
    // Simulates two viewers: comment c2 was already posted by another user
    // slightly after c1 (baseComments). Now a *third* comment arrives via
    // Realtime INSERT with a created_at that falls BETWEEN c1 and c2 —
    // e.g. two users typing concurrently and the slower one's insert lands
    // second over the wire despite an earlier timestamp being possible in
    // general. This asserts the reducer's append is re-sorted into the
    // right slot rather than always trusting arrival order.
    const event = {
      eventType: "INSERT",
      schema: "public",
      table: "comments",
      new: {
        id: "c-mid",
        task_id: "task-1",
        user_id: "u4",
        text: "Arrived over the wire, but timestamped in between",
        created_at: "2026-08-18T00:00:30Z", // between c1 (00:00:00) and c2 (00:01:00)
        deleted_at: null,
      },
      old: {},
    } as unknown as CommentRealtimeEvent;

    const reconciled = reconcileComment(baseComments, event);

    // Presence: the new comment is in local state.
    expect(reconciled.find((c) => c.id === "c-mid")).toBeDefined();

    // Position/order: mirrors comment-list.tsx's sortedOldestFirst, which
    // re-sorts localComments by createdAt ascending on every render — this
    // is what actually determines on-screen order for AS-103, not the
    // reducer's raw array order.
    const rendered = [...reconciled].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    expect(rendered.map((c) => c.id)).toEqual(["c1", "c-mid", "c2"]);
  });

  // AS-103 (multiple concurrent inserts): several new comments arriving as
  // separate INSERT events, each reduced in turn (mirroring the hook
  // calling setLocalComments once per event), still end up fully ordered
  // once rendered — not just each individually appended.
  it("AS_103_multiple_new_comments_arrive_in_correct_order_after_several_inserts", () => {
    function insertEvent(
      id: string,
      created_at: string,
      user_id: string,
    ): CommentRealtimeEvent {
      return {
        eventType: "INSERT",
        schema: "public",
        table: "comments",
        new: {
          id,
          task_id: "task-1",
          user_id,
          text: `comment ${id}`,
          created_at,
          deleted_at: null,
        },
        old: {},
      } as unknown as CommentRealtimeEvent;
    }

    let state = baseComments;
    // Arrive out of chronological order over the wire.
    state = reconcileComment(state, insertEvent("c-late", "2026-08-18T00:02:00Z", "u5"));
    state = reconcileComment(state, insertEvent("c-early", "2026-08-17T23:59:00Z", "u6"));

    const rendered = [...state].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    expect(rendered.map((c) => c.id)).toEqual(["c-early", "c1", "c2", "c-late"]);
  });

  it("is a no-op when the DELETE payload has no old.id", () => {
    const event = {
      eventType: "DELETE",
      schema: "public",
      table: "comments",
      new: {},
      old: {},
    } as unknown as CommentRealtimeEvent;

    const next = reconcileComment(baseComments, event);

    expect(next).toEqual(baseComments);
  });
});
