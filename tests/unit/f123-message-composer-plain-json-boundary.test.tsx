// @vitest-environment jsdom
//
// F123 (AS-079, AS-080): the composer used to hand Tiptap's live
// JSONContent straight to the `sendMessage` Server Action. Crossing that
// boundary, nested `attrs` objects become React "temporary client
// references" rather than plain data -- unreadable on the server (the
// exact crash `hasUsableLinkHref` surfaced: "Cannot access href on the
// server. You cannot dot into a temporary client reference from a server
// component."), and the reason a link's href silently never reached the
// database before that read existed. `submit()` must round-trip the body
// through `toPlainJson` (a plain `JSON.parse(JSON.stringify(...))`) on the
// CLIENT, before calling `onSend`, not after.
//
// We can't reproduce the actual RSC temporary-reference encoding in a
// jsdom unit test (that behaviour only exists when a real Server Action
// boundary is crossed by the Next.js runtime). Instead we assert the
// observable contract that prevents it: whatever object reaches `onSend`
// for the rich-editor path must be a fresh, JSON-plain clone -- not the
// same object reference the editor produced, and structurally identical to
// its own `JSON.parse(JSON.stringify(...))` round-trip. This is exactly
// what a temporary-reference-safe payload must satisfy.
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { MessageComposer } from "@/components/chat/message-composer";

let latestOnChange: ((content: unknown) => void) | null = null;

vi.mock("@/components/editor/rich-text-editor", () => ({
  RichTextEditor: (props: { onChange?: (content: unknown) => void }) => {
    latestOnChange = props.onChange ?? null;
    return createElement("div", { "data-testid": "rich-editor-stub" });
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  latestOnChange = null;
});

describe("F123 message composer plain-JSON boundary", () => {
  it("test_AS_079_composer_serialises_rich_body_to_plain_json_before_onSend", async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: true });

    render(
      createElement(MessageComposer, {
        onSend,
        mentionSuggestions: [],
        channelId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("rich-editor-stub")).toBeInTheDocument();
    });

    // A live Tiptap-shaped document whose `attrs` object we can identify
    // by reference -- this stands in for the "temporary client reference"
    // risk: if the composer forwards this exact object (or any object
    // still holding a reference to it) to `onSend`, the fix is missing.
    const liveAttrs = { href: "https://example.com" };
    const liveDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "https://example.com",
              marks: [{ type: "link", attrs: liveAttrs }],
            },
          ],
        },
      ],
    };

    act(() => {
      latestOnChange?.(liveDoc);
    });

    const wrapper = screen.getByTestId("rich-editor-stub").parentElement;
    if (!wrapper) throw new Error("expected rich editor stub to have a wrapper");
    fireEvent.keyDown(wrapper, { key: "Enter" });

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });

    const sentBody = onSend.mock.calls[0]?.[0];

    // Structurally the same document...
    expect(sentBody).toEqual(liveDoc);
    // ...but NOT the same object graph: the nested `attrs` object must be
    // a fresh clone, never the live reference itself, which is exactly
    // what `toPlainJson`'s JSON round-trip guarantees and a raw pass-through
    // would violate.
    const sentAttrs = (sentBody as typeof liveDoc).content[0].content[0].marks[0].attrs;
    expect(sentAttrs).not.toBe(liveAttrs);
    expect(sentBody).not.toBe(liveDoc);
  });
});
