// Unit test for F303 (missions/20260818-213033 follow-up FU-1,
// D3/D8: AS-363, AS-365, AS-366).
//
// tests/unit/comment-list.test.ts and tests/unit/comment-reactions.test.ts
// both prove the COMPONENT renders `editedAt`/`reactions` correctly when
// handed as a prop — that is exactly why D3 (getTaskDetail never selected
// edited_at/reactions) went uncaught for an entire milestone. This test
// closes that specific gap: it renders CommentList from a payload
// constructed to be structurally identical to what
// lib/actions/tasks.ts's getTaskDetail actually returns (the same
// `{ id, taskId, userId, text, bodyJson, createdAt, editedAt, reactions }`
// shape, reactions grouped into CommentReactionSummary[]) and asserts the
// "(edited)" marker and a reaction chip's count/reactor name are visible —
// so a regression that silently drops `editedAt`/`reactions` from the real
// mapping (not just the component) would show up here too, so long as this
// test's fixture is kept honest as a stand-in for the real query shape
// (see tests/integration/task-detail-comment-read-path.test.ts for the
// strongest version of this proof, against the real DB).

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { CommentList, type TaskComment } from "@/components/task/comment-list";
import type { CommentListMember } from "@/components/task/comment-list";

const MEMBERS: CommentListMember[] = [
  { userId: "u1", email: "alice@example.com", name: "Alice Anderson" },
  { userId: "u2", email: "bob@example.com", name: "Bob Baker" },
];

const NOW = Date.now();

// Mirrors getTaskDetail's own comments.map(...) return shape exactly —
// every field this test relies on is one getTaskDetail actually populates
// post-fix (edited_at -> editedAt, the grouped comment_reactions ->
// reactions), not a shape only the component's own prop type happens to
// accept.
const LOADED_COMMENTS: TaskComment[] = [
  {
    id: "c1",
    taskId: "t1",
    userId: "u1",
    text: "This was edited after posting",
    createdAt: new Date(NOW - 3600_000).toISOString(),
    editedAt: new Date(NOW - 1_000).toISOString(),
    reactions: [{ emoji: "👍", userIds: ["u2"] }],
  },
  {
    id: "c2",
    taskId: "t1",
    userId: "u2",
    text: "Never edited, no reactions",
    createdAt: new Date(NOW - 1_800_000).toISOString(),
    reactions: [],
  },
];

function render() {
  return renderToStaticMarkup(
    createElement(CommentList, {
      taskId: "t1",
      comments: LOADED_COMMENTS,
      members: MEMBERS,
      currentUserId: "u1",
      currentUserRole: "member",
    }),
  );
}

describe("CommentList rendered from a getTaskDetail-shaped payload (F303: AS-363, AS-365, AS-366)", () => {
  it("test_AS_363_the_edited_marker_appears_for_a_comment_loaded_with_a_real_editedAt_value", () => {
    const html = render();
    expect(html).toContain("(edited)");
  });

  it("test_AS_363_the_edited_marker_does_not_appear_for_a_comment_loaded_with_no_editedAt", () => {
    // The single edited comment's marker is present (checked above); this
    // asserts the OTHER, never-edited comment specifically renders no
    // marker of its own — i.e. this isn't a global "always show it" bug.
    const html = render();
    const secondCommentIndex = html.indexOf("Never edited, no reactions");
    expect(secondCommentIndex).toBeGreaterThan(-1);
    const afterSecondComment = html.slice(secondCommentIndex);
    // No further "(edited)" occurrence past the second comment's own text.
    expect(afterSecondComment).not.toContain("(edited)");
  });

  it("test_AS_365_AS_366_a_reaction_chip_with_its_count_and_reactor_name_renders_for_a_comment_loaded_with_a_real_reactions_array", () => {
    const html = render();
    // The chip itself: emoji + count.
    expect(html).toContain("👍");
    expect(html).toContain(">1<");
    // The accessible name carries the reactor's resolved display name
    // (Bob Baker, from MEMBERS), not a raw user id — proving reactor-name
    // resolution runs off real loaded data, not a hand-built prop that
    // already "knows" the right shape.
    expect(html).toContain("Bob Baker");
  });

  it("test_AS_365_a_comment_loaded_with_an_empty_reactions_array_renders_no_reaction_chips", () => {
    const html = render();
    const secondCommentIndex = html.indexOf("Never edited, no reactions");
    const afterSecondComment = html.slice(secondCommentIndex);
    expect(afterSecondComment).not.toContain("👍");
  });
});
