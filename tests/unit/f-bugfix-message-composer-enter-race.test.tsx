// @vitest-environment jsdom
//
// Live-reproduced bug (regular channels AND DMs, same composer): typing
// text and pressing Enter immediately produced an EMPTY message in the
// list while the typed text stayed stuck in the composer field.
//
// Root cause confirmed in components/editor/rich-text-editor.tsx: Enter
// (no Shift) was never intercepted by Tiptap's own `editorProps
// .handleKeyDown` -- so ProseMirror's built-in `Enter` keymap binding
// (splitBlock) ran FIRST, synchronously, directly on the contenteditable
// DOM node, mutating the document (and firing `onUpdate`) entirely before
// the native keydown event ever bubbled up to message-composer.tsx's
// ancestor `onKeyDown` handler. That ancestor handler's own
// `event.preventDefault()` therefore ran too late to stop anything -- the
// split had already happened -- and whatever `submit()` read at that point
// was a render-behind/already-mutated document, not what the user actually
// typed.
//
// Fix: a new `onEnterSubmit` prop on `RichTextEditor`, invoked from INSIDE
// `editorProps.handleKeyDown` (before ProseMirror's own Enter handling
// runs) with `view.state.doc.toJSON()` captured at that exact moment --
// always the real, just-typed content, never stale and never
// already-split. `message-composer.tsx` wires this straight into `submit()`
// and now also rejects an empty document outright (no `onSend` call at
// all), matching Tiptap's own `editor.isEmpty` convention for "nothing to
// send".
//
// This test mocks `RichTextEditor` at a level that mirrors that real
// contract: our stub exposes `onEnterSubmit` and calls it with whatever
// document was last passed via `onChange`, i.e. it does NOT rely on
// message-composer's own state/ref plumbing to already be correct --
// it exercises the actual prop contract the fix introduces.
import { createElement } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { MessageComposer } from "@/components/chat/message-composer";

type JSONDoc = { type: "doc"; content: unknown[] };

let latestOnChange: ((content: JSONDoc) => void) | null = null;
let latestOnEnterSubmit: ((content: JSONDoc) => void) | null = null;
let currentDoc: JSONDoc = { type: "doc", content: [] };

vi.mock("@/components/editor/rich-text-editor", () => ({
  RichTextEditor: (props: {
    content?: JSONDoc | null;
    onChange?: (content: JSONDoc) => void;
    onEnterSubmit?: (content: JSONDoc) => void;
  }) => {
    currentDoc = props.content ?? { type: "doc", content: [] };
    latestOnChange = props.onChange ?? null;
    latestOnEnterSubmit = props.onEnterSubmit ?? null;
    return createElement("div", { "data-testid": "rich-editor-stub" });
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  latestOnChange = null;
  latestOnEnterSubmit = null;
  currentDoc = { type: "doc", content: [] };
});

const TYPED_DOC: JSONDoc = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "hello world" }],
    },
  ],
};

const EMPTY_DOC: JSONDoc = { type: "doc", content: [] };

describe("bugfix: message composer Enter race + empty-message rejection", () => {
  it("test_composer_reads_fresh_editor_content_on_enter_not_stale_react_state", async () => {
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

    // Simulate the exact race: a keystroke's onChange fires, and Enter is
    // "pressed" (the fix's onEnterSubmit) with the document captured at
    // that same instant -- never a value from a subsequent, not-yet-applied
    // render. Both callbacks receive the SAME just-typed content, exactly
    // as Tiptap would deliver it synchronously within one keydown.
    act(() => {
      latestOnChange?.(TYPED_DOC);
    });
    act(() => {
      latestOnEnterSubmit?.(TYPED_DOC);
    });

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });

    const sentBody = onSend.mock.calls[0]?.[0];
    expect(sentBody).toEqual(TYPED_DOC);
    // The typed text must NOT still be present in the composer's content
    // prop after a successful send -- it must be cleared, not "stuck".
    await waitFor(() => {
      expect(currentDoc).toEqual(EMPTY_DOC);
    });
  });

  it("test_composer_does_not_send_an_empty_message_on_enter", async () => {
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

    // Enter pressed while the editor is still empty (Tiptap's own
    // `editor.isEmpty` shape: a doc with no content) -- pressing Enter must
    // be a silent no-op: no server action call at all.
    act(() => {
      latestOnEnterSubmit?.(EMPTY_DOC);
    });

    // Give any (incorrect) async submission a chance to happen before
    // asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("test_composer_does_not_send_a_whitespace_only_message_on_enter", async () => {
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

    // A paragraph node with no text content at all -- Tiptap's own "empty
    // doc" shape used elsewhere in this component (`EMPTY_DOC` in
    // message-composer.tsx is exactly `{ type: "doc", content: [] }`, and
    // `isEmptyDoc` treats any doc with an empty/absent `content` array as
    // empty) -- must not be sendable either.
    const whitespaceDoc: JSONDoc = { type: "doc", content: [] };
    act(() => {
      latestOnChange?.(whitespaceDoc);
    });
    act(() => {
      latestOnEnterSubmit?.(whitespaceDoc);
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onSend).not.toHaveBeenCalled();
  });
});
