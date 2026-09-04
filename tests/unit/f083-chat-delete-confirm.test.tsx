// @vitest-environment jsdom
//
// F083: chat message deletion used to gate on raw `window.confirm`
// (components/chat/message-list.tsx). Converted to the same AlertDialog
// pattern the rest of this codebase already uses (see
// tests/unit/bulk-delete-action.test.tsx's established shape) — the
// mutation must not fire until the dialog's own confirm button is
// clicked.

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { docFromPlainText } from "@/lib/comments/rich-text";

const deleteMessageMock = vi.fn();
const editMessageMock = vi.fn();

vi.mock("@/lib/actions/chat-messages", () => ({
  editMessage: (...args: unknown[]) => editMessageMock(...args),
  deleteMessage: (...args: unknown[]) => deleteMessageMock(...args),
}));

vi.mock("@/lib/actions/chat-reactions", () => ({
  toggleMessageReaction: vi.fn(),
}));

import { MessageList } from "@/components/chat/message-list";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const MEMBER = { userId: "u1", name: "Test User", email: "test@example.com", avatarUrl: null };

const MESSAGE = {
  id: "mmmmmmmm-mmmm-4mmm-8mmm-mmmmmmmmmmmm",
  channelId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  senderId: "u1",
  bodyJson: docFromPlainText("Hello world"),
  parentMessageId: null,
  editedAt: null,
  deletedAt: null,
  createdAt: new Date().toISOString(),
};

function renderList() {
  return render(
    createElement(MessageList, {
      messages: [MESSAGE],
      members: [MEMBER],
      currentUserId: "u1",
    }),
  );
}

function hoverAndOpenDeleteDialog() {
  // The row's hover actions (edit/delete) only render while `hovered` is
  // true — same as this component's own JSDoc for `handleDelete`.
  fireEvent.mouseEnter(screen.getByText("Hello world").closest("div.group")!);
  fireEvent.click(screen.getByTitle("Delete"));
}

describe("Chat message delete confirmation (F083)", () => {
  it("opening the dialog does not call deleteMessage", async () => {
    renderList();

    hoverAndOpenDeleteDialog();

    expect(
      await screen.findByText(/delete this message\?/i),
    ).toBeInTheDocument();
    expect(deleteMessageMock).not.toHaveBeenCalled();
  });

  it("calls deleteMessage only after the dialog's own confirm action is clicked", async () => {
    deleteMessageMock.mockResolvedValue(undefined);
    renderList();

    hoverAndOpenDeleteDialog();
    await screen.findByText(/delete this message\?/i);
    expect(deleteMessageMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() => {
      expect(deleteMessageMock).toHaveBeenCalledTimes(1);
    });
    expect(deleteMessageMock).toHaveBeenCalledWith(MESSAGE.id);
  });

  it("cancelling the dialog never calls deleteMessage", async () => {
    renderList();

    hoverAndOpenDeleteDialog();
    await screen.findByText(/delete this message\?/i);

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(deleteMessageMock).not.toHaveBeenCalled();
  });
});
