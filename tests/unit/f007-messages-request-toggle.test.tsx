// @vitest-environment jsdom
//
// F007 (portal-simplify, AS-012/AS-013): the Messages page composer gains a
// "This is a request for new work" checkbox, only when the caller passes
// `onFileRequest`. This exercises MessageComposer directly on its plain-
// textarea path (no `mentionSuggestions` -> `useRichEditor` is false, same
// convention f037/f-bugfix-message-composer-enter-race already use to avoid
// mocking the rich-text editor module for behaviour that doesn't depend on
// it), asserting:
//   - AS-012: checking the box and sending calls `onFileRequest` with a
//     title derived from the first line and the full text as body, never
//     `onSend`.
//   - Plain message path unchanged: leaving the box unchecked still calls
//     `onSend`, never `onFileRequest`, exactly as before this feature.
//   - No checkbox at all renders when `onFileRequest` is omitted (every
//     other caller of this shared composer, e.g. staff chat).
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { MessageComposer } from "@/components/chat/message-composer";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MessageComposer — F007 AS-012/AS-013: request-for-new-work toggle", () => {
  it("test_AS_012_no_onFileRequest_renders_no_checkbox", () => {
    render(<MessageComposer onSend={vi.fn(async () => ({ ok: true }))} />);

    expect(
      screen.queryByText("This is a request for new work"),
    ).not.toBeInTheDocument();
  });

  it("test_AS_012_checking_the_box_and_sending_files_a_request_not_a_message", async () => {
    const onSend = vi.fn(async () => ({ ok: true }));
    const onFileRequest = vi.fn(async () => ({ ok: true }));

    render(
      <MessageComposer onSend={onSend} onFileRequest={onFileRequest} />,
    );

    fireEvent.click(screen.getByText("This is a request for new work"));

    const textarea = screen.getByLabelText("Message");
    fireEvent.change(textarea, {
      target: { value: "Add a testimonials section\nWould help conversions a lot." },
    });

    fireEvent.click(screen.getByLabelText("Send message"));

    await waitFor(() => expect(onFileRequest).toHaveBeenCalledTimes(1));
    expect(onSend).not.toHaveBeenCalled();
    expect(onFileRequest).toHaveBeenCalledWith({
      title: "Add a testimonials section",
      body: "Add a testimonials section\nWould help conversions a lot.",
    });
  });

  it("test_plain_message_path_unchanged_when_box_left_unchecked", async () => {
    const onSend = vi.fn(async () => ({ ok: true }));
    const onFileRequest = vi.fn(async () => ({ ok: true }));

    render(
      <MessageComposer onSend={onSend} onFileRequest={onFileRequest} />,
    );

    const textarea = screen.getByLabelText("Message");
    fireEvent.change(textarea, { target: { value: "Just checking in" } });

    fireEvent.click(screen.getByLabelText("Send message"));

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onFileRequest).not.toHaveBeenCalled();
  });
});
