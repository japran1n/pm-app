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

  it("test_AS_378_notifyNewlyMentionedUsers_is_a_no_op_stub_that_never_throws_and_returns_the_diffed_ids", async () => {
    // F206-F212 (the notification fan-out chain) do not exist yet in this
    // repo — this proves the documented no-op stub behaves exactly as
    // specified: it resolves (never throws), and echoes back the ids for
    // a future F207 to consume, without attempting any real delivery.
    const result = await notifyNewlyMentionedUsers({
      taskId: "task-1",
      authorId: "author-1",
      newlyMentionedUserIds: ["alice", "bob"],
    });

    expect(result).toEqual({ notified: ["alice", "bob"] });
  });

  it("test_AS_378_notifyNewlyMentionedUsers_no_ops_cleanly_when_nothing_is_newly_mentioned", async () => {
    const result = await notifyNewlyMentionedUsers({
      taskId: "task-1",
      authorId: "author-1",
      newlyMentionedUserIds: [],
    });

    expect(result).toEqual({ notified: [] });
  });
});
