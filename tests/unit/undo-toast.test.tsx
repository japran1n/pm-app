// @vitest-environment jsdom
//
// F190 (AS-345): "deleting shows an undo affordance that restores without
// visiting trash."
//
// Covers:
//  - lib/toast/undo-toast.ts's shared helper directly (message/description/
//    duration shape, and idempotency — a double-click on Undo only fires
//    the restore callback once).
//  - CommentList (components/task/comment-list.tsx): deleting a comment
//    shows the Undo toast, and clicking Undo genuinely restores the
//    comment into view (not just dismisses the toast) by calling the real
//    restoreComment action and re-inserting its returned row.

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
const toastWarningMock = vi.fn();
const toastDismissMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => {
      toastSuccessMock(...args);
      return "toast-id";
    },
    error: (...args: unknown[]) => toastErrorMock(...args),
    warning: (...args: unknown[]) => toastWarningMock(...args),
    dismiss: (...args: unknown[]) => toastDismissMock(...args),
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.resetModules();
});

describe("showUndoToast (F190: AS-345)", () => {
  it("raises a sonner success toast with the message, an Undo action, and trash-availability copy", async () => {
    const { showUndoToast } = await import("@/lib/toast/undo-toast");
    const onUndo = vi.fn();

    showUndoToast({ message: "Task deleted.", onUndo });

    expect(toastSuccessMock).toHaveBeenCalledTimes(1);
    const [message, options] = toastSuccessMock.mock.calls[0];
    expect(message).toBe("Task deleted.");
    expect(options.description).toMatch(/trash/i);
    expect(options.action.label).toBe("Undo");
    expect(typeof options.action.onClick).toBe("function");
  });

  it("idempotency: clicking the Undo action twice only calls onUndo once and only dismisses once", async () => {
    const { showUndoToast } = await import("@/lib/toast/undo-toast");
    const onUndo = vi.fn();

    showUndoToast({ message: "Task deleted.", onUndo });

    const [, options] = toastSuccessMock.mock.calls[0];
    options.action.onClick();
    options.action.onClick();

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(toastDismissMock).toHaveBeenCalledTimes(1);
  });
});

const commentDeleteMock = vi.fn();
const commentRestoreMock = vi.fn();

vi.mock("@/lib/actions/comments", () => ({
  addComment: vi.fn(),
  deleteComment: (...args: unknown[]) => commentDeleteMock(...args),
  restoreComment: (...args: unknown[]) => commentRestoreMock(...args),
  editComment: vi.fn(),
  // F204 follow-up (AS-376 picker narrowing): CommentList now fetches
  // mention candidates on mount — resolved to "none visible yet" here,
  // irrelevant to this delete/undo test.
  getMentionCandidates: vi.fn(async () => ({ ok: true, data: { userIds: [] } })),
}));

// CommentList mounts useCommentsRealtime, which creates a real browser
// Supabase client on mount — irrelevant to this delete/undo test and
// requires real env credentials this unit test shouldn't depend on, so the
// channel subscription is stubbed out (matches how other Realtime-mounting
// components are unit-tested elsewhere in this repo without a live socket).
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => {
    const channel: Record<string, unknown> = {};
    channel.on = () => channel;
    channel.subscribe = () => channel;
    return {
      channel: () => channel,
      removeChannel: () => {},
    };
  },
}));

describe("CommentList delete/undo (F190: AS-345)", () => {
  it("deleting a comment shows the Undo toast, and clicking Undo genuinely restores the comment (not just dismisses the toast)", async () => {
    const { CommentList } = await import("@/components/task/comment-list");

    const comment = {
      id: "c1",
      taskId: "t1",
      userId: "u1",
      text: "Hello world",
      createdAt: new Date().toISOString(),
    };

    commentDeleteMock.mockResolvedValue({ ok: true });
    commentRestoreMock.mockResolvedValue({ ok: true, data: comment });

    render(
      createElement(CommentList, {
        taskId: "t1",
        comments: [comment],
        members: [{ userId: "u1", email: "a@example.com", name: "Alice" }],
        currentUserId: "u1",
        currentUserRole: "member",
      }),
    );

    expect(screen.getByText("Hello world")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Delete comment"));

    await waitFor(() => expect(commentDeleteMock).toHaveBeenCalledWith("c1"));
    // Removed from view immediately (AS-101-style optimistic removal).
    await waitFor(() =>
      expect(screen.queryByText("Hello world")).not.toBeInTheDocument(),
    );

    // The Undo toast was raised.
    expect(toastSuccessMock).toHaveBeenCalledTimes(1);
    const [, options] = toastSuccessMock.mock.calls[0];

    // Clicking Undo calls the real restoreComment action and re-inserts
    // the comment it returns — a genuine restore, not merely dismissing
    // the toast.
    await options.action.onClick();

    await waitFor(() => expect(commentRestoreMock).toHaveBeenCalledWith("c1"));
    await waitFor(() =>
      expect(screen.getByText("Hello world")).toBeInTheDocument(),
    );
  });
});
