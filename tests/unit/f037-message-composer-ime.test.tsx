// @vitest-environment jsdom
//
// F037: IME composition safety for the plain-Textarea fallback path of
// components/chat/message-composer.tsx (used when `mentionSuggestions` is
// not passed — see that component's `useRichEditor` gate). The rich-editor
// path's equivalent guard lives inside components/editor/rich-text-
// editor.tsx and is covered directly in tests/unit/rich-text-editor.test.tsx;
// this file exercises the OTHER branch, which has its own separate
// `onKeyDown` handler wired straight to a plain `<textarea>`.
//
// Before this fix, `onKeyDown` checked only `key === "Enter" && !shiftKey`
// — a CJK IME's Enter-to-commit-candidate keydown was indistinguishable
// from a genuine submit keystroke, sending raw partial text and clearing
// the composer mid-composition.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { MessageComposer } from "@/components/chat/message-composer";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("F037: message composer (plain-textarea path) ignores IME composition Enter", () => {
  it("does not submit on an isComposing Enter, but does on a real one", async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: true });

    render(<MessageComposer onSend={onSend} />);

    const textarea = await waitFor(() => screen.getByLabelText("Message") as HTMLTextAreaElement);

    fireEvent.change(textarea, { target: { value: "こんにちは" } });
    fireEvent.keyDown(textarea, { key: "Enter", isComposing: true });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: "Enter", isComposing: false });
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
  });

  it("does not submit on a keyCode-229 Enter (Safari/older-Chrome IME fallback)", async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: true });

    render(<MessageComposer onSend={onSend} />);

    const textarea = await waitFor(() => screen.getByLabelText("Message") as HTMLTextAreaElement);

    fireEvent.change(textarea, { target: { value: "candidate" } });
    fireEvent.keyDown(textarea, { key: "Enter", keyCode: 229 });
    expect(onSend).not.toHaveBeenCalled();
  });
});
