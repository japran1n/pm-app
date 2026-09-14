// @vitest-environment jsdom
//
// Mission 20260914-portal-simplify, F015 (AS-012): M2 scrutiny found the
// request-mode branch of MessageComposer used `extractPlainText` without
// the rich editor's mention-label resolver (a mention resolved to a raw
// user id instead of "@Name"), dropped Shift+Enter hard breaks, silently
// discarded queued attachments, and never told the sender their request
// was actually filed. This exercises the RICH editor path
// (`mentionSuggestions` set, per this feature's own DoD), mocking
// `RichTextEditor` the same way f-bugfix-message-composer-enter-race.test.tsx
// already does.
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

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

function docWithMentionAndHardBreak(): JSONDoc {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Ask " },
          { type: "mention", attrs: { id: "user-42" } },
          { type: "text", text: " about the homepage" },
          { type: "hardBreak" },
          { type: "text", text: "before Friday" },
        ],
      },
    ],
  };
}

async function checkRequestBoxAndUpdateDoc(doc: JSONDoc) {
  await waitFor(() => expect(screen.getByTestId("rich-editor-stub")).toBeInTheDocument());
  fireEvent.click(screen.getByText("This is a request for new work"));
  act(() => {
    latestOnChange?.(doc);
  });
}

describe("F015 / AS-012: request mode over the rich editor resolves mentions and keeps hard breaks", () => {
  it("test_AS_012_request_mode_resolves_the_mention_label_via_mentionSuggestions", async () => {
    const onFileRequest = vi.fn(async (_payload: { title: string; body: string }) => ({ ok: true }));

    render(
      createElement(MessageComposer, {
        onSend: vi.fn(async () => ({ ok: true })),
        onFileRequest,
        mentionSuggestions: MENTION_SUGGESTIONS,
      }),
    );

    await checkRequestBoxAndUpdateDoc(docWithMentionAndHardBreak());
    fireEvent.click(screen.getByLabelText("Send message"));

    await waitFor(() => expect(onFileRequest).toHaveBeenCalledTimes(1));
    const call = onFileRequest.mock.calls[0][0];
    expect(call.body).toContain("@Priya Shah");
    expect(call.body).not.toContain("user-42");
  });

  it("test_AS_012_request_mode_keeps_the_shift_enter_hard_break_as_a_newline", async () => {
    const onFileRequest = vi.fn(async (_payload: { title: string; body: string }) => ({ ok: true }));

    render(
      createElement(MessageComposer, {
        onSend: vi.fn(async () => ({ ok: true })),
        onFileRequest,
        mentionSuggestions: MENTION_SUGGESTIONS,
      }),
    );

    await checkRequestBoxAndUpdateDoc(docWithMentionAndHardBreak());
    fireEvent.click(screen.getByLabelText("Send message"));

    await waitFor(() => expect(onFileRequest).toHaveBeenCalledTimes(1));
    const call = onFileRequest.mock.calls[0][0];
    expect(call.body).toContain("about the homepage\nbefore Friday");
  });

  it("test_AS_012_shows_a_request_sent_toast_after_successfully_filing", async () => {
    const onFileRequest = vi.fn(async (_payload: { title: string; body: string }) => ({ ok: true }));

    render(
      createElement(MessageComposer, {
        onSend: vi.fn(async () => ({ ok: true })),
        onFileRequest,
        mentionSuggestions: MENTION_SUGGESTIONS,
      }),
    );

    await checkRequestBoxAndUpdateDoc({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Add a pricing page" }] }],
    });
    fireEvent.click(screen.getByLabelText("Send message"));

    await waitFor(() => expect(onFileRequest).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Request sent"));
  });

  it("test_AS_012_a_long_first_line_produces_a_truncation_toast_instead_of_the_plain_success_one", async () => {
    const onFileRequest = vi.fn(async (_payload: { title: string; body: string }) => ({ ok: true }));
    const longLine = "A".repeat(250);

    render(
      createElement(MessageComposer, {
        onSend: vi.fn(async () => ({ ok: true })),
        onFileRequest,
        mentionSuggestions: MENTION_SUGGESTIONS,
      }),
    );

    await checkRequestBoxAndUpdateDoc({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: longLine }] }],
    });
    fireEvent.click(screen.getByLabelText("Send message"));

    await waitFor(() => expect(onFileRequest).toHaveBeenCalledTimes(1));
    expect(onFileRequest.mock.calls[0][0].title).toHaveLength(200);
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        expect.stringContaining("shortened"),
      ),
    );
  });
});

describe("F015 / AS-012: queued attachments block a request send", () => {
  it("test_AS_012_a_queued_attachment_blocks_sending_a_request_with_an_inline_message", async () => {
    const onFileRequest = vi.fn(async (_payload: { title: string; body: string }) => ({ ok: true }));

    const { container } = render(
      createElement(MessageComposer, {
        onSend: vi.fn(async () => ({ ok: true })),
        onFileRequest,
        mentionSuggestions: MENTION_SUGGESTIONS,
        channelId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      }),
    );

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["hello"], "brief.pdf", { type: "application/pdf" });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });
    await waitFor(() => expect(screen.getByText("brief.pdf")).toBeInTheDocument());

    await checkRequestBoxAndUpdateDoc({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Add a pricing page" }] }],
    });
    fireEvent.click(screen.getByLabelText("Send message"));

    await waitFor(() =>
      expect(
        screen.getByText("Attachments can't be added to a request yet — send them as a message."),
      ).toBeInTheDocument(),
    );
    expect(onFileRequest).not.toHaveBeenCalled();
  });
});
