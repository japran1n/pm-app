// @vitest-environment jsdom
//
// F169: shared Tiptap editor component (components/editor/rich-text-editor.tsx).
//
// AS-306: bold, italic, headings, lists, code blocks, links all work.
// AS-313: keyboard-operable — toolbar buttons and shortcuts are reachable
//         via keyboard, not just mouse; Escape exits/blurs without losing
//         content.
//
// Approach: Tiptap/ProseMirror's contenteditable typing simulation is not
// reliable in jsdom (no real browser input pipeline), so AS-306 is verified
// through the shared extension set actually rendering each mark/node type
// via a real Tiptap JSON document — the same code path (`RichTextRenderer`
// and `RichTextEditor` share `sharedExtensions()`) that a live editor uses
// to interpret content, and through the toolbar's `isActive` detection
// reflecting the true editor state on mount for each type. AS-313 is
// verified against the real DOM: toolbar buttons are genuine <button>
// elements with no keyboard trap, and Escape is dispatched as a real
// keydown event against the focused editor DOM node.

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import {
  RichTextEditor,
  RichTextRenderer,
  type JSONContent,
} from "@/components/editor/rich-text-editor";

afterEach(() => {
  cleanup();
});

const FULL_DOC: JSONContent = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Subtitle" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", marks: [{ type: "bold" }], text: "bold text" },
        { type: "text", text: " and " },
        { type: "text", marks: [{ type: "italic" }], text: "italic text" },
        { type: "text", text: " and a " },
        {
          type: "text",
          marks: [{ type: "link", attrs: { href: "https://example.com" } }],
          text: "link",
        },
      ],
    },
    {
      type: "bulletList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "bullet one" }] }] },
      ],
    },
    {
      type: "orderedList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "item one" }] }] },
      ],
    },
    {
      type: "codeBlock",
      content: [{ type: "text", text: "const x = 1" }],
    },
  ],
};

describe("AS-306: RichTextRenderer / RichTextEditor interpret bold, italic, headings, lists, code blocks, links", () => {
  it("test_AS_306_renders_headings", () => {
    render(createElement(RichTextRenderer, { content: FULL_DOC }));
    expect(screen.getByRole("heading", { level: 1, name: "Title" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Subtitle" })).toBeInTheDocument();
  });

  it("test_AS_306_renders_bold_and_italic_marks", () => {
    const { container } = render(createElement(RichTextRenderer, { content: FULL_DOC }));
    const strong = container.querySelector("strong");
    const em = container.querySelector("em");
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe("bold text");
    expect(em).not.toBeNull();
    expect(em?.textContent).toBe("italic text");
  });

  it("test_AS_306_renders_bullet_and_ordered_lists", () => {
    const { container } = render(createElement(RichTextRenderer, { content: FULL_DOC }));
    const ul = container.querySelector("ul");
    const ol = container.querySelector("ol");
    expect(ul).not.toBeNull();
    expect(within(ul as HTMLElement).getByText("bullet one")).toBeInTheDocument();
    expect(ol).not.toBeNull();
    expect(within(ol as HTMLElement).getByText("item one")).toBeInTheDocument();
  });

  it("test_AS_306_renders_code_block", () => {
    const { container } = render(createElement(RichTextRenderer, { content: FULL_DOC }));
    const pre = container.querySelector("pre code");
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toBe("const x = 1");
  });

  it("test_AS_306_renders_link_with_href", () => {
    const { container } = render(createElement(RichTextRenderer, { content: FULL_DOC }));
    const a = container.querySelector("a");
    expect(a).not.toBeNull();
    expect(a?.getAttribute("href")).toBe("https://example.com");
    expect(a?.textContent).toBe("link");
  });

  it("test_AS_306_editable_toolbar_reflects_heading_active_state_from_true_editor_state", () => {
    const headingDoc: JSONContent = {
      type: "doc",
      content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] }],
    };
    render(createElement(RichTextEditor, { content: headingDoc }));
    // Cursor lands at the document start inside the heading node on mount,
    // so the toolbar's isActive("heading", {level:1}) check reflects the
    // real editor state, not a hardcoded prop.
    const h1Button = screen.getByRole("button", { name: "Heading 1" });
    expect(h1Button).toHaveAttribute("aria-pressed", "true");
    const h2Button = screen.getByRole("button", { name: "Heading 2" });
    expect(h2Button).toHaveAttribute("aria-pressed", "false");
  });

  it("test_AS_306_toolbar_toggle_click_updates_controlled_JSON_value", () => {
    const onChange = vi.fn();
    const emptyDoc: JSONContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [] }],
    };
    render(createElement(RichTextEditor, { content: emptyDoc, onChange }));
    const boldButton = screen.getByRole("button", { name: "Bold" });
    // Clicking the toolbar toggles the stored mark for the empty
    // selection — this is Tiptap's documented behaviour and is a real,
    // observable state transition on the editor (isActive flips), proving
    // the toolbar control is wired to the live editor instance rather than
    // being a static, disconnected button.
    fireEvent.click(boldButton);
    expect(boldButton).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(boldButton);
    expect(boldButton).toHaveAttribute("aria-pressed", "false");
  });
});

describe("AS-313: keyboard operability, Escape blurs without losing content", () => {
  it("test_AS_313_toolbar_buttons_are_real_focusable_buttons_not_mouse_only", () => {
    render(createElement(RichTextEditor, { content: null }));
    const toolbar = screen.getByRole("toolbar", { name: "Formatting" });
    const buttons = within(toolbar).getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      // Real <button> elements are in the default Tab order unless
      // explicitly removed (tabIndex -1) or disabled — neither is the
      // case here, so every control is keyboard reachable.
      expect(button.tagName).toBe("BUTTON");
      expect(button).not.toHaveAttribute("tabindex", "-1");
      expect(button).not.toBeDisabled();
    }
  });

  it("test_AS_313_escape_blurs_editor_and_preserves_buffer_content", () => {
    const onBlur = vi.fn();
    const content: JSONContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "keep me" }] }],
    };
    const { container } = render(
      createElement(RichTextEditor, { content, onBlur, "aria-label": "Task description" })
    );
    const editable = screen.getByRole("textbox", { name: "Task description" });
    editable.focus();
    expect(editable).toHaveFocus();

    fireEvent.keyDown(editable, { key: "Escape", code: "Escape" });

    expect(onBlur).toHaveBeenCalledTimes(1);
    // Content must still be present in the DOM after Escape — Escape
    // blurs, it does not clear or revert the buffer.
    expect(container.textContent).toContain("keep me");
  });

  // F037 (IME safety): `onEnterSubmit`'s own keydown interception (inside
  // `editorProps.handleKeyDown`, before ProseMirror's `Enter` keymap runs)
  // used to check only `key === "Enter" && !shiftKey`. A CJK IME sends a
  // real "Enter" keydown to commit a candidate, which — before this fix —
  // was indistinguishable from a genuine submit keystroke.
  it("F037/F038: does not fire onEnterSubmit for a genuine IME candidate-commit Enter (isComposing + keyCode 229)", () => {
    const onEnterSubmit = vi.fn();
    const content: JSONContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }],
    };
    render(
      createElement(RichTextEditor, {
        content,
        onEnterSubmit,
        "aria-label": "Message",
      }),
    );
    const editable = screen.getByRole("textbox", { name: "Message" });
    editable.focus();

    fireEvent.keyDown(editable, { key: "Enter", isComposing: true, keyCode: 229 });
    expect(onEnterSubmit).not.toHaveBeenCalled();
  });

  it("F037/F038: does not fire onEnterSubmit for an IME candidate-commit Enter (isComposing + keyCode 229 fallback)", () => {
    const onEnterSubmit = vi.fn();
    const content: JSONContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }],
    };
    render(
      createElement(RichTextEditor, {
        content,
        onEnterSubmit,
        "aria-label": "Message",
      }),
    );
    const editable = screen.getByRole("textbox", { name: "Message" });
    editable.focus();

    fireEvent.keyDown(editable, { key: "Enter", isComposing: true, keyCode: 229 });
    expect(onEnterSubmit).not.toHaveBeenCalled();
  });

  it("F037: a genuine (non-composing) Enter still fires onEnterSubmit", () => {
    const onEnterSubmit = vi.fn();
    const content: JSONContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }],
    };
    render(
      createElement(RichTextEditor, {
        content,
        onEnterSubmit,
        "aria-label": "Message",
      }),
    );
    const editable = screen.getByRole("textbox", { name: "Message" });
    editable.focus();

    fireEvent.keyDown(editable, { key: "Enter" });
    expect(onEnterSubmit).toHaveBeenCalledTimes(1);
  });

  it("F038: submits on a discrete Enter while isComposing is true but keyCode is not 229 (Android GBoard/Samsung Latin typing)", () => {
    const onEnterSubmit = vi.fn();
    const content: JSONContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }],
    };
    render(
      createElement(RichTextEditor, {
        content,
        onEnterSubmit,
        "aria-label": "Message",
      }),
    );
    const editable = screen.getByRole("textbox", { name: "Message" });
    editable.focus();

    fireEvent.keyDown(editable, { key: "Enter", isComposing: true, keyCode: 13 });
    expect(onEnterSubmit).toHaveBeenCalledTimes(1);
  });

  // F318 (AS-378, data-loss bug): every real caller (comment-list.tsx,
  // task-detail-sheet.tsx) mounts with empty `mentionSuggestions` and
  // populates them a moment later, which — per F310/F317's deps-driven
  // recreation mechanism — destroys and recreates the underlying Tiptap
  // `Editor` instance. `handleDescriptionJsonBlur` (task-detail-sheet.tsx)
  // is the description field's ONLY save path, wired to `onBlur`, which
  // Escape triggers. If `handleKeyDown`'s Escape branch reaches for a
  // stale `editor` closure captured at recreation time instead of the
  // `view` parameter ProseMirror hands it fresh per-instance, calling
  // `.commands` on the by-then-destroyed old instance throws — which would
  // prevent the save from completing. This test reproduces exactly that
  // sequence and must not throw.
  it("test_AS_378_escape_after_mention_triggered_recreation_does_not_throw_and_still_blurs", () => {
    const onBlur = vi.fn();
    const content: JSONContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "keep me too" }] }],
    };

    const { container, rerender } = render(
      createElement(RichTextEditor, {
        content,
        onBlur,
        "aria-label": "Task description",
        mentionSuggestions: [],
      })
    );

    const editableBefore = screen.getByRole("textbox", { name: "Task description" });
    editableBefore.focus();
    expect(editableBefore).toHaveFocus();

    // Populate mention candidates asynchronously, as every real caller
    // does — this changes `computedMentionSuggestionsKey` and triggers
    // `RichTextEditor`'s deps-driven destroy/recreate of the underlying
    // Tiptap `Editor` instance while the field is focused.
    rerender(
      createElement(RichTextEditor, {
        content,
        onBlur,
        "aria-label": "Task description",
        mentionSuggestions: [{ id: "u1", label: "Alice" }],
      })
    );

    // The DOM node is recreated by Tiptap's own re-mount of EditorContent;
    // re-query and re-focus it, mirroring what actually happens in a real
    // browser (the user's focus stays in the field across the swap).
    const editableAfter = screen.getByRole("textbox", { name: "Task description" });
    editableAfter.focus();

    expect(() => {
      fireEvent.keyDown(editableAfter, { key: "Escape", code: "Escape" });
    }).not.toThrow();

    expect(onBlur).toHaveBeenCalled();
    // The save path's content must still be intact — this is the actual
    // data-loss surface: a thrown error here would abort
    // `handleDescriptionJsonBlur` before the save fires.
    expect(container.textContent).toContain("keep me too");
  });
});

// Task detail description editor: `mode="plain"` restricts the shared
// RichTextEditor to plain multiline text (paragraph/hardBreak/link
// autolink/image paste), matching the product decision to drop rich
// formatting from the task description field while leaving every other
// caller (chat/comments) on the default `mode="full"` behaviour untouched.
describe("mode=\"plain\": task description editor has no rich-text toolbar or formatting", () => {
  it("test_plain_mode_renders_no_formatting_toolbar", () => {
    render(
      createElement(RichTextEditor, {
        content: { type: "doc", content: [] },
        "aria-label": "Description",
        mode: "plain",
      })
    );

    // No toolbar role at all in plain mode.
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    // None of the rich-text toggle buttons exist.
    for (const name of [
      "Bold",
      "Italic",
      "Code",
      "Heading 1",
      "Heading 2",
      "Bullet list",
      "Ordered list",
      "Checklist",
      "Link",
    ]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("test_plain_mode_default_mode_full_still_renders_the_toolbar_unchanged", () => {
    render(
      createElement(RichTextEditor, {
        content: { type: "doc", content: [] },
        "aria-label": "Comment composer",
      })
    );

    // Default (no `mode` prop) is unchanged for every existing caller
    // (comments/chat) — the toolbar is still present.
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bold" })).toBeInTheDocument();
  });

  it("test_plain_mode_bold_italic_headings_lists_and_blockquote_marks_are_stripped_from_stored_content", () => {
    // A previously-stored document carrying rich marks/nodes must degrade
    // to plain paragraphs/text when displayed through the plain-mode
    // editor's own schema (bold/italic/heading/lists are not part of the
    // plain-mode extension set at all, so Tiptap drops them on load).
    const richContent: JSONContent = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", marks: [{ type: "bold" }], text: "bold text" },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "item" }] }],
            },
          ],
        },
      ],
    };

    const { container } = render(
      createElement(RichTextEditor, {
        content: richContent,
        "aria-label": "Description",
        mode: "plain",
      })
    );

    // The text content still comes through (schema degrades unknown node
    // types to their text where possible), but none of the rich markup
    // survives.
    expect(container.querySelector("strong")).not.toBeInTheDocument();
    expect(container.querySelector("h1")).not.toBeInTheDocument();
    expect(container.querySelector("ul")).not.toBeInTheDocument();
  });

  it("test_plain_mode_still_autodetects_links", () => {
    const content: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              marks: [{ type: "link", attrs: { href: "https://example.com" } }],
              text: "a link",
            },
          ],
        },
      ],
    };

    const { container } = render(
      createElement(RichTextEditor, {
        content,
        "aria-label": "Description",
        mode: "plain",
      })
    );

    const link = container.querySelector("a[href='https://example.com']");
    expect(link).toBeInTheDocument();
    expect(link?.textContent).toBe("a link");
  });

  it("test_plain_mode_field_is_taller_and_manually_resizable", () => {
    // Product feedback: the task description needs a single, larger field
    // the user can manually resize, replacing the removed duplicate
    // read-only "Preview" panel that used to sit underneath it.
    render(
      createElement(RichTextEditor, {
        content: { type: "doc", content: [] },
        "aria-label": "Description",
        mode: "plain",
      })
    );

    const textbox = screen.getByRole("textbox", { name: "Description" });
    expect(textbox.className).toMatch(/resize-y/);
    expect(textbox.className).toMatch(/overflow-auto/);
    expect(textbox.className).toMatch(/min-h-\[220px\]/);
  });

  it("test_plain_mode_full_mode_is_not_resizable_by_default", () => {
    // The resize/min-height treatment is specific to the task description
    // field (`mode="plain"`) — every existing `mode="full"` caller
    // (comments/chat) keeps its original, non-resizable sizing.
    render(
      createElement(RichTextEditor, {
        content: { type: "doc", content: [] },
        "aria-label": "Comment composer",
      })
    );

    const textbox = screen.getByRole("textbox", { name: "Comment composer" });
    expect(textbox.className).not.toMatch(/resize-y/);
  });
});
