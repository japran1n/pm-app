// @vitest-environment jsdom
//
// F204 follow-up (AS-376, "not offered in the picker" half): proves that
// components/task/comment-list.tsx's mentionSuggestions — the source the
// @-mention picker (components/editor/mention-extension.ts, F203) is
// actually built from — excludes a workspace member who is not visible to
// the commenter on this task's project, rather than offering every active
// workspace member (F204's own handoff explicitly left this half
// out-of-scope; this closes it).
//
// This mocks `getMentionCandidates` (lib/actions/comments.ts) rather than
// hitting a real Supabase project, since the server-side predicate itself
// (resolveVisibleMentionIds) is already covered by
// tests/integration/mention-visibility.test.ts's real-database
// "AS-376 (picker)" cases — this test's job is only to prove CommentList
// actually calls that action and uses its result to narrow
// mentionSuggestions, not to re-prove the predicate.

import { createElement } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Realtime subscriptions talk to a live Supabase channel — out of scope
// here, same stub convention as tests/unit/user-avatar.test.tsx.
vi.mock("@/components/task/use-comments-realtime", () => ({
  useCommentsRealtime: () => {},
}));
vi.mock("@/components/task/use-reactions-realtime", () => ({
  useReactionsRealtime: () => {},
}));

const getMentionCandidates = vi.fn();
vi.mock("@/lib/actions/comments", () => ({
  addComment: vi.fn(),
  deleteComment: vi.fn(),
  editComment: vi.fn(),
  restoreComment: vi.fn(),
  getMentionCandidates: (taskId: string) => getMentionCandidates(taskId),
}));

let capturedMentionSuggestions: { id: string; label: string }[] | undefined;
vi.mock("@/components/editor/rich-text-editor", () => ({
  RichTextEditor: (props: {
    mentionSuggestions?: { id: string; label: string }[];
  }) => {
    capturedMentionSuggestions = props.mentionSuggestions;
    return null;
  },
  RichTextRenderer: () => null,
}));

import { CommentList, type CommentListMember } from "@/components/task/comment-list";

const MEMBERS: CommentListMember[] = [
  { userId: "visible-1", email: "visible1@example.com", name: "Visible One" },
  { userId: "visible-2", email: "visible2@example.com", name: "Visible Two" },
  { userId: "invisible-1", email: "outsider@example.com", name: "Outsider" },
];

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("test_AS_376_mention_picker_narrowed_to_project_visible_members", () => {
  afterEach(() => {
    cleanup();
    getMentionCandidates.mockReset();
    capturedMentionSuggestions = undefined;
  });

  it("does not offer a mention candidate the caller-resolved visibility check excluded", async () => {
    getMentionCandidates.mockResolvedValue({
      ok: true,
      data: { userIds: ["visible-1", "visible-2"] },
    });

    render(
      createElement(CommentList, {
        taskId: "task-1",
        comments: [],
        members: MEMBERS,
      }),
    );

    await flushMicrotasks();

    expect(getMentionCandidates).toHaveBeenCalledWith("task-1");
    expect(capturedMentionSuggestions).toBeDefined();
    const ids = capturedMentionSuggestions!.map((s) => s.id);
    expect(ids).toContain("visible-1");
    expect(ids).toContain("visible-2");
    expect(ids).not.toContain("invisible-1");
  });

  it("offers no candidates (rather than falling back to all members) while the visibility check is still resolving or fails", async () => {
    getMentionCandidates.mockResolvedValue({ ok: false, error: "nope" });

    render(
      createElement(CommentList, {
        taskId: "task-1",
        comments: [],
        members: MEMBERS,
      }),
    );

    await flushMicrotasks();

    expect(capturedMentionSuggestions).toEqual([]);
  });

  it("re-resolves candidates when taskId changes, scoping the picker per task", async () => {
    getMentionCandidates.mockImplementation(async (taskId: string) => {
      if (taskId === "task-1") {
        return { ok: true, data: { userIds: ["visible-1"] } };
      }
      return { ok: true, data: { userIds: ["visible-2"] } };
    });

    const { rerender } = render(
      createElement(CommentList, {
        taskId: "task-1",
        comments: [],
        members: MEMBERS,
      }),
    );
    await flushMicrotasks();
    expect(capturedMentionSuggestions!.map((s) => s.id)).toEqual(["visible-1"]);

    rerender(
      createElement(CommentList, {
        taskId: "task-2",
        comments: [],
        members: MEMBERS,
      }),
    );
    await flushMicrotasks();
    expect(capturedMentionSuggestions!.map((s) => s.id)).toEqual(["visible-2"]);
  });
});
