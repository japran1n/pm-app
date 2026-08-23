// F205 (AS-378): mentions work in task descriptions as well as comments.
//
// Unit coverage for lib/notifications/mentions.ts's pure diffing logic —
// "notify only newly added mentions, diffed against the previous save" is
// this feature's own stated whole-feature note, so its own dedicated test
// (test_AS_378_editing_an_unrelated_word_does_not_re_notify_existing_mentions)
// is the primary proof, not an incidental side effect of some other test.

import { describe, expect, it } from "vitest";

import {
  extractMentionIds,
  extractNewlyMentionedIds,
  notifyNewlyMentionedUsers,
} from "@/lib/notifications/mentions";

function docWithMentions(ids: string[], extraText = "") {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          ...(extraText ? [{ type: "text", text: extraText }] : []),
          ...ids.map((id) => ({ type: "mention", attrs: { id } })),
        ],
      },
    ],
  };
}

describe("AS-378: mentions work in task descriptions as well as comments", () => {
  it("test_AS_378_extractMentionIds_collects_every_mention_node_in_a_document", () => {
    const doc = docWithMentions(["alice", "bob"]);
    expect(extractMentionIds(doc)).toEqual(new Set(["alice", "bob"]));
  });

  it("test_AS_378_extractMentionIds_returns_empty_set_for_null_or_no_mentions", () => {
    expect(extractMentionIds(null)).toEqual(new Set());
    expect(
      extractMentionIds({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }],
      }),
    ).toEqual(new Set());
  });

  it("test_AS_378_a_freshly_added_mention_on_first_save_is_newly_mentioned", () => {
    const previous = docWithMentions([]);
    const next = docWithMentions(["alice"]);
    expect(extractNewlyMentionedIds(previous, next)).toEqual(["alice"]);
  });

  it("test_AS_378_a_mention_added_to_a_previously_empty_description_is_newly_mentioned", () => {
    expect(extractNewlyMentionedIds(null, docWithMentions(["alice"]))).toEqual([
      "alice",
    ]);
  });

  // The spec's own explicit note: "editing an unrelated word does not
  // re-notify existing mentions" — this diff IS the whole feature.
  it("test_AS_378_editing_an_unrelated_word_does_not_re_notify_existing_mentions", () => {
    const previous = docWithMentions(["alice"], "Ping ");
    const next = docWithMentions(["alice"], "Ping urgently, ");

    expect(extractNewlyMentionedIds(previous, next)).toEqual([]);
  });

  it("test_AS_378_only_the_genuinely_new_mention_is_returned_when_one_is_added_alongside_an_existing_one", () => {
    const previous = docWithMentions(["alice"]);
    const next = docWithMentions(["alice", "bob"]);

    expect(extractNewlyMentionedIds(previous, next)).toEqual(["bob"]);
  });

  it("test_AS_378_removing_a_mention_never_appears_as_newly_mentioned", () => {
    const previous = docWithMentions(["alice", "bob"]);
    const next = docWithMentions(["bob"]);

    expect(extractNewlyMentionedIds(previous, next)).toEqual([]);
  });

  it("test_AS_378_re_adding_a_previously_removed_mention_in_a_later_save_is_newly_mentioned_again", () => {
    // Only the immediately-previous save is diffed against (not full
    // history) — removing then re-adding the same mention on a SUBSEQUENT
    // save is treated as new again, per the diff being save-to-save.
    const removedSave = docWithMentions([]);
    const reAddedSave = docWithMentions(["alice"]);

    expect(extractNewlyMentionedIds(removedSave, reAddedSave)).toEqual([
      "alice",
    ]);
  });

  // F207: notifyNewlyMentionedUsers is no longer a stub — it delivers a
  // real `create_notification` RPC call (via the caller's session client)
  // per newly-mentioned id, excluding the author (AS-384), and promotes
  // each mentioned non-watcher (via the admin client) per AS-375.
  // F301: F211's `filterRecipientsByInAppPreference`
  // (lib/notifications/preferences.ts) added a `notification_preferences`
  // `.select()` read into `notifyNewlyMentionedUsers`'s call path — this
  // fake `admin` client previously only implemented `.from().upsert()`
  // (the task_watchers write below), so every one of these tests threw
  // `TypeError: client.from(...).select is not a function`. The chainable
  // builder below returns no preference rows by default (`.in()` resolves
  // to `{ data: [], error: null }`), which `filterRecipientsByInAppPreference`
  // treats as "no row for this user: fail open" — i.e. every recipient
  // keeps their default in-app-enabled behaviour, matching these tests'
  // existing expectations about who gets notified.
  function fakeClients() {
    const rpcCalls: unknown[] = [];
    const supabase = {
      rpc: async (name: string, args: unknown) => {
        rpcCalls.push({ name, args });
        return { data: null, error: null };
      },
    };
    const upsertCalls: unknown[] = [];
    const selectCalls: unknown[] = [];
    const admin = {
      from: (table: string) => ({
        upsert: async (rows: unknown) => {
          upsertCalls.push(rows);
          return { data: null, error: null };
        },
        select: (columns: string) => ({
          in: async (column: string, values: unknown[]) => {
            selectCalls.push({ table, columns, column, values });
            return { data: [], error: null };
          },
        }),
      }),
    };
    return { supabase, admin, rpcCalls, upsertCalls, selectCalls };
  }

  it("test_AS_374_AS_381_notifyNewlyMentionedUsers_delivers_a_mention_notification_per_newly_mentioned_id", async () => {
    const { supabase, admin, rpcCalls } = fakeClients();

    const result = await notifyNewlyMentionedUsers({
      taskId: "task-1",
      workspaceId: "workspace-1",
      authorId: "author-1",
      newlyMentionedUserIds: ["alice", "bob"],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: supabase as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin as any,
    });

    expect(result.notified.sort()).toEqual(["alice", "bob"]);
    expect(rpcCalls).toHaveLength(2);
    expect(
      rpcCalls.every(
        (call) =>
          (call as { name: string }).name === "create_notification" &&
          (call as { args: { p_kind: string } }).args.p_kind === "mention",
      ),
    ).toBe(true);
  });

  it("test_AS_384_notifyNewlyMentionedUsers_never_notifies_the_author_of_their_own_mention", async () => {
    const { supabase, admin, rpcCalls } = fakeClients();

    const result = await notifyNewlyMentionedUsers({
      taskId: "task-1",
      workspaceId: "workspace-1",
      authorId: "author-1",
      // author-1 mentioned themselves alongside alice.
      newlyMentionedUserIds: ["author-1", "alice"],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: supabase as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin as any,
    });

    expect(result.notified).toEqual(["alice"]);
    expect(rpcCalls).toHaveLength(1);
  });

  it("test_AS_375_notifyNewlyMentionedUsers_promotes_each_mentioned_non_watcher_to_watcher", async () => {
    const { supabase, admin, upsertCalls } = fakeClients();

    await notifyNewlyMentionedUsers({
      taskId: "task-1",
      workspaceId: "workspace-1",
      authorId: "author-1",
      newlyMentionedUserIds: ["alice"],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: supabase as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin as any,
    });

    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0]).toEqual([
      { task_id: "task-1", user_id: "alice", is_watching: true },
    ]);
  });

  it("test_AS_378_notifyNewlyMentionedUsers_no_ops_cleanly_when_nothing_is_newly_mentioned", async () => {
    const { supabase, admin, rpcCalls, upsertCalls } = fakeClients();

    const result = await notifyNewlyMentionedUsers({
      taskId: "task-1",
      workspaceId: "workspace-1",
      authorId: "author-1",
      newlyMentionedUserIds: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: supabase as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin as any,
    });

    expect(result).toEqual({ notified: [] });
    expect(rpcCalls).toHaveLength(0);
    expect(upsertCalls).toHaveLength(0);
  });
});
