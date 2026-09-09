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
//
// F038 narrowed the guard again: Android soft keyboards (GBoard, Samsung)
// set `isComposing === true` during ordinary Latin typing, not just genuine
// CJK candidate selection. The original F037 guard (suppress whenever
// `isComposing` is true, OR whenever `keyCode === 229`) broke Enter-to-send
// for Android users on this plain-textarea path. The guard now only
// suppresses when BOTH `isComposing` is true AND `keyCode === 229` — the
// combination that signals a genuine IME candidate-commit.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { MessageComposer } from "@/components/chat/message-composer";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("F037/F038: message composer (plain-textarea path) ignores IME composition Enter", () => {
  it("does not submit on a genuine IME candidate-commit Enter (isComposing + keyCode 229), but does on a real one", async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: true });

    render(<MessageComposer onSend={onSend} />);

    const textarea = await waitFor(() => screen.getByLabelText("Message") as HTMLTextAreaElement);

    fireEvent.change(textarea, { target: { value: "こんにちは" } });
    fireEvent.keyDown(textarea, { key: "Enter", isComposing: true, keyCode: 229 });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: "Enter", isComposing: false });
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
  });

  it("AS: does not submit on a keyCode-229 Enter combined with isComposing (Safari/older-Chrome IME fallback)", async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: true });

    render(<MessageComposer onSend={onSend} />);

    const textarea = await waitFor(() => screen.getByLabelText("Message") as HTMLTextAreaElement);

    fireEvent.change(textarea, { target: { value: "candidate" } });
    fireEvent.keyDown(textarea, { key: "Enter", isComposing: true, keyCode: 229 });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("F038 regression: submits on a discrete Enter while isComposing is true but there is no candidate window (Android GBoard/Samsung Latin typing)", async () => {
    const onSend = vi.fn().mockResolvedValue({ ok: true });

    render(<MessageComposer onSend={onSend} />);

    const textarea = await waitFor(() => screen.getByLabelText("Message") as HTMLTextAreaElement);

    // GBoard/Samsung keyboards keep `isComposing === true` even during
    // ordinary Latin word-by-word typing, but they do NOT set `keyCode
    // === 229` on the discrete Enter that follows — that combination is
    // the signal this guard now uses to distinguish "ordinary Android
    // composing" from "genuine CJK candidate commit".
    fireEvent.change(textarea, { target: { value: "hello world" } });
    fireEvent.keyDown(textarea, { key: "Enter", isComposing: true, keyCode: 13 });
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
  });
});
