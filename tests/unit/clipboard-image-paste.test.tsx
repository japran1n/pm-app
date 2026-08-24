// @vitest-environment jsdom
//
// F261 (AS-508): an image pasted from the clipboard into a comment uploads
// as an attachment.
//
// Coverage split, per this feature's clarified "primary test: the test
// type that fits" answer:
//   1. `extractImageFilesFromClipboard` (lib/editor/paste-rules.ts) — pure
//      logic, unit-tested directly against fake
//      `DataTransferItem`-shaped objects.
//   2. `appendAttachmentReference` (lib/comments/rich-text.ts) — pure
//      logic, unit-tested directly.
//   3. `RichTextEditor`'s `onImagePaste` wiring (components/editor/
//      rich-text-editor.tsx) — a real mounted Tiptap editor, a real
//      `fireEvent.paste` with a fake `clipboardData.items` list carrying
//      an image `File`, proving the paste is intercepted (no image node
//      reaches the document) and the caller's `onImagePaste` receives the
//      file. Also proves non-image paste (plain text) is completely
//      unaffected — the F172 regression-protection requirement.
//   4. `CommentList`'s composer — mocks `uploadAttachment` (the same
//      action F258/F259/F260 already use, never a second upload path) and
//      fires a real paste on the mounted composer editor, proving: a
//      successful paste calls `uploadAttachment` with the right taskId,
//      shows an upload-progress row, and appends a text reference to the
//      draft; a FAILED upload leaves already-typed draft text intact and
//      shows an error row instead of clearing the composer.

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { extractImageFilesFromClipboard } from "@/lib/editor/paste-rules";
import { appendAttachmentReference, docFromPlainText } from "@/lib/comments/rich-text";
import {
  RichTextEditor,
  type JSONContent,
} from "@/components/editor/rich-text-editor";

afterEach(() => {
  cleanup();
});

// Realtime subscriptions talk to a live Supabase channel — out of scope
// here, same stub convention as tests/unit/mention-picker-narrowing.test.tsx.
vi.mock("@/components/task/use-comments-realtime", () => ({
  useCommentsRealtime: () => {},
}));
vi.mock("@/components/task/use-reactions-realtime", () => ({
  useReactionsRealtime: () => {},
}));

const uploadAttachmentMock = vi.fn();
vi.mock("@/lib/actions/attachments", () => ({
  uploadAttachment: (...args: unknown[]) => uploadAttachmentMock(...args),
}));

vi.mock("@/lib/actions/comments", () => ({
  addComment: vi.fn(),
  deleteComment: vi.fn(),
  editComment: vi.fn(),
  restoreComment: vi.fn(),
  getMentionCandidates: vi.fn(async () => ({ ok: true, data: { userIds: [] } })),
}));

function fakeClipboardItem(kind: string, type: string, file: File | null) {
  return { kind, type, getAsFile: () => file };
}

describe("AS-508: extractImageFilesFromClipboard (pure)", () => {
  it("test_AS_508_extracts_every_image_item_and_ignores_non_image_items", () => {
    const imageFile = new File(["x"], "screenshot.png", { type: "image/png" });
    const items = [
      fakeClipboardItem("string", "text/plain", null),
      fakeClipboardItem("file", "image/png", imageFile),
      fakeClipboardItem("file", "application/pdf", new File(["x"], "doc.pdf", { type: "application/pdf" })),
    ] as unknown as DataTransferItemList;
    (items as unknown as { length: number }).length = 3;

    const result = extractImageFilesFromClipboard(items);
    expect(result).toEqual([imageFile]);
  });

  it("test_AS_508_returns_empty_array_for_plain_text_only_clipboard", () => {
    const items = [
      fakeClipboardItem("string", "text/plain", null),
    ] as unknown as DataTransferItemList;
    (items as unknown as { length: number }).length = 1;

    expect(extractImageFilesFromClipboard(items)).toEqual([]);
  });

  it("test_AS_508_returns_empty_array_when_items_is_undefined", () => {
    expect(extractImageFilesFromClipboard(undefined)).toEqual([]);
  });
});

describe("AS-508: appendAttachmentReference (pure)", () => {
  it("test_AS_508_appends_a_plain_text_reference_paragraph_to_an_empty_draft", () => {
    const result = appendAttachmentReference(null, "screenshot.png");
    expect(result).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "\u{1F4CE} screenshot.png" }],
        },
      ],
    });
  });

  it("test_AS_508_appends_after_existing_typed_content_without_losing_it", () => {
    const draft = docFromPlainText("already typed this");
    const result = appendAttachmentReference(draft, "screenshot.png");
    expect(result.content).toHaveLength(2);
    expect(result.content?.[0]).toEqual(draft.content?.[0]);
    expect(JSON.stringify(result)).toContain("screenshot.png");
  });

  it("test_AS_508_never_inserts_an_image_node_only_text", () => {
    const result = appendAttachmentReference(null, "x.png");
    expect(JSON.stringify(result)).not.toContain('"type":"image"');
  });
});

describe("AS-508: RichTextEditor onImagePaste interception", () => {
  function firePasteWithImage(editable: HTMLElement, file: File) {
    const items = [fakeClipboardItem("file", file.type, file)];
    (items as unknown as { length: number }).length = 1;
    fireEvent.paste(editable, {
      clipboardData: {
        items,
        getData: () => "",
      },
    });
  }

  it("test_AS_508_an_image_paste_is_intercepted_and_handed_to_onImagePaste_not_inserted_as_a_node", () => {
    const onImagePaste = vi.fn();
    const content: JSONContent = { type: "doc", content: [{ type: "paragraph", content: [] }] };
    const { container } = render(
      createElement(RichTextEditor, {
        content,
        onImagePaste,
        "aria-label": "Add a comment",
      }),
    );
    const editable = screen.getByRole("textbox", { name: "Add a comment" });
    const file = new File(["x"], "screenshot.png", { type: "image/png" });

    firePasteWithImage(editable, file);

    expect(onImagePaste).toHaveBeenCalledTimes(1);
    expect(onImagePaste).toHaveBeenCalledWith([file]);
    // No <img> ever reaches the rendered document.
    expect(container.querySelector("img")).toBeNull();
  });

  it("test_AS_508_non_image_paste_content_is_unaffected_when_onImagePaste_is_provided", () => {
    // F172 regression guard: providing onImagePaste must not change how a
    // normal HTML/plain-text paste is handled — handlePaste only claims
    // events that actually contain an image clipboard item.
    const onImagePaste = vi.fn();
    const content: JSONContent = { type: "doc", content: [{ type: "paragraph", content: [] }] };
    render(
      createElement(RichTextEditor, {
        content,
        onImagePaste,
        "aria-label": "Add a comment",
      }),
    );
    const editable = screen.getByRole("textbox", { name: "Add a comment" });

    const items = [fakeClipboardItem("string", "text/plain", null)];
    (items as unknown as { length: number }).length = 1;
    fireEvent.paste(editable, {
      clipboardData: {
        items,
        getData: (type: string) => (type === "text/plain" ? "hello" : ""),
      },
    });

    expect(onImagePaste).not.toHaveBeenCalled();
  });

  it("test_AS_508_no_onImagePaste_provided_leaves_existing_F172_image_degradation_path_untouched", () => {
    // Every caller besides the comment composer omits onImagePaste — an
    // image paste for them must not throw and must not call anything;
    // it falls through to F172's pre-existing transformPastedHTML-based
    // alt-text degradation, which this test does not need to re-prove
    // (already covered by tests/unit/editor-paste-rules.test.ts).
    const content: JSONContent = { type: "doc", content: [{ type: "paragraph", content: [] }] };
    render(createElement(RichTextEditor, { content, "aria-label": "Task description" }));
    const editable = screen.getByRole("textbox", { name: "Task description" });
    const file = new File(["x"], "screenshot.png", { type: "image/png" });

    expect(() => firePasteWithImage(editable, file)).not.toThrow();
  });
});

describe("AS-508: CommentList composer paste-to-upload integration", () => {
  afterEach(() => {
    uploadAttachmentMock.mockReset();
  });

  async function renderComposer() {
    const { CommentList } = await import("@/components/task/comment-list");
    render(
      createElement(CommentList, {
        taskId: "task-1",
        comments: [],
        members: [],
        currentUserId: "u1",
        currentUserRole: "member",
      }),
    );
    // Wait for the lazily-loaded real RichTextEditor to hydrate in, AND for
    // the async mention-candidates fetch (mocked to resolve immediately
    // with an empty list) to settle — mentionSuggestions changing triggers
    // RichTextEditor's own deps-driven instance recreation (F310/F317),
    // during which `editor` is transiently null and the whole component
    // renders nothing; waiting for that to finish settling avoids racing
    // a query against that transient frame.
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Add a comment" })).toBeInTheDocument();
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Add a comment" })).toBeInTheDocument();
    });
  }

  // Re-queries fresh every call, deliberately never holding a stale
  // element reference across an `await` — a mention-candidates-driven
  // editor recreation (see renderComposer's comment above) can swap the
  // underlying DOM node out from under a held reference.
  function getEditable(): HTMLElement {
    return screen.getByRole("textbox", { name: "Add a comment" });
  }

  function firePasteWithImage(editable: HTMLElement, file: File) {
    const items = [{ kind: "file", type: file.type, getAsFile: () => file }];
    (items as unknown as { length: number }).length = 1;
    fireEvent.paste(editable, { clipboardData: { items, getData: () => "" } });
  }

  it("test_AS_508_a_pasted_image_uploads_through_the_existing_attachment_action_and_a_reference_appears", async () => {
    uploadAttachmentMock.mockResolvedValue({
      ok: true,
      data: {
        id: "att-1",
        taskId: "task-1",
        fileName: "screenshot.png",
        fileUrl: "task-1/1-screenshot.png",
        uploadedBy: "u1",
        createdAt: new Date().toISOString(),
        signedUrl: "https://example.com/signed",
        mimeType: "image/png",
      },
    });

    await renderComposer();
    const file = new File(["x"], "screenshot.png", { type: "image/png" });
    firePasteWithImage(getEditable(), file);

    await waitFor(() => {
      expect(uploadAttachmentMock).toHaveBeenCalledTimes(1);
    });
    const formData = uploadAttachmentMock.mock.calls[0][0] as FormData;
    expect(formData.get("taskId")).toBe("task-1");
    expect((formData.get("file") as File).name).toBe("screenshot.png");

    // Upload progress row appears and settles to success (the mocked
    // Server Action resolves on the same tick, so "uploading" may already
    // have settled by the time this asserts — the meaningful behaviour is
    // that a row for this file exists and ends in "success", not that a
    // literal transient frame is caught mid-flight).
    await waitFor(() => {
      expect(screen.getByTestId("upload-progress-row")).toHaveAttribute(
        "data-status",
        "success",
      );
    });

    // A plain-text reference appears in the composer — no <img> is ever
    // inserted (attachment shows in the task's attachment list instead).
    await waitFor(() => {
      expect(within(getEditable()).queryByText(/screenshot\.png/)).toBeInTheDocument();
    });
    expect(getEditable().querySelector("img")).toBeNull();
  });

  it("test_AS_508_a_failed_upload_leaves_already_typed_comment_text_intact", async () => {
    uploadAttachmentMock.mockResolvedValue({
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    });

    await renderComposer();

    // Type something first (simulated by directly focusing + firing input
    // isn't reliable for Tiptap in jsdom per this repo's own documented
    // limitation — see rich-text-editor.test.tsx's header comment — so the
    // pre-existing text is asserted via the DOM text content already
    // present after a real paste of plain text, which IS reliable).
    fireEvent.paste(getEditable(), {
      clipboardData: {
        items: Object.assign([{ kind: "string", type: "text/plain", getAsFile: () => null }], { length: 1 }),
        getData: (type: string) => (type === "text/plain" ? "keep my typed words" : ""),
      },
    });
    await waitFor(() => {
      expect(getEditable().textContent).toContain("keep my typed words");
    });

    const file = new File(["x"], "screenshot.png", { type: "image/png" });
    firePasteWithImage(getEditable(), file);

    await waitFor(() => {
      expect(uploadAttachmentMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByTestId("upload-progress-row")).toHaveAttribute(
        "data-status",
        "error",
      );
    });

    // The typed text is still there — a failed paste-upload never clears
    // or reverts the draft.
    expect(getEditable().textContent).toContain("keep my typed words");
  });
});
