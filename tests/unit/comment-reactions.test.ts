// Unit test for F201 (AS-366): a reaction shows a count and who reacted.
//
// `applyReactionToggle` is the pure reducer components/task/comment-
// reactions.tsx uses to fold a toggleReaction Server Action result into
// the comment's reaction summary — exported specifically so this can be
// tested without a DOM (mirrors lib/tasks/reconcile-realtime-comment.ts's
// convention). The component itself renders straight from props with no
// effect, so exercising the reducer covers the same optimistic-update
// path the UI takes on every click.
//
// AS-366: after a reaction is added, the emoji's summary includes the
// new reactor's id (so a count and "who reacted" can both be derived from
// it); after it is removed, the summary reverts and an emoji with zero
// reactors is dropped entirely (matching "no reaction" rendering nothing).

import { describe, expect, it } from "vitest";

import {
  applyReactionToggle,
  type CommentReactionSummary,
} from "@/components/task/comment-reactions";

describe("F201 AS-366: applyReactionToggle", () => {
  it("test_AS_366_adds_reactor_to_existing_emoji_group", () => {
    const before: CommentReactionSummary[] = [
      { emoji: "👍", userIds: ["u1"] },
    ];
    const after = applyReactionToggle(before, "👍", true, "u2");
    expect(after).toEqual([{ emoji: "👍", userIds: ["u1", "u2"] }]);
  });

  it("test_AS_366_creates_new_emoji_group_on_first_reactor", () => {
    const before: CommentReactionSummary[] = [];
    const after = applyReactionToggle(before, "🎉", true, "u1");
    expect(after).toEqual([{ emoji: "🎉", userIds: ["u1"] }]);
  });

  it("test_AS_366_removing_the_only_reactor_drops_the_emoji_group", () => {
    const before: CommentReactionSummary[] = [
      { emoji: "❤️", userIds: ["u1"] },
    ];
    const after = applyReactionToggle(before, "❤️", false, "u1");
    expect(after).toEqual([]);
  });

  it("test_AS_366_removing_one_of_several_reactors_keeps_the_count_accurate", () => {
    const before: CommentReactionSummary[] = [
      { emoji: "👀", userIds: ["u1", "u2", "u3"] },
    ];
    const after = applyReactionToggle(before, "👀", false, "u2");
    expect(after).toEqual([{ emoji: "👀", userIds: ["u1", "u3"] }]);
  });

  it("test_AS_366_does_not_duplicate_an_already_present_reactor", () => {
    const before: CommentReactionSummary[] = [
      { emoji: "🚀", userIds: ["u1"] },
    ];
    const after = applyReactionToggle(before, "🚀", true, "u1");
    expect(after).toEqual([{ emoji: "🚀", userIds: ["u1"] }]);
  });

  it("test_AS_366_multiple_emoji_groups_stay_independent", () => {
    const before: CommentReactionSummary[] = [
      { emoji: "👍", userIds: ["u1"] },
      { emoji: "🎉", userIds: ["u2"] },
    ];
    const after = applyReactionToggle(before, "👍", true, "u3");
    expect(after).toEqual([
      { emoji: "👍", userIds: ["u1", "u3"] },
      { emoji: "🎉", userIds: ["u2"] },
    ]);
  });
});
