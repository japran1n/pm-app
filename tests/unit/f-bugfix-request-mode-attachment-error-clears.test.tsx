// @vitest-environment jsdom
//
// Portal polish follow-up (AS-011): the "Attachments can't be added to a
// request yet" error (F015, request-mode attachment blocking) used to stay
// on screen after the user removed the attachments, or turned request mode
// back off -- describing a state that no longer existed. This exercises
// both recovery paths and confirms the error clears as soon as either
// condition stops holding.
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/lib/actions/chat-attachments", () => ({
  uploadChatAttachment: vi.fn(async () => ({ ok: true, data: { id: "attachment-1" } })),
  removePendingChatAttachment: vi.fn(async () => ({ ok: true })),
}));

import { MessageComposer } from "@/components/chat/message-composer";

type JSONDoc = { type: "doc"; content: unknown[] };

let latestOnChange: ((content: JSONDoc) => void) | null = null;

vi.mock("@/components/editor/rich-text-editor", () => ({
  RichTextEditor: (props: { onChange?: (content: JSONDoc) => void }) => {
    latestOnChange = props.onChange ?? null;
    return createElement("div", { "data-testid": "rich-editor-stub" });
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  latestOnChange = null;
});

const MENTION_SUGGESTIONS = [{ id: "user-42", label: "Priya Shah" }];
const ERROR_TEXT = "Attachments can't be added to a request yet — send them as a message.";

async function attachFileAndEnterRequestMode(container: HTMLElement) {
  const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(["hello"], "brief.pdf", { type: "application/pdf" });
  await act(async () => {
    fireEvent.change(fileInput, { target: { files: [file] } });
  });
  await waitFor(() => expect(screen.getByText("brief.pdf")).toBeInTheDocument());

  await waitFor(() => expect(screen.getByTestId("rich-editor-stub")).toBeInTheDocument());
  fireEvent.click(screen.getByText("This is a request for new work"));
  act(() => {
    latestOnChange?.({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Add a pricing page" }] }],
    });
  });
}

describe("AS-011: stale request-mode attachment error clears", () => {
  it("test_AS_011_error_clears_after_removing_the_attachment", async () => {
    const { container } = render(
      createElement(MessageComposer, {
        onSend: vi.fn(async () => ({ ok: true })),
        onFileRequest: vi.fn(async () => ({ ok: true })),
        mentionSuggestions: MENTION_SUGGESTIONS,
        channelId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      }),
    );

    await attachFileAndEnterRequestMode(container);
    fireEvent.click(screen.getByLabelText("Send message"));
    await waitFor(() => expect(screen.getByText(ERROR_TEXT)).toBeInTheDocument());

    const removeButton = screen.getByText("brief.pdf").parentElement?.querySelector("button");
    expect(removeButton).toBeTruthy();
    await act(async () => {
      fireEvent.click(removeButton!);
    });

    await waitFor(() => expect(screen.queryByText(ERROR_TEXT)).not.toBeInTheDocument());
  });

  it("test_AS_011_error_clears_after_turning_off_request_mode", async () => {
    const { container } = render(
      createElement(MessageComposer, {
        onSend: vi.fn(async () => ({ ok: true })),
        onFileRequest: vi.fn(async () => ({ ok: true })),
        mentionSuggestions: MENTION_SUGGESTIONS,
        channelId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      }),
    );

    await attachFileAndEnterRequestMode(container);
    fireEvent.click(screen.getByLabelText("Send message"));
    await waitFor(() => expect(screen.getByText(ERROR_TEXT)).toBeInTheDocument());

    fireEvent.click(screen.getByText("This is a request for new work"));

    await waitFor(() => expect(screen.queryByText(ERROR_TEXT)).not.toBeInTheDocument());
  });
});
