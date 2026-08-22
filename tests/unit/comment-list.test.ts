// Unit test for F060 (AS-096, AS-097).
//
// Renders CommentList (components/task/comment-list.tsx) directly, the
// same component task-detail-sheet.tsx (F039) composes, mirroring
// tests/unit/board-column.test.ts's renderToStaticMarkup convention (no
// jsdom/RTL in this repo's vitest setup — see vitest.config.ts's `node`
// environment).
//
//   AS-096: comments render in chronological order, oldest first, even
//     when the `comments` prop is passed out of order (this component
//     defensively re-sorts rather than trusting the caller).
//   AS-097: each comment shows its author (resolved from the `members`
//     prop by userId, falling back to email then user id) and a relative
//     timestamp (date-fns's formatDistanceToNow).

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { CommentList, type TaskComment } from "@/components/task/comment-list";
import type { CommentListMember } from "@/components/task/comment-list";

const MEMBERS: CommentListMember[] = [
  { userId: "u1", email: "alice@example.com", name: "Alice Anderson" },
  { userId: "u2", email: "bob@example.com", name: null },
  { userId: "u3", email: null, name: null },
];

const NOW = Date.now();

// Deliberately out of chronological order in the array itself, to prove
// AS-096 is a rendering guarantee, not an accident of input order.
const COMMENTS: TaskComment[] = [
  {
    id: "c2",
    taskId: "t1",
    userId: "u2",
    text: "Second comment (by created time)",
    createdAt: new Date(NOW - 60_000).toISOString(), // 1 min ago
  },
  {
    id: "c1",
    taskId: "t1",
    userId: "u1",
    text: "First comment (by created time)",
    createdAt: new Date(NOW - 3600_000).toISOString(), // 1 hour ago
  },
  {
    id: "c3",
    taskId: "t1",
    userId: "u3",
    text: "Third comment (by created time)",
    createdAt: new Date(NOW - 1_000).toISOString(), // seconds ago
  },
];

function render() {
  return renderToStaticMarkup(
    createElement(CommentList, {
      taskId: "t1",
      comments: COMMENTS,
      members: MEMBERS,
    }),
  );
}

describe("CommentList (F060: AS-096, AS-097)", () => {
  it("test_AS_096_comments_render_oldest_first_regardless_of_prop_order", () => {
    const html = render();

    const firstIndex = html.indexOf("First comment (by created time)");
    const secondIndex = html.indexOf("Second comment (by created time)");
    const thirdIndex = html.indexOf("Third comment (by created time)");

    expect(firstIndex).toBeGreaterThan(-1);
    expect(secondIndex).toBeGreaterThan(-1);
    expect(thirdIndex).toBeGreaterThan(-1);

    // Oldest ("First", 1h ago) appears before "Second" (1min ago), which
    // appears before "Third" (seconds ago) — chronological, oldest first.
    expect(firstIndex).toBeLessThan(secondIndex);
    expect(secondIndex).toBeLessThan(thirdIndex);
  });

  it("test_AS_097_each_comment_shows_author_name_with_email_and_userid_fallback", () => {
    const html = render();

    // u1 has a name -> name wins.
    expect(html).toContain("Alice Anderson");
    // u2 has no name -> falls back to email.
    expect(html).toContain("bob@example.com");
    // u3 has neither -> falls back to the raw user id.
    expect(html).toContain("u3");
  });

  it("test_AS_097_each_comment_shows_a_relative_timestamp", () => {
    const html = render();

    // date-fns formatDistanceToNow(..., { addSuffix: true }) output for
    // "1 hour ago" and "1 minute ago" deltas.
    expect(html).toMatch(/1 hour ago/);
    expect(html).toMatch(/1 minute ago|less than a minute ago/);
  });

  it("test_AS_096_empty_state_renders_when_there_are_no_comments", () => {
    const html = renderToStaticMarkup(
      createElement(CommentList, {
        taskId: "t1",
        comments: [],
        members: MEMBERS,
      }),
    );

    expect(html).toContain("No comments yet");
  });

  // F197 (AS-362, AS-364): the edit affordance is UI-only guidance — the
  // real enforcement is editComment's own server-side author-only check
  // (lib/actions/comments.ts). This SSR render (no click simulation) only
  // verifies the button's presence/absence tracks authorship, mirroring how
  // this same file already verifies canDelete's affordance indirectly via
  // currentUserId/currentUserRole props.
  it("test_AS_362_edit_button_shown_for_the_comments_own_author", () => {
    const html = renderToStaticMarkup(
      createElement(CommentList, {
        taskId: "t1",
        comments: COMMENTS,
        members: MEMBERS,
        currentUserId: "u1",
        currentUserRole: "member",
      }),
    );

    expect(html).toContain('aria-label="Edit comment"');
  });

  it("test_AS_364_edit_button_not_shown_for_a_different_member_including_admin", () => {
    // Viewer is u4: not the author of any seeded comment (authors are
    // u1/u2/u3), even as an admin — AS-364's author-only rule means the
    // edit affordance never appears for anyone but the comment's own
    // author, unlike the delete affordance which does show for
    // admins/owners.
    const html = renderToStaticMarkup(
      createElement(CommentList, {
        taskId: "t1",
        comments: COMMENTS,
        members: MEMBERS,
        currentUserId: "u4",
        currentUserRole: "admin",
      }),
    );

    expect(html).not.toContain('aria-label="Edit comment"');
  });
});
